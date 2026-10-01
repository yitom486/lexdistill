import type { AgentEvent } from '../../contracts/index.js';
import { translateCodexNotificationParams, translateCodexRetryNotification, translateCodexTurnError } from './codex-error.js';

/**
 * 将 Codex App Server v2 通知映射为内部 AgentEvent。
 * 参考：item/agentMessage/delta、item/reasoning/*、item/started|completed、turn/completed
 */
export function mapAppServerNotificationToEvents(
  method: string,
  params: unknown
): AgentEvent[] {
  const events: AgentEvent[] = [];
  // App Server 通知 params 为弱结构 JSON；此处一次性收窄，后续只读 p。
  const p = (params ?? {}) as {
    delta?: unknown;
    text?: unknown;
    item?: {
      type?: unknown;
      id?: unknown;
      tool?: unknown;
      name?: unknown;
      arguments?: unknown;
      status?: unknown;
      success?: unknown;
      contentItems?: unknown;
      text?: unknown;
    };
    itemId?: unknown;
    turn?: unknown;
  };

  switch (method) {
    case 'item/agentMessage/delta': {
      const delta = String(p.delta ?? p.text ?? '');
      if (delta) events.push({ type: 'TEXT_DELTA', delta });
      break;
    }
    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta': {
      const delta = String(p.delta ?? p.text ?? '');
      if (delta) {
        events.push({ type: 'REASONING_DELTA', delta });
      }
      break;
    }
    case 'item/started': {
      const item = p.item;
      if (item?.type === 'reasoning') {
        events.push({ type: 'REASONING_STARTED' });
      }
      if (item?.type === 'dynamicToolCall') {
        events.push({
          type: 'TOOL_CALL_REQUESTED',
          callId: String(item.id || p.itemId || ''),
          toolName: String(item.tool || item.name || 'tool'),
          input: normalizeArgs(item.arguments),
        });
      }
      break;
    }
    case 'item/completed': {
      const item = p.item;
      if (item?.type === 'reasoning') {
        events.push({ type: 'REASONING_COMPLETED' });
      }
      if (item?.type === 'agentMessage' && item.text) {
        // 部分模型只在 completed 给全文；若已有 delta 则可能重复，由会话层去重
        events.push({ type: 'TEXT_DELTA', delta: '' }); // no-op marker
        events.push({
          type: 'COMPLETED',
          finalOutput: String(item.text),
        });
      }
      if (item?.type === 'dynamicToolCall') {
        events.push({
          type: 'TOOL_CALL_COMPLETED',
          callId: String(item.id || ''),
          result: {
            status: item.status,
            success: item.success,
            contentItems: item.contentItems,
          },
        });
      }
      break;
    }
    case 'turn/completed': {
      const turn = (p.turn ?? params) as { status?: unknown; error?: unknown };
      if (turn?.status === 'failed' || turn?.error) {
        events.push({
          type: 'ERROR',
          error: translateCodexTurnError(turn?.error ?? turn),
        });
        break;
      }
      events.push({ type: 'COMPLETED' });
      break;
    }
    case 'error': {
      const retry = translateCodexRetryNotification(params);
      if (retry) { events.push({ type: 'RUNTIME_RETRY', ...retry }); break; }
      const error = translateCodexNotificationParams(params);
      if (error) {
        events.push({ type: 'ERROR', error });
      }
      break;
    }
    default:
      break;
  }

  return events.filter((e) => !(e.type === 'TEXT_DELTA' && !e.delta));
}

function normalizeArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      return { raw };
    }
  }
  return {};
}

/** 兼容旧 RawCodexItem 映射（单测保留） */
export { mapCodexItemToAgentEvent } from './mapper.js';
