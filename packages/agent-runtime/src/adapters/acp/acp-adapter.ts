import type { ToolDefinition } from '@study-studio/tool-core';
import { BusinessError, err, ok, type Result } from '@study-studio/shared';
import type { AgentAdapter, CreateSessionOptions } from '../../contracts/adapter.js';
import type { AgentSession } from '../../contracts/session.js';
import type { AgentEvent } from '../../contracts/event.js';
import type { AgentInput } from '../../contracts/context.js';

/**
 * Phase 0 spike：ACP 适配器骨架（未接入网关、不导出到包 public surface）。
 *
 * 设计要点（相对 Codex App Server 的差异）：
 * - 工具不走 in-process executeTool：由调用方经 `buildMcpServers` 把 ToolDefinition
 *   装成 MCP 服务器，`session/new|resume|load` 全程携带（ACP resume 带 mcpServers，
 *   旧线程工具不可刷新问题不存在——待 spike 实跑证明）。
 * - MCP 工具由 Agent 直调 MCP 服务器，宿主看不到 TOOL_CALL：`submitToolResult`
 *   明确拒绝（E_ACP_MCP_DIRECT），不伪造成功。
 * - AcpClient 经 `createClient` 注入（更新回调随构造传入做按会话分发）：
 *   agent-runtime 不新增第三方依赖。
 */

export interface AcpSessionHandleLike {
  readonly sessionId: string;
  prompt(text: string, options?: { timeoutMs?: number }): Promise<
    | { ok: true; value: unknown }
    | { ok: false; error: { code?: string; message: string } }
  >;
}

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
    onLog: (level: 'info' | 'warn' | 'error', message: string, meta?: unknown) => void;
    onStderrLine: (line: string) => void;
  }) => AcpClientLike;
  /** 把本轮 ToolDefinition 装成 ACP mcpServers（网关侧提供 HTTP 桥实现）。 */
  buildMcpServers: (tools: ToolDefinition[]) => Promise<unknown[]> | unknown[];
  /** 诊断用原始更新透出（spike/test）；生产不接。 */
  debugUpdates?: ((params: Record<string, unknown>) => void) | undefined;
  /** 子进程日志透出（连接抖动时定位死因；默认吞掉只在测试打印）。 */
  debugLog?: ((level: string, message: string) => void) | undefined;
}

function toBusinessError(code: string, message: string): BusinessError {
  return new BusinessError(code, message, 'AGENT_RUNTIME', true);
}

function sessionIdOf(params: Record<string, unknown>): string | null {
  const direct = params['sessionId'];
  if (typeof direct === 'string' && direct) return direct;
  const nested = params['session'] as Record<string, unknown> | undefined;
  if (nested && typeof nested['sessionId'] === 'string' && nested['sessionId']) {
    return nested['sessionId'] as string;
  }
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

class AcpAgentSession implements AgentSession {
  public readonly toolSpecs?: readonly {
    name: string; businessName: string; description: string; inputSchema: Record<string, unknown>;
  }[];
  public readonly sessionId: string;
  public readonly threadId?: string;

  private readonly updates: Record<string, unknown>[] = [];
  private waiters: Array<() => void> = [];
  private promptDone = false;

  constructor(
    sessionId: string,
    acpSessionId: string,
    private readonly handle: AcpSessionHandleLike,
    toolSpecs: NonNullable<AcpAgentSession['toolSpecs']>,
  ) {
    this.sessionId = sessionId;
    this.threadId = acpSessionId;
    this.toolSpecs = toolSpecs;
  }

  public pushUpdate(params: Record<string, unknown>): void {
    this.updates.push(params);
    const waiters = this.waiters;
    this.waiters = [];
    for (const wake of waiters) wake();
  }

  public notePromptDone(): void {
    this.promptDone = true;
    const waiters = this.waiters;
    this.waiters = [];
    for (const wake of waiters) wake();
  }

  private waitForUpdate(): Promise<void> {
    if (this.updates.length > 0 || this.promptDone) return Promise.resolve();
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
      await this.waitForUpdate();
      let next: Record<string, unknown> | undefined;
      while ((next = this.updates.shift())) {
        const chunk = chunkTextOf(next);
        if (chunk?.kind === 'text') yield { type: 'TEXT_DELTA', delta: chunk.text };
        else if (chunk?.kind === 'thought') yield { type: 'REASONING_DELTA', delta: chunk.text };
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

  public async submitApproval(): Promise<Result<void, BusinessError>> {
    return err(toBusinessError('E_ACP_APPROVAL_PENDING', 'spike 未实现审批挂起映射（Phase 1 接 onPermissionRequest）'));
  }

  public async steer(): Promise<Result<void, BusinessError>> {
    return err(toBusinessError('E_ACP_UNSUPPORTED', 'ACP spike 不支持 steer（显式拒绝，不静默）'));
  }

  public async interrupt(): Promise<Result<void, BusinessError>> {
    return err(toBusinessError('E_ACP_UNSUPPORTED', 'ACP spike 不支持 interrupt（显式拒绝，不静默）'));
  }

  public async close(): Promise<Result<void, BusinessError>> {
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
        onLog: (level, message) => { this.options.debugLog?.(level, message); },
        onStderrLine: (line) => { this.options.debugLog?.('stderr', line); },
      });
    }
    if (this.connectedOnce) return this.client;
    try {
      await this.connectOnce();
      this.connectedOnce = true;
    } catch (first) {
      // 握手抖动：杀掉毒进程冷启动重试一次（inkdown 同款自愈）；再失败如实抛。
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

  public async createSession(sessionOptions: CreateSessionOptions): Promise<Result<AgentSession, BusinessError>> {
    try {
      const client = await this.ensureClient();
      const tools = sessionOptions.tools ?? [];
      const mcpServers = await this.options.buildMcpServers(tools);
      const opened = await client.createSession({
        ...(sessionOptions.resumeThreadId ? { resumeSessionId: sessionOptions.resumeThreadId } : {}),
        mcpServers,
      });
      if (!opened.ok) {
        return err(toBusinessError(opened.error.code ?? 'E_ACP_SESSION', `ACP 会话建立失败：${opened.error.message}`));
      }
      const handle = opened.value;
      const session = new AcpAgentSession(
        sessionOptions.sessionId,
        handle.sessionId,
        handle,
        tools.map(tool => ({ name: tool.name, businessName: tool.name, description: tool.description, inputSchema: {} })),
      );
      this.sessions.set(handle.sessionId, session);
      return ok(session);
    } catch (cause) {
      return err(cause instanceof BusinessError ? cause : toBusinessError('E_ACP_SESSION', String(cause)));
    }
  }

  public async resumeSession(): Promise<Result<AgentSession, BusinessError>> {
    return err(toBusinessError('E_ACP_UNSUPPORTED', 'spike 不支持无参 resumeSession（显式拒绝）'));
  }
}
