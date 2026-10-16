import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BusinessError } from '@lexdistill/shared';
import { getDefaultAgentDataDir } from '@yitom/acp-client';

/**
 * ACP 会话台账（网关自有；历史/排队走 acp-client 的那一半拼图）。
 *
 * - ACP 协议没有“列出会话”：能拉回 transcript（session/load 回放）但给不出 id 列表，
 *   id 索引只能由网关在建会话/回合完成时记录。本模块就是这份索引＋transcript＋队列。
 * - MCP 工具注入不需要这里操心：SDK 在 session/new|resume|load 全程携带 mcpServers，
 *   网关 `AcpAdapter` 经 `SessionToolBridge` 配发，会话 close 即 revoke。
 * - 持久化：单 JSON 文件（索引＋transcript 上限裁剪），IO 全程 try/catch fail-open；
 *   队列是瞬态（重启丢失，开机即空，如实行为不伪装）。
 */

export interface AcpConversationTurn {
  role: 'user' | 'assistant';
  text: string;
  at: number;
  source?: string;
}

/** 会话身份版本：首轮前置导师身份；老会话首次命中即补一次（见 ensureIdentityApplied）。 */
export const ACP_IDENTITY_VERSION = 1;

export interface AcpConversation {
  acpSessionId: string;
  userId: string;
  lane: string;
  runtimeId: string;
  title: string;
  preview: string;
  model?: string;
  effort?: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  /** 已前置身份的版本（缺席=0，老会话迁移时补一次）。 */
  identityV?: number;
  turns: AcpConversationTurn[];
}

export interface AcpQueuedMessage {
  id: string;
  message: string;
  createdAt: number;
}

export interface AcpLedgerData {
  version: 1;
  conversations: AcpConversation[];
}

export interface AcpLedgerBackend {
  load(): AcpLedgerData | null;
  save(data: AcpLedgerData): void;
}

const MAX_CONVERSATIONS = 100;
const MAX_TURNS_PER_CONVERSATION = 100;
const MAX_TEXT_CHARS = 4000;
const MAX_QUEUE_PER_THREAD = 20;

function clipText(text: string): string {
  const clean = String(text ?? '');
  return clean.length > MAX_TEXT_CHARS ? `${clean.slice(0, MAX_TEXT_CHARS)}…` : clean;
}

function previewOf(userText: string, agentText: string): string {
  const base = agentText.trim() || userText.trim();
  const flat = base.replace(/\s+/g, ' ');
  return flat.length > 120 ? `${flat.slice(0, 120)}…` : flat;
}

/** 默认文件后端：随应用数据目录走，路径可用 env 覆盖（测试/排障）。 */
export function defaultAcpLedgerBackend(): AcpLedgerBackend {
  const defaultPath = join(getDefaultAgentDataDir(), 'lexdistill-acp-conversations.json');
  const legacyPath = join(getDefaultAgentDataDir(), 'lingua-acp-conversations.json');
  const filePath =
    process.env.LEXDISTILL_ACP_LEDGER_PATH?.trim() ||
    process.env.LINGUA_ACP_LEDGER_PATH?.trim() ||
    defaultPath;
  let warned = false;
  const warnOnce = (error: unknown) => {
    if (warned) return;
    warned = true;
    console.warn(`[acp-ledger] 持久化不可用（仅内存，保持服务）: ${error instanceof Error ? error.message : String(error)}`);
  };
  return {
    load(): AcpLedgerData | null {
      try {
        let target = filePath;
        if (filePath === defaultPath && !existsSync(defaultPath) && existsSync(legacyPath)) {
          target = legacyPath;
        }
        const raw = readFileSync(target, 'utf8');
        const parsed = JSON.parse(raw) as Partial<AcpLedgerData>;
        if (parsed?.version !== 1 || !Array.isArray(parsed.conversations)) return null;
        return { version: 1, conversations: parsed.conversations };
      } catch {
        return null;
      }
    },
    save(data: AcpLedgerData): void {
      try {
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, JSON.stringify(data), 'utf8');
      } catch (error) {
        warnOnce(error);
      }
    },
  };
}

/** 纯内存后端（单测/禁用持久化）。 */
export function memoryAcpLedgerBackend(seed?: AcpLedgerData | null): AcpLedgerBackend {
  let stored: AcpLedgerData | null = seed ?? null;
  return {
    load: () => stored,
    save: (data) => {
      stored = data;
    },
  };
}

let queueSeq = 0;

