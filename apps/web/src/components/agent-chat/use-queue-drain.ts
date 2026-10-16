import { useCallback } from 'react';
import { toast } from 'sonner';
import type { useAgentGateway } from '../../hooks/useAgentGateway.js';
import { markToolCallsDone } from '../../lib/chat-transcript.js';
import { sound } from '../../utils/audio.js';
import { AGENT_QUERY_KEYS } from '../../queries/useAgentQueries.js';
import type { useQueryClient } from '@tanstack/react-query';
import type { ChatMessage, AgentTurnHealth } from './chat-shared.js';
import { makeMessageStreamHandlers } from './chat-stream-handlers.js';

type Gateway = ReturnType<typeof useAgentGateway>;
type QueryClient = ReturnType<typeof useQueryClient>;

export interface QueueDrainDeps {
  turnEpochRef: React.MutableRefObject<number>;
  runningRef: React.MutableRefObject<boolean>;
  queueTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  gateway: Gateway;
  queueDrainRef: React.MutableRefObject<boolean>;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setBusy: (v: boolean) => void;
  setAgentTurnHealth: (h: AgentTurnHealth) => void;
  recordAgentTurnCompletion: (data: {
    status?: 'COMPLETED' | 'INTERRUPTED' | 'FAILED';
    source?: string;
    agentOutcome?: 'streamed' | 'fallback' | 'not_requested';
    agentFailureMessage?: string;
    codexOutcome?: 'streamed' | 'fallback' | 'not_requested';
    codexFailureMessage?: string;
    outcome?: 'streamed' | 'fallback' | 'not_requested';
    failure?: { code: string; userMessage: string; category: 'SESSION_CREATE' | 'STREAM' | 'QUEUE' | 'INTERRUPTED' | 'UNKNOWN'; retryable?: boolean };
    fromQueue?: boolean;
    contextUsage?: { used: number; size: number };
    finalOutput?: string;
    threadId?: string;
    queueRemaining?: number;
    toolWarnings?: string[];
  }) => void;
  setCoachThreadId: (v: string) => void;
  queryClient: QueryClient;
  coachApprovalPolicy: string;
  refetchAgentStatus: () => void;
}

function friendlyQueueError(err: unknown): string {
  const e = err as { userMessage?: string; message?: string } | undefined;
  const raw = e?.userMessage || e?.message || '';
  if (!raw) return '队列消费失败';
  if (raw === 'Gateway is not connected' || /gateway.*not connected/i.test(raw)) {
    return '导师服务未连接，消息未发出；请检查连接后重试。';
  }
  return raw;
}

/**
 * 队列排空生命周期：消费下一项 → 流式跟随 → 完成结算 → 还有剩余则链式下一项。
 * 与直接发送独立，共享流回调构造与结算语义。
 */
