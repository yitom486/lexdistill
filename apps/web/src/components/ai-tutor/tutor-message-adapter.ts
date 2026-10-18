import type { ChatMessage as YitomChatMessage } from '@yitom/chat-core';
import { extractPredictedFollowUps } from '../../lib/followups.js';
import type { TutorStreamMessage } from './useTutorStream.js';

/**
 * 题目导师消息 → chat-core 标准时间线消息。
 *
 * 只做结构转换，不改变渲染语义：
 * - 用户/助手直转；思考过程独立成 thought 消息（由包渲染成可折叠块）；
 * - 完成态的预测块不进正文（`extractPredictedFollowUps` 会把「预测追问」从正文里摘掉，
 *   改由尾部插槽渲染成 chips）；流式期间保持原文，避免半截块闪烁。
 */
export function adaptTutorMessages(messages: TutorStreamMessage[]): YitomChatMessage[] {
  const out: YitomChatMessage[] = [];
  const now = Date.now();
  const stamp = (index: number) => now - (messages.length - index) * 1000;

  messages.forEach((message, index) => {
    const base = stamp(index);
    if (message.sender === 'user') {
      out.push({ id: message.id, role: 'user', text: message.text, createdAt: base });
      return;
    }

    if (message.reasoning?.trim()) {
      out.push({
        id: `${message.id}_thought`,
        role: 'thought',
        text: message.reasoning.trim(),
        streaming: Boolean(message.isStreaming && !message.text.trim()),
        createdAt: base,
      });
    }

    const settled = !message.isStreaming && Boolean(message.text.trim());
    const text = settled ? extractPredictedFollowUps(message.text).displayText : message.text;
    out.push({
      id: message.id,
      role: 'agent',
      text,
      streaming: Boolean(message.isStreaming),
      createdAt: base + 1,
    });
  });

  return out;
}