export class AcpConversationLedger {
  private readonly conversations = new Map<string, AcpConversation>();
  private readonly queues = new Map<string, AcpQueuedMessage[]>();
  private readonly backend: AcpLedgerBackend;
  private loaded = false;

  constructor(backend?: AcpLedgerBackend) {
    this.backend = backend ?? defaultAcpLedgerBackend();
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    const data = this.backend.load();
    if (!data) return;
    for (const conversation of data.conversations) {
      if (conversation?.acpSessionId) {
        this.conversations.set(conversation.acpSessionId, {
          ...conversation,
          turns: Array.isArray(conversation.turns) ? conversation.turns : [],
        });
      }
    }
  }

  private persist(): void {
    this.backend.save({ version: 1, conversations: [...this.conversations.values()] });
  }

  private prune(): void {
    if (this.conversations.size <= MAX_CONVERSATIONS) return;
    const ordered = [...this.conversations.values()].sort((a, b) => a.updatedAt - b.updatedAt);
    for (const victim of ordered.slice(0, this.conversations.size - MAX_CONVERSATIONS)) {
      this.conversations.delete(victim.acpSessionId);
      this.queues.delete(victim.acpSessionId);
    }
  }

  public has(acpSessionId: string): boolean {
    if (!acpSessionId) return false;
    this.ensureLoaded();
    return this.conversations.has(acpSessionId);
  }

  public recordSessionCreated(input: {
    acpSessionId: string;
    userId: string;
    lane: string;
    runtimeId: string;
    model?: string;
    effort?: string;
  }): boolean {
    if (!input.acpSessionId) return false;
    this.ensureLoaded();
    const now = Date.now();
    const existing = this.conversations.get(input.acpSessionId);
    this.conversations.set(input.acpSessionId, {
      acpSessionId: input.acpSessionId,
      userId: input.userId,
      lane: input.lane,
      runtimeId: input.runtimeId,
      title: existing?.title || '新的对话',
      preview: existing?.preview || '',
      ...(input.model ? { model: input.model } : existing?.model ? { model: existing.model } : {}),
      ...(input.effort ? { effort: input.effort } : existing?.effort ? { effort: existing.effort } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      archived: existing?.archived ?? false,
      turns: existing?.turns ?? [],
    });
    this.prune();
    this.persist();
    return !existing;
  }

  public recordTurn(
    acpSessionId: string,
    turn: { user: string; agent: string; source?: string },
    meta?: { at?: number },
  ): void {
    if (!acpSessionId) return;
    this.ensureLoaded();
    const at = meta?.at ?? Date.now();
    let conversation = this.conversations.get(acpSessionId);
    if (!conversation) {
      conversation = {
        acpSessionId,
        userId: 'unknown',
        lane: 'coach',
        runtimeId: 'unknown',
        title: '新的对话',
        preview: '',
        createdAt: at,
        updatedAt: at,
        archived: false,
        turns: [],
      };
      this.conversations.set(acpSessionId, conversation);
    }
    if (turn.user.trim()) {
      conversation.turns.push({
        role: 'user',
        text: clipText(turn.user),
        at,
        ...(turn.source ? { source: turn.source } : {}),
      });
    }
    if (turn.agent.trim()) {
      conversation.turns.push({
        role: 'assistant',
        text: clipText(turn.agent),
        at,
        ...(turn.source ? { source: turn.source } : {}),
      });
    }
    while (conversation.turns.length > MAX_TURNS_PER_CONVERSATION) {
      conversation.turns.shift();
    }
    if (!conversation.title || conversation.title === '新的对话') {
      const firstUser = conversation.turns.find(item => item.role === 'user');
      if (firstUser) conversation.title = previewOf(firstUser.text, '');
    }
    conversation.preview = previewOf(turn.user, turn.agent) || conversation.preview;
    conversation.updatedAt = at;
    this.prune();
    this.persist();
  }

  /**
   * 首轮身份门：新会话返回 true；身份版本之前的老会话返回一次 true 并打标；
   * 其余 false。调用方据此决定本轮是否前置导师身份（常驻靠 resume）。
   */
  public ensureIdentityApplied(acpSessionId: string): boolean {
    if (!acpSessionId) return false;
    this.ensureLoaded();
    const conversation = this.conversations.get(acpSessionId);
    if (!conversation) return true;
    if ((conversation.identityV ?? 0) >= ACP_IDENTITY_VERSION) return false;
    conversation.identityV = ACP_IDENTITY_VERSION;
    conversation.updatedAt = Date.now();
    this.persist();
    return true;
  }

  public rename(acpSessionId: string, title: string): boolean {
    if (!acpSessionId) return false;
    this.ensureLoaded();
    const conversation = this.conversations.get(acpSessionId);
    if (!conversation) return false;
    conversation.title = title.trim() || conversation.title;
    conversation.updatedAt = Date.now();
    this.persist();
    return true;
  }

  public archive(acpSessionId: string): boolean {
    if (!acpSessionId) return false;
    this.ensureLoaded();
    const conversation = this.conversations.get(acpSessionId);
    if (!conversation) return false;
    conversation.archived = true;
    conversation.updatedAt = Date.now();
    this.persist();
    return true;
  }

  /** 历史列表（与旧 threads 同 DTO，前端零改动；归档的不再列出）。
   * 批处理 lane 默认排除（用户历史只看 coach/learning；批调用方传 lane='batch:*'）。 */
  public listConversations(limit = 50, opts?: { lanes?: readonly string[] }): Array<{
    id: string;
    preview: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    ephemeral: boolean;
  }> {
    this.ensureLoaded();
    const lanes = opts?.lanes ?? ['coach', 'learning'];
    return [...this.conversations.values()]
      .filter(item => !item.archived && lanes.includes(item.lane))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, Math.max(0, limit))
      .map(item => ({
        id: item.acpSessionId,
        preview: item.preview,
        name: item.title,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        ephemeral: false,
      }));
  }

