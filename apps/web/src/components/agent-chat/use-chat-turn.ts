import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useAgentContextUsageStore } from '../../stores/useAgentContextUsageStore.js';
import type { useAgentGateway } from '../../hooks/useAgentGateway.js';
import { markToolCallsDone } from '../../lib/chat-transcript.js';
import { sound } from '../../utils/audio.js';
import { buildTutorOfflineReply } from '../../copy/tutor-track-copy.js';
import { AGENT_QUERY_KEYS } from '../../queries/useAgentQueries.js';
import type { useQueryClient } from '@tanstack/react-query';
import type { ChatMessage, AgentTurnHealth } from './chat-shared.js';
import { usePreferencesStore } from '../../stores/usePreferencesStore.js';
import { makeMessageStreamHandlers } from './chat-stream-handlers.js';
import { useQueueDrain, resolveApprovalStatus } from './use-queue-drain.js';

/** P2-1 拆分 + R07：自由导师直接发送/重试/审批/中断；队列排空见 useQueueDrain。 */

/** 传输层英文错误转中文安抚（原文落气泡会吓到用户；右上重试入口保持可用）。 */
function friendlyTurnError(err: unknown, fallback: string): string {
  const e = err as { userMessage?: string; message?: string } | undefined;
  const raw = e?.userMessage || e?.message || '';
  if (!raw) return fallback;
  if (raw === 'Gateway is not connected' || /gateway.*not connected/i.test(raw)) {
    return '导师服务未连接，消息未发出；请检查连接后重试。';
  }
  return raw;
}

type Gateway = ReturnType<typeof useAgentGateway>;
type QueryClient = ReturnType<typeof useQueryClient>;

export interface ChatTurnDeps {
  gateway: Gateway;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setAgentTurnHealth: (h: AgentTurnHealth) => void;
  queueDrainRef: React.MutableRefObject<boolean>;
  lastCoachPromptRef: React.MutableRefObject<string | null>;
  snapshot: () => Record<string, unknown>;
  track: 'ja' | 'en' | 'ko';
  setInput: (v: string) => void;
  coachModelId: string;
  coachEffort: string;
  coachApprovalPolicy: string;
  coachThreadId: string;
  coachPersistThread: boolean;
  coachCollaborationMode: string;
  setCoachThreadId: (v: string) => void;
  queryClient: QueryClient;
  refetchAgentStatus: () => void;
}

