import type { ToolDefinition } from '@study-studio/tool-core';
import { BusinessError, err, ok, type Result } from '@study-studio/shared';
import type { AgentAdapter, CreateSessionOptions } from '../../contracts/adapter.js';
import type { AgentSession } from '../../contracts/session.js';
import type { AgentEvent } from '../../contracts/event.js';
import type { AgentInput } from '../../contracts/context.js';

/**
 * ACP 适配器（Phase 1 可用版；包 public surface 仍不导出，接线前先过网关评审）。
 *
 * 与 Codex App Server 的关键差异：
 * - 工具不走 in-process executeTool：调用方经 `buildMcpServers` 把 ToolDefinition
 *   装成 MCP 服务器，`session/new|resume|load` 全程携带（resume 带工具，旧线程
 *   工具冻结问题不存在）。
 * - MCP 工具由 Agent 直调 MCP 服务器，宿主看不到 TOOL_CALL：`submitToolResult`
 *   明确拒绝（E_ACP_MCP_DIRECT），不伪造成功。
 * - 审批走 ACP `session/request_permission`：approvalPolicy never/缺席自动放行
 *   （与当前 vocab 链路零点击行为一致）；其余策略挂起等前端决策，120s 超时
 *   自动 decline（与 CodexAdapter APPROVAL_TIMEOUT_MS 同口径）。
 * - 中断/steer 明确拒绝（E_ACP_UNSUPPORTED）；单 adapter 只建连一次。
 */

export interface AcpSessionHandleLike {
  readonly sessionId: string;
  prompt(text: string, options?: { timeoutMs?: number }): Promise<
    | { ok: true; value: unknown }
    | { ok: false; error: { code?: string; message: string } }
  >;
}

export interface AcpPermissionPayload {
  sessionId?: string;
  toolCall?: { id?: string; title?: string; kind?: string };
  params: Record<string, unknown>;
}

export type AcpPermissionResolution =
  | { outcome: 'selected'; optionId: string }
  | { outcome: 'cancelled' };

export interface AcpClientLike {
  connect(): Promise<
    | { ok: true; value: unknown }
    | { ok: false; error: { code?: string; message: string } }
  >;
  createSession(options?: {
    resumeSessionId?: string | null;
    mcpServers?: unknown[];
  }): Promise<
    | { ok: true; value: AcpSessionHandleLike }
    | { ok: false; error: { code?: string; message: string } }
  >;
  disconnect(reason?: string): Promise<void>;
}

export interface AcpAdapterOptions {
  createClient: (callbacks: {
    onSessionUpdate: (params: Record<string, unknown>) => void;
    onPermissionRequest: (payload: AcpPermissionPayload) => Promise<AcpPermissionResolution>;
    onLog: (level: 'info' | 'warn' | 'error', message: string, meta?: unknown) => void;
    onStderrLine: (line: string) => void;
  }) => AcpClientLike;
  /** 把本轮 ToolDefinition 装成 ACP mcpServers（网关侧提供 HTTP 桥实现）。 */
  buildMcpServers: (
    tools: ToolDefinition[],
    context?: { userId: string; sessionId: string } | undefined,
  ) => Promise<unknown[]> | unknown[];
  /** 由 spec 反查桥 token（网关侧维护映射；会话 close 即 revoke）。 */
  resolveMcpToken?: ((spec: unknown) => string | undefined) | undefined;
  revokeMcpServer?: ((token: string) => void) | undefined;
  /** 诊断透出（spike/test）；生产不接。 */
  debugUpdates?: ((params: Record<string, unknown>) => void) | undefined;
  debugLog?: ((level: string, message: string) => void) | undefined;
}

const APPROVAL_TIMEOUT_MS = 120_000;

function toBusinessError(code: string, message: string): BusinessError {
  return new BusinessError(code, message, 'AGENT_RUNTIME', true);
}

/** 从 permission options 挑允许项（与 @yitom/acp-client pickAllowOptionId 同规则，免跨包依赖）。 */
function pickAllowOptionId(params: Record<string, unknown>): string | null {
  const options = params['options'];
  if (!Array.isArray(options)) return null;
  const idOf = (item: unknown): string | null => {
    if (!item || typeof item !== 'object') return null;
    const record = item as Record<string, unknown>;
    if (typeof record['optionId'] === 'string') return record['optionId'];
    if (typeof record['id'] === 'string') return record['id'];
    return null;
  };
  for (const item of options) {
    const id = idOf(item);
    const kind = item && typeof item === 'object' ? (item as Record<string, unknown>)['kind'] : undefined;
    if (id && typeof kind === 'string' && (kind.includes('allow') || kind === 'allow_once' || kind === 'allow_always')) return id;
  }
  for (const item of options) {
    const id = idOf(item);
    if (id) return id;
  }
  return null;
}