  /** transcript（与旧 items 同形状：user_message/assistant_message，复用前端折叠逻辑）。 */
  public getTranscriptItems(acpSessionId: string, limit = 200): Array<{
    turnId: string;
    type: string;
    text: string;
  }> | null {
    if (!acpSessionId) return null;
    this.ensureLoaded();
    const conversation = this.conversations.get(acpSessionId);
    if (!conversation) return null;
    return conversation.turns
      .slice(-Math.max(0, limit))
      .map((turn, index) => ({
        turnId: `${acpSessionId}:t${index}`,
        type: turn.role === 'user' ? 'user_message' : 'assistant_message',
        text: turn.text,
      }));
  }

  public queueAdd(threadId: string, message: string): AcpQueuedMessage {
    const text = String(message ?? '').trim();
    if (!threadId || !text) {
      throw new BusinessError('E_INVALID_INPUT', '队列消息不能为空', 'VALIDATION');
    }
    this.ensureLoaded();
    const queue = this.queues.get(threadId) ?? [];
    if (queue.length >= MAX_QUEUE_PER_THREAD) {
      throw new BusinessError('E_QUEUE_FULL', '队列已满（20），请先消费再追加', 'VALIDATION');
    }
    const item: AcpQueuedMessage = {
      id: `q_${Date.now()}_${(queueSeq += 1)}`,
      message: clipText(text),
      createdAt: Date.now(),
    };
    queue.push(item);
    this.queues.set(threadId, queue);
    return item;
  }

  public queueList(threadId: string, limit = 20): AcpQueuedMessage[] {
    if (!threadId) return [];
    this.ensureLoaded();
    return (this.queues.get(threadId) ?? []).slice(0, Math.max(0, limit));
  }

  public queueCount(threadId: string): number {
    if (!threadId) return 0;
    this.ensureLoaded();
    return this.queues.get(threadId)?.length ?? 0;
  }

  /** 取出下一条（指定 id 或队首）；空返回 null。 */
  public queueConsume(threadId: string, queuedSubmissionId?: string): AcpQueuedMessage | null {
    if (!threadId) return null;
    this.ensureLoaded();
    const queue = this.queues.get(threadId) ?? [];
    if (queue.length === 0) return null;
    if (queuedSubmissionId) {
      const index = queue.findIndex(item => item.id === queuedSubmissionId);
      if (index < 0) return null;
      const [item] = queue.splice(index, 1);
      return item ?? null;
    }
    const [item] = queue.splice(0, 1);
    return item ?? null;
  }

  public queueRemove(threadId: string, queuedSubmissionId: string): boolean {
    if (!threadId || !queuedSubmissionId) return false;
    this.ensureLoaded();
    const queue = this.queues.get(threadId) ?? [];
    const index = queue.findIndex(item => item.id === queuedSubmissionId);
    if (index < 0) return false;
    queue.splice(index, 1);
    return true;
  }
}
