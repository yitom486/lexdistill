/** 流式回合里一条工具调用痕迹（可折叠回看参数） */
export interface ToolCallTrace {
  id: string;
  toolName: string;
  arguments?: Record<string, unknown>;
  status: 'running' | 'done';
}

/**
 * 去掉不应出现在聊天气泡里的注入块：
 * Gateway/Adapter 学情快照、Agent trunk-context、system 标签。
 */
export function stripTranscriptNoise(text: string): string {
  let out = String(text ?? '');
  out = out.replace(/\[StudyStudio Context\][^\n]*\n(?:[ \t]*- .+\n?)*/g, '');
  out = out.replace(/<trunk-context\b[^>]*>[\s\S]*?<\/trunk-context>/gi, '');
  out = out.replace(/<system(?:-reminder)?\b[^>]*>[\s\S]*?<\/system(?:-reminder)?>/gi, '');
  out = out.replace(/^\s*<[^>]*context[^>]*>[\s\S]*?<\/[^>]+>\s*/i, '');
  return out.replace(/^\s+|\s+$/g, '').replace(/\n{3,}/g, '\n\n');
}

export function upsertToolCall(
  calls: ToolCallTrace[],
  info: { callId?: string; toolName: string; arguments?: Record<string, unknown> }
): ToolCallTrace[] {
  const id = info.callId || `tool_${info.toolName}_${calls.length}`;
  const idx = calls.findIndex(
    (c) => c.id === id || (!info.callId && c.toolName === info.toolName && c.status === 'running')
  );
  const prev = idx >= 0 ? calls[idx] : undefined;
  const next: ToolCallTrace = {
    id: prev?.id ?? id,
    toolName: info.toolName,
    status: 'running',
  };
  const args = info.arguments ?? prev?.arguments;
  if (args && Object.keys(args).length) next.arguments = args;
  if (idx >= 0) {
    const copy = [...calls];
    copy[idx] = next;
    return copy;
  }
  return [...calls, next];
}

export function markToolCallsDone(calls: ToolCallTrace[] | undefined): ToolCallTrace[] | undefined {
  if (!calls?.length) return calls;
  return calls.map((c) => (c.status === 'done' ? c : { ...c, status: 'done' }));
}

export function formatToolArguments(args: Record<string, unknown> | undefined): string {
  if (!args || !Object.keys(args).length) return '（无参数）';
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

export interface ThreadItemLike {
  turnId: string;
  type: string;
  text?: string;
  id?: string;
  toolName?: string;
  arguments?: Record<string, unknown>;
}

export interface MappedChatBubble {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  reasoning?: string;
  source?: string;
  toolCalls?: ToolCallTrace[];
}

/** 按 turn 折叠历史 items：user 单独成泡，思考/工具/回复合成一条 assistant */
export function mapThreadItemsToBubbles(items: ThreadItemLike[]): MappedChatBubble[] {
  const result: MappedChatBubble[] = [];
  let current: MappedChatBubble | null = null;

  const flush = () => {
    if (!current) return;
    const hasBody =
      Boolean(current.text.trim()) ||
      Boolean(current.reasoning?.trim()) ||
      Boolean(current.toolCalls?.length);
    if (hasBody) result.push(current);
    current = null;
  };

  for (const item of items) {
    if (item.type === 'user_message' || item.type === 'userMessage') {
      flush();
      const text = stripTranscriptNoise(item.text ?? '');
      if (text) {
        result.push({
          id: item.id || `u_${item.turnId}_${result.length}`,
          role: 'user',
          text,
        });
      }
      continue;
    }

    if (!current || current.role !== 'assistant' || !current.id.startsWith(`a_${item.turnId}`)) {
      flush();
      current = {
        id: `a_${item.turnId || item.id || result.length}`,
        role: 'assistant',
        text: '',
        source: 'agent',
        toolCalls: [],
      };
    }

    if ((item.type === 'assistant_message' || item.type === 'agentMessage') && item.text) {
      const cleaned = stripTranscriptNoise(item.text);
      current.text = current.text ? `${current.text}\n${cleaned}` : cleaned;
    } else if (item.type === 'reasoning' && item.text) {
      current.reasoning = item.text;
    } else if (
      item.type === 'tool_call' || item.type === 'dynamicToolCall'
    ) {
      current.toolCalls = [
        ...(current.toolCalls ?? []),
        {
          id: item.id || `${item.type}_${item.turnId}_${current.toolCalls?.length ?? 0}`,
          toolName: item.toolName || 'tool',
          status: 'done',
          ...(item.arguments ? { arguments: item.arguments } : {}),
          ...(item.text && !item.arguments ? { arguments: { command: item.text } } : {}),
        },
      ];
    }
  }
  flush();
  return result;
}