function sessionIdOf(params: Record<string, unknown>): string | null {
  const direct = params['sessionId'];
  if (typeof direct === 'string' && direct) return direct;
  return null;
}

function chunkTextOf(params: Record<string, unknown>): { kind: 'text' | 'thought'; text: string } | null {
  // 实测 codex-acp 形状：{ sessionId, update: { sessionUpdate: 'agent_message_chunk'|'agent_thought_chunk',
  //   content: { type: 'text', text } } }。只认此形状，不猜。
  const update = params['update'] as Record<string, unknown> | undefined;
  if (!update || typeof update !== 'object') return null;
  const content = update['content'] as Record<string, unknown> | undefined;
  const text = content && content['type'] === 'text' && typeof content['text'] === 'string' ? content['text'] : null;
  if (!text) return null;
  if (update['sessionUpdate'] === 'agent_thought_chunk') return { kind: 'thought', text };
  if (update['sessionUpdate'] === 'agent_message_chunk') return { kind: 'text', text };
  return null;
}

interface PendingApproval {
  approvalId: string;
  action: string;
  description: string;
  allowOptionId: string | null;
  resolve: (resolution: AcpPermissionResolution) => void;
  timer: ReturnType<typeof setTimeout>;
}

let approvalSeq = 0;

export class AcpAgentSession implements AgentSession {
  public readonly toolSpecs?: readonly {
    name: string; businessName: string; description: string; inputSchema: Record<string, unknown>;
  }[];
  public readonly sessionId: string;
  public readonly threadId?: string;

  private readonly updates: Record<string, unknown>[] = [];
  private readonly approvals: PendingApproval[] = [];
  private readonly inflight = new Map<string, PendingApproval>();
  private readonly resolvedEvents: AgentEvent[] = [];
  private mcpTokens: string[] = [];
  private waiters: Array<() => void> = [];
  private promptDone = false;
  private readonly autoApprove: boolean;

  constructor(
    sessionId: string,
    acpSessionId: string,
    private readonly handle: AcpSessionHandleLike,
    toolSpecs: NonNullable<AcpAgentSession['toolSpecs']>,
    approvalPolicy: string | undefined,
    private readonly mcpRevoke?: ((token: string) => void) | undefined,
  ) {
    this.sessionId = sessionId;
    this.threadId = acpSessionId;
    this.toolSpecs = toolSpecs;
    this.autoApprove = !approvalPolicy || approvalPolicy === 'never';
  }

  public attachMcpTokens(tokens: string[]): void {
    this.mcpTokens = [...tokens];
  }

  public pushUpdate(params: Record<string, unknown>): void {
    this.updates.push(params);
    this.wake();
  }

  public pushApproval(approval: PendingApproval): void {
    this.approvals.push(approval);
    this.wake();
  }

  public requestPermission(payload: AcpPermissionPayload): Promise<AcpPermissionResolution> {
    if (this.autoApprove) {
      const optionId = pickAllowOptionId(payload.params);
      return Promise.resolve(
        optionId ? { outcome: 'selected' as const, optionId } : { outcome: 'cancelled' as const },
      );
    }
    return new Promise<AcpPermissionResolution>((resolve) => {
      const approvalId = `acp-appr-${++approvalSeq}`;
      const approval: PendingApproval = {
        approvalId,
        action: payload.toolCall?.title || payload.toolCall?.kind || '工具调用',
        description: `Agent 请求${payload.toolCall?.title ? `“${payload.toolCall.title}”` : '执行工具'}`,
        allowOptionId: pickAllowOptionId(payload.params),
        resolve,
        timer: setTimeout(() => {
          this.settleApproval(approvalId, 'decline', 'timeout');
        }, APPROVAL_TIMEOUT_MS),
      };
      this.pushApproval(approval);
    });
  }

