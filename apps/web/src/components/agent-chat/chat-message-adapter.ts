import type { ChatMessage as YitomChatMessage } from '@yitom/chat-core';
import type { AgentApprovalPending } from '@yitom/chat-ui';
import type { ChatMessage as LexChatMessage } from './chat-shared.js';
import { stripTranscriptNoise } from '../../lib/chat-transcript.js';

/**
 * 将 LexDistill 的扁平聚合消息转换为 @yitom/chat-core / @yitom/chat-ui 标准时间线消息。
 *
 * 核心转换逻辑：
 * 1. user/system：直转对应角色，user 消息过滤 transcript 杂音；
 * 2. assistant：将可能内含的 reasoning（思考）、toolCalls（工具调用）和 text（回复正文）
 *    解耦展开为独立的 thought、tool、agent 消息，交由 @yitom/chat-ui 的 useChatTimeline
 *    在同一回合内自动编排为专业的工作记录折叠组（ChatActivityGroup）和 Streamdown 气泡；
 * 3. approval：当正在等待审批时提取为 AgentApprovalPending，已完成的作为工具状态保留。
 */
export function adaptLexMessagesToYitom(
  lexMessages: LexChatMessage[]
): {
  messages: YitomChatMessage[];
  pendingPermission: AgentApprovalPending | null;
} {
  const messages: YitomChatMessage[] = [];
  let pendingPermission: AgentApprovalPending | null = null;
  const now = Date.now();

  for (let i = 0; i < lexMessages.length; i++) {
    const m = lexMessages[i];
    if (!m) continue;

    if (m.role === 'user') {
      messages.push({
        id: m.id,
        role: 'user',
        text: stripTranscriptNoise(m.text),
        createdAt: now - (lexMessages.length - i) * 1000,
      });
      continue;
    }

    if (m.role === 'system') {
      messages.push({
        id: m.id,
        role: 'system',
        text: m.text,
        createdAt: now - (lexMessages.length - i) * 1000,
      });
      continue;
    }

    if (m.role === 'approval' && m.approval) {
      if (m.approval.status === 'pending') {
        pendingPermission = {
          requestId: hashStringToInt(m.approval.approvalId),
          summary: `${m.approval.action} · ${m.approval.description}`,
          options: [
            { optionId: 'accept', name: '允许', kind: 'allow' },
            { optionId: 'acceptForSession', name: '本会话允许', kind: 'allow_session' },
            { optionId: 'decline', name: '拒绝', kind: 'reject' },
          ],
        };
      } else {
        const statusText =
          m.approval.status === 'accepted'
            ? '已允许'
            : m.approval.status === 'accepted_session'
              ? '已允许（本会话）'
              : m.approval.status === 'timed_out'
                ? '已超时自动拒绝'
                : m.approval.status === 'cancelled'
                  ? '已取消'
                  : '已拒绝';
        messages.push({
          id: m.id,
          role: 'system',
          text: `[审批结果] ${m.approval.action}：${statusText}`,
          createdAt: now - (lexMessages.length - i) * 1000,
        });
      }
      continue;
    }

    // assistant 消息拆解为 thought -> tools -> agent
    const baseTime = now - (lexMessages.length - i) * 1000;

    // 1. 思考过程 (thought)
    if (m.reasoning && m.reasoning.trim()) {
      messages.push({
        id: `${m.id}_thought`,
        role: 'thought',
        text: m.reasoning.trim(),
        streaming: Boolean(m.streaming && !m.text.trim()),
        createdAt: baseTime,
      });
    }

    // 2. 工具调用 (tool)
    if (m.toolCalls && m.toolCalls.length > 0) {
      for (const call of m.toolCalls) {
        messages.push({
          id: call.id,
          role: 'tool',
          toolCallId: call.id,
          toolName: call.toolName,
          toolTitle: call.toolName,
          toolStatus: call.status === 'running' ? 'in-progress' : 'completed',
          toolContentText:
            typeof call.arguments === 'string'
              ? call.arguments
              : JSON.stringify(call.arguments, null, 2),
          text: '',
          createdAt: baseTime + 1,
        });
      }
    }

    // 3. 助手回复正文 (agent)
    // 即使 text 为空但在 streaming 中，也需挂载占位消息以呈现思考/等待态
    if (m.text || m.streaming) {
      messages.push({
        id: m.id,
        role: 'agent',
        text: m.text,
        streaming: Boolean(m.streaming),
        createdAt: baseTime + 2,
      });
    }
  }

  return { messages, pendingPermission };
}

/** 简单的字符串数字哈希，保证 requestId 为整数 */
function hashStringToInt(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}
