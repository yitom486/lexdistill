import { upsertToolCall } from '../../lib/chat-transcript.js';
import type { ChatMessage } from './chat-shared.js';

interface StreamHandlers {
  onDelta: (_delta: unknown, accumulated: string) => void;
  onReasoningDelta: (_delta: unknown, accumulated: string) => void;
  onToolCall: (info: { callId?: string; toolName: string }) => void;
}

/**
 * 轮次流式回调构造：增量正文/推理/工具记名，三处调用点（直接发送、队列消费）
 * 共用同一实现，避免漂移。调用方只传目标消息 id 与 setMessages。
 */
export function makeMessageStreamHandlers(
  aiMsgId: string,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  isCurrent: () => boolean = () => true
): StreamHandlers {
  return {
    onDelta: (_d, acc) => {
      if (!isCurrent()) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === aiMsgId ? { ...m, text: acc, streaming: true } : m))
      );
    },
    onReasoningDelta: (_d, acc) => {
      if (!isCurrent()) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === aiMsgId ? { ...m, reasoning: acc } : m))
      );
    },
    onToolCall: (info) => {
      if (!isCurrent()) return;
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== aiMsgId) return m;
          return { ...m, toolCalls: upsertToolCall(m.toolCalls ?? [], info) };
        })
      );
    },
  };
}