export function useChatTurn(deps: ChatTurnDeps) {
  const turnEpochRef = useRef(0);
  const runningRef = useRef(false);
  const queueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveDeps = useRef(deps);
  liveDeps.current = deps;
  useEffect(() => () => {
    turnEpochRef.current++;
    if (queueTimerRef.current !== null) clearTimeout(queueTimerRef.current);
    if (runningRef.current) liveDeps.current.gateway.interruptTurn('coach');
  }, []);
  const {
    gateway,
    busy,
    setBusy,
    setMessages,
    setAgentTurnHealth,
    queueDrainRef,
    lastCoachPromptRef,
    snapshot,
    track,
    setInput,
    coachModelId,
    coachEffort,
    coachApprovalPolicy,
    coachThreadId,
    coachPersistThread,
    coachCollaborationMode,
    setCoachThreadId,
    queryClient,
    refetchAgentStatus,
  } = deps;

  const recordAgentTurnCompletion = useCallback(
    (data: {
      status?: 'COMPLETED' | 'INTERRUPTED' | 'FAILED';
      source?: string;
      // 新字段（优先）
      agentOutcome?: 'streamed' | 'fallback' | 'not_requested';
      agentFailureMessage?: string;
      // 旧字段（兼容旧网关）
      codexOutcome?: 'streamed' | 'fallback' | 'not_requested';
      codexFailureMessage?: string;
      // P3-C 结构化字段（优先）
      outcome?: 'streamed' | 'fallback' | 'not_requested';
      failure?: {
        code: string;
        userMessage: string;
        category: 'SESSION_CREATE' | 'STREAM' | 'QUEUE' | 'INTERRUPTED' | 'UNKNOWN';
        retryable?: boolean;
      };
      fromQueue?: boolean;
      contextUsage?: { used: number; size: number };
    }) => {
      if (data.contextUsage) {
        useAgentContextUsageStore.getState().setUsage(data.contextUsage);
      }
      if (data.status === 'INTERRUPTED') {
        setAgentTurnHealth({ state: 'idle' });
        return;
      }
      // P3-C：优先读结构化 outcome / failure，旧字段作为兜底
      const outcome = data.outcome ?? data.agentOutcome ?? data.codexOutcome;
      const failMessage =
        data.failure?.userMessage || data.agentFailureMessage || data.codexFailureMessage;
      if (outcome === 'streamed' || data.source === 'agent' || data.source === 'codex') {
        setAgentTurnHealth({ state: 'healthy' });
        return;
      }
      if (outcome === 'fallback') {
        setAgentTurnHealth({
          state: 'fallback',
          message: failMessage || 'AI 导师本轮未完成，已使用本地学习提示。',
        });
        void refetchAgentStatus();
        return;
      }
      if (data.status === 'FAILED' || data.failure) {
        setAgentTurnHealth({
          state: 'failed',
          message: failMessage || '本轮请求未完成，请重试。',
        });
        void refetchAgentStatus();
      }
    },
    [setAgentTurnHealth, refetchAgentStatus]
  );

  const { startQueuedTurn } = useQueueDrain({
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
  });

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text) return;

      // 生成中：注入 turn/steer，不新开一轮
      if (busy) {
        if (!gateway.isConnected) return;
        sound.playClick();
        setInput('');
        setMessages((prev) => [
          ...prev,
          { id: `steer_${Date.now()}`, role: 'user', text: `↗ ${text}` },
        ]);
        gateway.steerTurn?.(text, 'coach');
        return;
      }

      sound.playClick();
      setInput('');
      const userId = `u_${Date.now()}`;
      const aiId = `a_${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        { id: userId, role: 'user', text },
        { id: aiId, role: 'assistant', text: '', reasoning: '', streaming: true, toolCalls: [] },
      ]);
      setBusy(true);
      setAgentTurnHealth({ state: 'running' });
      lastCoachPromptRef.current = text;

      if (!gateway.isConnected) {
        const offline = buildTutorOfflineReply(track, text);
        setAgentTurnHealth({ state: 'failed', message: '导师服务未连接，消息未发出。' });
        setMessages((prev) =>
          prev.map((m) => (m.id === aiId ? { ...m, text: offline, streaming: false } : m))
        );
        setBusy(false);
        return;
      }

      const epoch = ++turnEpochRef.current;
      runningRef.current = true;
      const isCurrent = () => turnEpochRef.current === epoch;
      const stream = makeMessageStreamHandlers(aiId, setMessages, isCurrent);
      gateway.sendTurnStream({
        input: text,
        intent: 'FREE_COACH',
        contextSnapshot: snapshot(),
        agentOptions: {
          lane: 'coach',
          ephemeral: !coachPersistThread,
          ...(coachModelId ? { model: coachModelId } : {}),
          ...(coachEffort ? { effort: coachEffort } : {}),
          ...(coachApprovalPolicy ? { approvalPolicy: coachApprovalPolicy } : {}),
          ...(coachThreadId ? { threadId: coachThreadId } : {}),
          ...(coachCollaborationMode
            ? { collaborationMode: coachCollaborationMode }
            : {}),
          ...(usePreferencesStore.getState().agentRuntimeId
            ? { runtimeId: usePreferencesStore.getState().agentRuntimeId }
            : {}),
        },
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
        onComplete: (data) => {
          if (!isCurrent()) return;
          const finishedEpoch = ++turnEpochRef.current;
          runningRef.current = false;
          recordAgentTurnCompletion(data);
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
        },
        onError: (err) => {
          if (!isCurrent()) return;
          turnEpochRef.current++;
          runningRef.current = false;
          const msg = friendlyTurnError(err, '导师服务暂时不可用，请稍后重试。');
          setAgentTurnHealth({ state: 'failed', message: msg });
          void refetchAgentStatus();
          setMessages((prev) =>
            prev.map((m) => (m.id === aiId ? { ...m, text: msg, streaming: false } : m))
          );
          setBusy(false);
        },
      });
    },
    [
      busy,
      gateway,
      setInput,
      setMessages,
      setBusy,
      setAgentTurnHealth,
      lastCoachPromptRef,
      track,
      snapshot,
      coachPersistThread,
      coachModelId,
      coachEffort,
      coachApprovalPolicy,
      coachThreadId,
      coachCollaborationMode,
      setCoachThreadId,
      queryClient,
      startQueuedTurn,
      recordAgentTurnCompletion,
      refetchAgentStatus,
    ]
  );

  const retryLastAgentTurn = useCallback(() => {
    const prompt = lastCoachPromptRef.current;
    if (!prompt || busy) return;
    void send(prompt);
  }, [lastCoachPromptRef, busy, send]);

  const respondApproval = useCallback(
    (approvalId: string, decision: 'accept' | 'acceptForSession' | 'decline') => {
      sound.playClick();
      gateway.respondApproval(approvalId, decision);
      setMessages((prev) =>
        prev.map((m) =>
          m.approval?.approvalId === approvalId && m.approval
            ? {
                ...m,
                approval: {
                  ...m.approval,
                  status: resolveApprovalStatus({ decision }),
                },
              }
            : m
        )
      );
    },
    [gateway, setMessages]
  );

  const interrupt = useCallback(() => {
    turnEpochRef.current++;
    runningRef.current = false;
    if (queueTimerRef.current !== null) clearTimeout(queueTimerRef.current);
    queueTimerRef.current = null;
    sound.playClick();
    queueDrainRef.current = false;
    gateway.interruptTurn('coach');
    setBusy(false);
    setAgentTurnHealth({ state: 'idle' });
    setMessages((prev) =>
      prev.map((m) => m.approval?.status === 'pending'
        ? { ...m, approval: { ...m.approval, status: 'cancelled' } }
        : m.streaming ? { ...m, streaming: false } : m)
    );
  }, [queueDrainRef, gateway, setBusy, setAgentTurnHealth, setMessages]);

  return { recordAgentTurnCompletion, startQueuedTurn, send, retryLastAgentTurn, respondApproval, interrupt };
}