export function useQueueDrain(deps: QueueDrainDeps) {
  const {
    turnEpochRef,
    runningRef,
    queueTimerRef,
    gateway,
    queueDrainRef,
    setMessages,
    setBusy,
    setAgentTurnHealth,
    recordAgentTurnCompletion,
    setCoachThreadId,
    queryClient,
    coachApprovalPolicy,
    refetchAgentStatus,
  } = deps;

  const startQueuedTurn = useCallback(
    (queuedSubmissionId?: string) => {
      if (!gateway.isConnected) return;
      if (queueDrainRef.current) return;
      queueDrainRef.current = true;
      sound.playClick();
      const aiId = `a_q_${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        {
          id: `sys_q_${Date.now()}`,
          role: 'system',
          text: '▶ 正在消费队列下一项…',
        },
        {
          id: aiId,
          role: 'assistant',
          text: '',
          reasoning: '',
          streaming: true,
          toolCalls: [],
        },
      ]);
      setBusy(true);
      setAgentTurnHealth({ state: 'running' });
      const epoch = ++turnEpochRef.current;
      runningRef.current = true;
      const isCurrent = () => turnEpochRef.current === epoch;
      const stream = makeMessageStreamHandlers(aiId, setMessages, isCurrent);

      const finish = (data: {
        finalOutput?: string;
        source?: string;
        threadId?: string;
        queueRemaining?: number;
        toolWarnings?: string[];
        contextUsage?: { used: number; size: number };
        status?: 'COMPLETED' | 'INTERRUPTED' | 'FAILED';
        outcome?: 'streamed' | 'fallback' | 'not_requested';
        agentOutcome?: 'streamed' | 'fallback' | 'not_requested';
        agentFailureMessage?: string;
        failure?: { code: string; userMessage: string; category: 'SESSION_CREATE' | 'STREAM' | 'QUEUE' | 'INTERRUPTED' | 'UNKNOWN'; retryable?: boolean };
        fromQueue?: boolean;
      }) => {
        if (!isCurrent()) return;
        const finishedEpoch = ++turnEpochRef.current;
        runningRef.current = false;
        queueDrainRef.current = false;
        recordAgentTurnCompletion(data);
        if (data.toolWarnings?.length) {
          toast.warning(data.toolWarnings.join('；'));
        }
        if (data.threadId) {
          setCoachThreadId(data.threadId);
          void queryClient.invalidateQueries({ queryKey: AGENT_QUERY_KEYS.SESSIONS });
          void queryClient.invalidateQueries({
            queryKey: [...AGENT_QUERY_KEYS.QUEUE, data.threadId],
          });
        }
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== aiId) return m;
            const next: ChatMessage = {
              ...m,
              text: data.finalOutput || m.text,
              streaming: false,
            };
            const doneCalls = markToolCallsDone(m.toolCalls);
            if (doneCalls) next.toolCalls = doneCalls;
            if (data.source) next.source = data.source;
            return next;
          })
        );
        setBusy(false);
        if ((data.queueRemaining ?? 0) > 0) {
          queueTimerRef.current = setTimeout(() => {
            queueTimerRef.current = null;
            if (turnEpochRef.current === finishedEpoch) startQueuedTurn();
          }, 80);
        }
      };

      const ok = gateway.startQueueStream({
        lane: 'coach',
        ...(queuedSubmissionId ? { queuedSubmissionId } : {}),
        ...(coachApprovalPolicy ? { approvalPolicy: coachApprovalPolicy } : {}),
        ...stream,
        onApprovalRequest: (info) => {
          if (!isCurrent()) return;
          setMessages((prev) => [
            ...prev,
            {
              id: `appr_${info.approvalId}`,
              role: 'approval',
              text: info.description,
              approval: {
                approvalId: info.approvalId,
                action: info.action,
                description: info.description,
                riskLevel: info.riskLevel,
                status: 'pending',
                ...(typeof info.expiresAt === 'number'
                  ? { expiresAt: info.expiresAt }
                  : {}),
              },
            },
          ]);
        },
        onApprovalResolved: (info) => {
          if (!isCurrent()) return;
          setMessages((prev) =>
            prev.map((m) => {
              if (m.approval?.approvalId !== info.approvalId || !m.approval) return m;
              if (m.approval.status !== 'pending') return m;
              return { ...m, approval: { ...m.approval, status: resolveApprovalStatus(info) } };
            })
          );
        },
        onComplete: (data) => finish(data),
        onError: (err) => {
          if (!isCurrent()) return;
          turnEpochRef.current++;
          runningRef.current = false;
          queueDrainRef.current = false;
          const msg = friendlyQueueError(err);
          setAgentTurnHealth({ state: 'failed', message: msg });
          void refetchAgentStatus();
          setMessages((prev) =>
            prev.map((m) => (m.id === aiId ? { ...m, text: msg, streaming: false } : m))
          );
          setBusy(false);
        },
      });
      if (!ok) {
        runningRef.current = false;
        queueDrainRef.current = false;
        setBusy(false);
      }
    },
    [
      gateway,
      queueDrainRef,
      setMessages,
      setBusy,
      setAgentTurnHealth,
      recordAgentTurnCompletion,
      setCoachThreadId,
      queryClient,
      coachApprovalPolicy,
      refetchAgentStatus,
    ]
  );

  return { startQueuedTurn };
}

/** 审批终态归一：三处调用点共用，避免映射漂移。 */
export function resolveApprovalStatus(info: {
  reason?: string;
  decision?: string;
}): 'timed_out' | 'cancelled' | 'accepted_session' | 'accepted' | 'declined' {
  if (info.reason === 'timeout') return 'timed_out';
  if (info.reason === 'interrupt' || info.decision === 'cancel') return 'cancelled';
  if (info.decision === 'acceptForSession') return 'accepted_session';
  if (info.decision === 'accept') return 'accepted';
  return 'declined';
}