  public settleApproval(approvalId: string, decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel', reason: 'user' | 'timeout' | 'interrupt' = 'user'): boolean {
    const index = this.approvals.findIndex(item => item.approvalId === approvalId);
    const approval = index >= 0 ? this.approvals.splice(index, 1)[0]! : this.inflight.get(approvalId);
    if (!approval) return false;
    this.inflight.delete(approvalId);
    clearTimeout(approval.timer);
    if (decision === 'accept' || decision === 'acceptForSession') {
      if (approval.allowOptionId) approval.resolve({ outcome: 'selected', optionId: approval.allowOptionId });
      else approval.resolve({ outcome: 'cancelled' });
    } else {
      approval.resolve({ outcome: 'cancelled' });
    }
    this.resolvedEvents.push({ type: 'APPROVAL_RESOLVED', approvalId, decision, reason });
    this.wake();
    return true;
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const wake of waiters) wake();
  }

  public notePromptDone(): void {
    this.promptDone = true;
    this.wake();
  }

  private waitForActivity(): Promise<void> {
    if (this.updates.length > 0 || this.approvals.length > 0 || this.resolvedEvents.length > 0 || this.promptDone) return Promise.resolve();
    return new Promise<void>((resolve) => { this.waiters.push(resolve); });
  }

  public async *send(input: AgentInput): AsyncIterable<AgentEvent> {
    const message = typeof input.message === 'string' ? input.message : '';
    let finalText: string | null = null;
    let promptError: string | null = null;
    // 模型轮（尤其挂载 MCP 后首轮工具装载）经常超过 SDK 默认 120s：spike 给足，生产 Phase 再按 turn 预算收敛。
    void this.handle.prompt(message, { timeoutMs: 540_000 }).then(
      (result) => {
        if (!result.ok) {
          promptError = `${result.error.code ?? 'E_ACP_PROMPT'}: ${result.error.message}`;
        } else {
          const value = result.value as { text?: unknown; finalOutput?: unknown } | string | null | undefined;
          finalText =
            typeof value === 'string' ? value
            : typeof value?.text === 'string' ? value.text
            : typeof value?.finalOutput === 'string' ? value.finalOutput
            : JSON.stringify(value ?? '');
        }
        this.notePromptDone();
      },
      (cause: unknown) => {
        promptError = String(cause);
        this.notePromptDone();
      },
    );
    for (;;) {
      await this.waitForActivity();
      let next: Record<string, unknown> | undefined;
      while ((next = this.updates.shift())) {
        const chunk = chunkTextOf(next);
        if (chunk?.kind === 'text') yield { type: 'TEXT_DELTA', delta: chunk.text };
        else if (chunk?.kind === 'thought') yield { type: 'REASONING_DELTA', delta: chunk.text };
      }
      let approval: PendingApproval | undefined;
      while ((approval = this.approvals.shift())) {
        this.inflight.set(approval.approvalId, approval);
        yield {
          type: 'APPROVAL_REQUESTED',
          approvalId: approval.approvalId,
          action: approval.action,
          description: approval.description,
          riskLevel: 'medium',
          expiresAt: Date.now() + APPROVAL_TIMEOUT_MS,
        };
      }
      let resolved: AgentEvent | undefined;
      while ((resolved = this.resolvedEvents.shift())) {
        yield resolved;
      }
      if (this.promptDone) break;
    }
    if (promptError) {
      yield { type: 'ERROR', error: toBusinessError('E_ACP_PROMPT', promptError) };
      return;
    }
    yield { type: 'COMPLETED', finalOutput: finalText ?? '' };
  }

  public async submitToolResult(): Promise<Result<void, BusinessError>> {
    return err(toBusinessError('E_ACP_MCP_DIRECT', 'ACP 会话的工具由 Agent 直调 MCP 服务器，宿主不中转结果'));
  }

  public async submitApproval(
    approvalId: string,
    decision: boolean | 'accept' | 'acceptForSession' | 'decline' | 'cancel',
  ): Promise<Result<void, BusinessError>> {
    const normalized = decision === true ? 'accept' : decision === false ? 'decline' : decision;
    const settled = this.settleApproval(approvalId, normalized, 'user');
    if (!settled) return err(toBusinessError('E_ACP_APPROVAL_UNKNOWN', `未知审批 ${approvalId}（可能已超时自动拒绝）`));
    return ok(undefined);
  }

  public async steer(): Promise<Result<void, BusinessError>> {
    return err(toBusinessError('E_ACP_UNSUPPORTED', 'ACP 暂不支持 steer（显式拒绝，不静默）'));
  }

  public async interrupt(): Promise<Result<void, BusinessError>> {
    return err(toBusinessError('E_ACP_UNSUPPORTED', 'ACP 暂不支持 interrupt（显式拒绝，不静默）'));
  }

  public async close(): Promise<Result<void, BusinessError>> {
    for (const approval of this.approvals.splice(0)) {
      clearTimeout(approval.timer);
      approval.resolve({ outcome: 'cancelled' });
      this.resolvedEvents.push({ type: 'APPROVAL_RESOLVED', approvalId: approval.approvalId, decision: 'cancel', reason: 'interrupt' });
    }
    for (const approval of this.inflight.values()) {
      clearTimeout(approval.timer);
      approval.resolve({ outcome: 'cancelled' });
      this.resolvedEvents.push({ type: 'APPROVAL_RESOLVED', approvalId: approval.approvalId, decision: 'cancel', reason: 'interrupt' });
    }
    this.inflight.clear();
    for (const token of this.mcpTokens.splice(0)) {
      try { this.mcpRevoke?.(token); } catch { /* 撤销失败由 sweep 兜底 */ }
    }
    return ok(undefined);
  }
}

