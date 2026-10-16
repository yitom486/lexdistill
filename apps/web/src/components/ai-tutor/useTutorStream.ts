import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { ContextSnapshot } from '@lexdistill/agent-runtime';
import type { useAgentGateway } from '../../hooks/useAgentGateway.js';
import { sound } from '../../utils/audio.js';
import { usePreferencesStore } from '../../stores/usePreferencesStore.js';

type Gateway = ReturnType<typeof useAgentGateway>;

export interface TutorStreamMessage {
  id: string;
  sender: 'ai' | 'user';
  text: string;
  timestamp: string;
  isStreaming?: boolean;
  reasoning?: string;
  /** 本轮 AI 输出来源（网关结构化执行摘要）：直出 / 本地回退 / 未请求模型 */
  source?: 'streamed' | 'fallback' | 'not_requested';
  /** 离线兜底内容：网关恢复后可一键重发转真 AI */
  offline?: boolean;
  failed?: boolean;
  retryInput?: string;
  /** 本轮模型调用过的工具（调用即记名，完成即标 done，过程透明）。 */
  toolCalls?: Array<{ callId?: string; toolName: string; done?: boolean }>;
}

interface UseTutorStreamOptions {
  gateway: Gateway;
  buildSnapshot: () => Partial<ContextSnapshot> | undefined;
}

// 与网关 agent-router.ts 的 lite 短问阈值对齐（prompt.length <= 24）。
const LITE_SHORT_PROMPT_MAX = 24;
// 追问室所有在线 EXPLAIN 发送统一追加：让模型预测用户接下来最可能问的短问题。
const PREDICTED_FOLLOWUP_SUFFIX =
  '\n\n【输出要求追加】回答末尾另起一段：先单独写一行【追问】，然后写 3 行，预测我接下来最可能想问的短问题（每行一个，以问号结尾，不展开讲解）。';

/**
 * 题目导师流引擎：消息列表/输入态/活动流 ID + 网关流式挂载。
 * 发送/重试/中断等编排留在容器，绘制下沉 ai-tutor 展示组件。
 */
export function useTutorStream({ gateway, buildSnapshot }: UseTutorStreamOptions) {
  const [messages, setMessages] = useState<TutorStreamMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const activeStreamMsgIdRef = useRef<string | null>(null);
  const streamEpoch = useRef(0);
  const gatewayRef = useRef(gateway);
  gatewayRef.current = gateway;
  useEffect(() => () => {
    streamEpoch.current++;
    if (activeStreamMsgIdRef.current) gatewayRef.current.interruptTurn('learning');
    activeStreamMsgIdRef.current = null;
  }, []);

  const attachStreamToMessage = useCallback(
    (aiMsgId: string, input: string, intent: 'EXPLAIN' | 'FREE_COACH' = 'EXPLAIN') => {
      if (!gateway.isConnected) return false;
      const epoch = ++streamEpoch.current;
      activeStreamMsgIdRef.current = aiMsgId;
      const isCurrent = () => streamEpoch.current === epoch;

      const threadId = usePreferencesStore.getState().learningThreadId;
      const setLearningThreadId = usePreferencesStore.getState().setLearningThreadId;

      return gateway.sendTurnStream({
        // 短问题走极速规则通道，不追加预测指令；长问题走模型，追加【追问】预测指令。
        input:
          input.length > LITE_SHORT_PROMPT_MAX ? input + PREDICTED_FOLLOWUP_SUFFIX : input,
        intent,
        contextSnapshot: buildSnapshot(),
        agentOptions: {
          lane: 'learning',
          ephemeral: false,
          ...(threadId ? { threadId } : {}),
        },
        onDelta: (_delta, accumulated) => {
          if (!isCurrent()) return;
          setMessages((prev) =>
            prev.map((m) => (m.id === aiMsgId ? { ...m, text: accumulated } : m))
          );
        },
        onReasoningDelta: (_delta, accumulated) => {
          if (!isCurrent()) return;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMsgId ? { ...m, reasoning: accumulated } : m
            )
          );
        },
        onToolCall: (info) => {
          if (!isCurrent()) return;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMsgId
                ? {
                    ...m,
                    toolCalls: [
                      ...(m.toolCalls ?? []),
                      {
                        ...(info.callId ? { callId: info.callId } : {}),
                        toolName: info.toolName,
                        done: false,
                      },
                    ],
                  }
                : m
            )
          );
        },
        onComplete: (data) => {
          if (!isCurrent()) return;
          streamEpoch.current++;
          sound.playCorrect();
          setIsTyping(false);
          activeStreamMsgIdRef.current = null;
          if (data.threadId) setLearningThreadId(data.threadId);
          const outcome = data.outcome ?? data.agentOutcome ?? data.codexOutcome;
          const source =
            outcome === 'streamed'
              ? ('streamed' as const)
              : outcome === 'fallback'
                ? ('fallback' as const)
                : ('not_requested' as const);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMsgId
                ? {
                    ...m,
                    text: data.finalOutput || m.text,
                    isStreaming: false,
                    source,
                    toolCalls: (m.toolCalls ?? []).map((t) => ({ ...t, done: true })),
                  }
                : m
            )
          );
        },
        onError: () => {
          if (!isCurrent()) return;
          streamEpoch.current++;
          setIsTyping(false);
          activeStreamMsgIdRef.current = null;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMsgId
                ? {
                    ...m,
                    text:
                      m.text ||
                      '导师回复失败，请检查连接后重试。',
                    isStreaming: false,
                    failed: true,
                    retryInput: input,
                  }
                : m
            )
          );
        },
      });
    },
    [gateway, buildSnapshot]
  );

  const interruptStream = useCallback(() => {
    streamEpoch.current++;
    setIsTyping(false);
    if (!activeStreamMsgIdRef.current) return;
    gatewayRef.current.interruptTurn('learning');
    const msgId = activeStreamMsgIdRef.current;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId
          ? {
              ...m,
              isStreaming: false,
              text: m.text ? m.text + '\n\n*(已终止生成)*' : '*(生成已取消)*',
            }
          : m
      )
    );
    activeStreamMsgIdRef.current = null;
  }, []);

  /** 离线兜底气泡一键重发：网关恢复后转真 AI，仍未连通则提示重连。 */
  const retryOfflineMessage = useCallback(
    (msg: { id: string; text: string; retryInput?: string }) => {
      if (!msg.retryInput || activeStreamMsgIdRef.current) return;
      if (!gateway.isConnected) {
        gateway.connect();
        toast.info('正在重新连接…连通后可再点一次重发。');
        return;
      }
      sound.playClick();
      setIsTyping(true);
      activeStreamMsgIdRef.current = msg.id;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msg.id ? { ...m, text: '', isStreaming: true, offline: false, failed: false } : m
        )
      );
      const sent = attachStreamToMessage(msg.id, msg.retryInput, 'EXPLAIN');
      if (!sent) {
        setIsTyping(false);
        activeStreamMsgIdRef.current = null;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msg.id ? { ...m, text: msg.text, isStreaming: false, offline: true } : m
          )
        );
        toast.error('仍未连接，请检查连接后重试。');
      }
    },
    [gateway, attachStreamToMessage]
  );

  return {
    messages,
    setMessages,
    isTyping,
    setIsTyping,
    activeStreamMsgIdRef,
    attachStreamToMessage,
    interruptStream,
    retryOfflineMessage,
  };
}