export class AcpAdapter implements AgentAdapter {
  public readonly id = 'acp';
  public readonly name = 'ACP (multi-runtime)';

  private client: AcpClientLike | null = null;
  private readonly sessions = new Map<string, AcpAgentSession>();
  private connectedOnce = false;

  constructor(private readonly options: AcpAdapterOptions) {}

  private async connectOnce(): Promise<void> {
    if (!this.client) {
      throw toBusinessError('E_ACP_CONNECT', 'ACP 客户端未创建');
    }
    const connected = await this.client.connect();
    if (!connected.ok) {
      throw toBusinessError(connected.error.code ?? 'E_ACP_CONNECT', `ACP 连接失败：${connected.error.message}`);
    }
  }

  private async ensureClient(): Promise<AcpClientLike> {
    if (!this.client) {
      this.client = this.options.createClient({
        onSessionUpdate: (params) => {
          this.options.debugUpdates?.(params);
          const id = sessionIdOf(params);
          if (id) this.sessions.get(id)?.pushUpdate(params);
        },
        onPermissionRequest: async (payload) => this.handlePermission(payload),
        onLog: (level, message) => { this.options.debugLog?.(level, message); },
        onStderrLine: (line) => { this.options.debugLog?.('stderr', line); },
      });
    }
    if (this.connectedOnce) return this.client;
    try {
      await this.connectOnce();
      this.connectedOnce = true;
    } catch (first) {
      // 握手抖动：杀掉毒进程冷启动重试一次；再失败如实抛。
      try { await this.client.disconnect('acp handshake retry'); } catch { /* 忽略清理失败 */ }
      await new Promise(resolve => setTimeout(resolve, 500));
      try {
        await this.connectOnce();
        this.connectedOnce = true;
      } catch {
        throw first;
      }
    }
    return this.client;
  }

  private handlePermission(payload: AcpPermissionPayload): Promise<AcpPermissionResolution> {
    const session = payload.sessionId ? this.sessions.get(payload.sessionId) : undefined;
    if (!session) {
      // 会话尚未登记（竞态）：保守拒绝，不静默放行。
      return Promise.resolve({ outcome: 'cancelled' });
    }
    return session.requestPermission(payload);
  }

  public async createSession(sessionOptions: CreateSessionOptions): Promise<Result<AgentSession, BusinessError>> {
    try {
      const client = await this.ensureClient();
      const tools = sessionOptions.tools ?? [];
      const mcpServers = await this.options.buildMcpServers(tools, {
        userId: sessionOptions.userId,
        sessionId: sessionOptions.sessionId,
      });
      const opened = await client.createSession({
        ...(sessionOptions.resumeThreadId ? { resumeSessionId: sessionOptions.resumeThreadId } : {}),
        mcpServers,
      });
      if (!opened.ok) {
        return err(toBusinessError(opened.error.code ?? 'E_ACP_SESSION', `ACP 会话建立失败：${opened.error.message}`));
      }
      const handle = opened.value;
      const tokens = this.options.resolveMcpToken
        ? mcpServers.map(spec => this.options.resolveMcpToken!(spec)).filter((token): token is string => !!token)
        : [];
      const session = new AcpAgentSession(
        sessionOptions.sessionId,
        handle.sessionId,
        handle,
        tools.map(tool => ({ name: tool.name, businessName: tool.name, description: tool.description, inputSchema: {} })),
        sessionOptions.approvalPolicy,
        this.options.revokeMcpServer,
      );
      session.attachMcpTokens(tokens);
      this.sessions.set(handle.sessionId, session);
      return ok(session);
    } catch (cause) {
      return err(cause instanceof BusinessError ? cause : toBusinessError('E_ACP_SESSION', String(cause)));
    }
  }

  public async resumeSession(): Promise<Result<AgentSession, BusinessError>> {
    return err(toBusinessError('E_ACP_UNSUPPORTED', '暂不支持无参 resumeSession（显式拒绝）'));
  }

  /** 关闭底层客户端（池释放用；会话级 close 不杀共享进程）。 */
  public async shutdown(reason = 'acp adapter shutdown'): Promise<void> {
    this.sessions.clear();
    if (this.client) {
      try { await this.client.disconnect(reason); } catch { /* 忽略清理失败 */ }
      finally { this.client = null; this.connectedOnce = false; }
    }
  }
}
