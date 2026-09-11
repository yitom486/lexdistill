import type {
  AgentAdapter,
  AgentSession,
  CreateSessionOptions,
  AgentInput,
  AgentEvent,
  ApprovalDecision,
  ContextSnapshot,
} from '@study-studio/agent-core';
import type { ToolDefinition } from '@study-studio/tool-core';
import {
  ok,
  err,
  isOk,
  type Result,
  BusinessError,
  translateToBusinessError,
} from '@study-studio/shared';
import { CodexAppServerConnection } from './app-server-client.js';
import { buildTurnInputItems, materializePngAttachments } from './image-attachments.js';
import {
  toolsToDynamicSpecs,
  resolveToolName,
  sanitizeToolName,
} from './tools-bridge.js';
import type {
  CodexAppServerConfig,
  CodexAccountStatus,
  CodexModelInfo,
  CodexThreadSummary,
  CodexThreadItemDto,
  CodexCollaborationModeDto,
  CodexQueuedSubmissionDto,
  CodexSkillDto,
  CodexRateLimitsDto,
  CodexMcpServerStatusDto,
  CodexRealtimeStartParams,
  CodexRealtimeAudioChunkDto,
  CodexRealtimeVoicesDto,
  CodexRealtimeCapabilityDto,
  CodexRealtimeTextRole,
  DynamicToolCallResponse,
} from './app-server-protocol.js';

export type ExternalToolExecutor = (
  toolName: string,
  input: Record<string, unknown>,
  ctx: { sessionId: string; userId: string }
) => Promise<unknown>;

export interface CodexAdapterOptions {
  config?: CodexAppServerConfig;
  /** Gateway 注入：执行 Server/Client Tools 并把结果回填 App Server */
  executeTool?: ExternalToolExecutor;
  /** Gateway 注入：转发 App Server 旁路通知（queue/changed 等） */
  onNotification?: (method: string, params: unknown) => void;
}

/** 用户未操作时自动 decline，避免 App Server 审批请求挂死 */
const APPROVAL_TIMEOUT_MS = 120_000;

function normalizeApprovalDecision(
  decision: boolean | ApprovalDecision
): ApprovalDecision {
  if (typeof decision === 'boolean') return decision ? 'accept' : 'decline';
  return decision;
}

/**
 * 真实 Codex App Server 适配器（stdio JSON-RPC）。
 * 无 CLI / 未登录时 createSession 失败，由 Gateway 回落本地旁路。
 * 认证：复用本机 CODEX_HOME / ~/.codex（与 VS Code Codex 插件同源）。
 */
export class CodexSession implements AgentSession {
  private activeTurnId: string | null = null;
  private abort: AbortController | null = null;
  private readonly pendingApprovals = new Map<
    string,
    (decision: ApprovalDecision, reason?: 'user' | 'timeout' | 'interrupt') => void
  >();
  private eventSink: ((ev: AgentEvent) => void) | null = null;

  constructor(
    public readonly sessionId: string,
    public readonly threadId: string,
    public readonly userId: string,
    private readonly connection: CodexAppServerConnection,
    private readonly executeTool?: ExternalToolExecutor,
    private readonly toolNameMap?: Map<string, string>
  ) {
    this.connection.setToolCallHandler(async (params) => {
      this.activeTurnId = params.turnId;
      const toolName = params.tool;
      const args =
        params.arguments && typeof params.arguments === 'object'
          ? (params.arguments as Record<string, unknown>)
          : {};
      try {
        if (!this.executeTool) {
          return failTool('Gateway 未注入工具执行器');
        }
        const candidates = resolveToolName(toolName, this.toolNameMap);
        let lastErr = 'tool not found';
        for (const name of candidates) {
          try {
            const result = await this.executeTool(name, args, {
              sessionId: this.sessionId,
              userId: this.userId,
            });
            return {
              contentItems: [{ type: 'inputText', text: JSON.stringify(result ?? null) }],
              success: true,
            } satisfies DynamicToolCallResponse;
          } catch (e) {
            lastErr = e instanceof Error ? e.message : String(e);
          }
        }
        return failTool(lastErr);
      } catch (e) {
        return failTool(e instanceof Error ? e.message : String(e));
      }
    });

    this.connection.setApprovalHandler(async (req) => {
      const expiresAt = Date.now() + APPROVAL_TIMEOUT_MS;
      this.eventSink?.({
        type: 'APPROVAL_REQUESTED',
        approvalId: req.approvalId,
        action: req.action,
        description: req.description,
        riskLevel: req.riskLevel,
        expiresAt,
      });
      return await new Promise<ApprovalDecision>((resolve) => {
        const timer = setTimeout(() => {
          if (!this.pendingApprovals.has(req.approvalId)) return;
          this.pendingApprovals.delete(req.approvalId);
          this.eventSink?.({
            type: 'APPROVAL_RESOLVED',
            approvalId: req.approvalId,
            decision: 'decline',
            reason: 'timeout',
          });
          resolve('decline');
        }, APPROVAL_TIMEOUT_MS);
        this.pendingApprovals.set(req.approvalId, (decision, reason = 'user') => {
          clearTimeout(timer);
          this.eventSink?.({
            type: 'APPROVAL_RESOLVED',
            approvalId: req.approvalId,
            decision,
            reason,
          });
          resolve(decision);
        });
      });
    });
  }

  public async *send(input: AgentInput): AsyncIterable<AgentEvent> {
    this.abort = new AbortController();
    const queue: AgentEvent[] = [];
    const waiter: { fn: (() => void) | null } = { fn: null };
    let turnDone = false;

    const ping = () => {
      const fn = waiter.fn;
      if (fn) fn();
    };

    this.eventSink = (ev) => {
      queue.push(ev);
      ping();
    };

    // 图片附件（Gateway 已知事实）：内存 PNG → 本轮临时文件 → localImage。
    // 物化失败直接报 ERROR，不发起 turn；临时文件在 finally 无条件删除
    // （成功 / 失败 / 取消全覆盖），路径与内容永不记日志。
    const attachments = input.attachments ?? [];
    let imagePaths: string[] = [];
    let cleanupAttachments: (() => Promise<void>) | null = null;
    if (attachments.length > 0) {
      const materialized = await materializePngAttachments(attachments);
      if (!isOk(materialized)) {
        yield { type: 'ERROR', error: materialized.error };
        this.eventSink = null;
        this.abort = null;
        return;
      }
      imagePaths = materialized.value.paths;
      cleanupAttachments = materialized.value.cleanup;
    }

    const turnOpts: {
      threadId: string;
      message: string;
      signal: AbortSignal;
      imagePaths?: string[];
      model?: string;
      effort?: string;
      approvalPolicy?: string;
      collaborationMode?: string;
      additionalContext?: Record<
        string,
        { value: string; kind: 'untrusted' | 'application' }
      >;
    } = {
      threadId: this.threadId,
      message: resolveTurnUserText(input),
      signal: this.abort.signal,
    };
    if (imagePaths.length > 0) turnOpts.imagePaths = imagePaths;
    const learnerCtx = buildLearnerContextEntry(input.contextSnapshot);
    if (learnerCtx) turnOpts.additionalContext = { 'study-studio': learnerCtx };
    if (input.turnOptions?.model) turnOpts.model = input.turnOptions.model;
    if (input.turnOptions?.effort) turnOpts.effort = input.turnOptions.effort;
    if (input.turnOptions?.approvalPolicy) {
      turnOpts.approvalPolicy = input.turnOptions.approvalPolicy;
    }
    if (input.turnOptions?.collaborationMode) {
      turnOpts.collaborationMode = input.turnOptions.collaborationMode;
    }

    const turnTask = (async () => {
      try {
        for await (const ev of this.connection.runTurn(turnOpts)) {
          queue.push(ev);
          ping();
        }
      } catch (rawError) {
        queue.push({
          type: 'ERROR',
          error: translateToBusinessError(rawError, 'CODEX_SESSION:send'),
        });
        ping();
      } finally {
        turnDone = true;
        ping();
      }
    })();

    try {
      while (!turnDone || queue.length > 0) {
        if (this.abort.signal.aborted) break;
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            waiter.fn = () => resolve();
            setTimeout(() => resolve(), 40);
          });
          waiter.fn = null;
          continue;
        }
        yield queue.shift()!;
      }
      await turnTask;
    } finally {
      this.eventSink = null;
      this.abort = null;
      if (cleanupAttachments) {
        try {
          await cleanupAttachments();
        } catch {
          // 临时文件删除失败不影响 turn 结果（且不得记路径）
        }
      }
    }
  }

  /** 消费 thread 队列下一项并流式返回（Codex thread/queue/start） */
  public async *sendQueued(options?: {
    queuedSubmissionId?: string;
    approvalPolicy?: string;
  }): AsyncIterable<AgentEvent> {
    this.abort = new AbortController();
    const queue: AgentEvent[] = [];
    const waiter: { fn: (() => void) | null } = { fn: null };
    let turnDone = false;

    const ping = () => {
      const fn = waiter.fn;
      if (fn) fn();
    };

    this.eventSink = (ev) => {
      queue.push(ev);
      ping();
    };

    const turnTask = (async () => {
      try {
        for await (const ev of this.connection.streamQueueStart({
          threadId: this.threadId,
          signal: this.abort!.signal,
          ...(options?.queuedSubmissionId
            ? { queuedSubmissionId: options.queuedSubmissionId }
            : {}),
          ...(options?.approvalPolicy ? { approvalPolicy: options.approvalPolicy } : {}),
        })) {
          queue.push(ev);
          ping();
        }
      } catch (rawError) {
        queue.push({
          type: 'ERROR',
          error: translateToBusinessError(rawError, 'CODEX_SESSION:sendQueued'),
        });
        ping();
      } finally {
        turnDone = true;
        ping();
      }
    })();

    try {
      while (!turnDone || queue.length > 0) {
        if (this.abort.signal.aborted) break;
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            waiter.fn = () => resolve();
            setTimeout(() => resolve(), 40);
          });
          waiter.fn = null;
          continue;
        }
        yield queue.shift()!;
      }
      await turnTask;
    } finally {
      this.eventSink = null;
      this.abort = null;
    }
  }

  public async submitToolResult(
    _callId: string,
    _result: unknown
  ): Promise<Result<void, BusinessError>> {
    return ok(undefined);
  }

  public async submitApproval(
    approvalId: string,
    decision: boolean | ApprovalDecision
  ): Promise<Result<void, BusinessError>> {
    const resolve = this.pendingApprovals.get(approvalId);
    if (!resolve) {
      return err(
        new BusinessError(
          'E_APPROVAL_NOT_FOUND',
          '找不到对应的审批请求，可能已超时或已处理。',
          'VALIDATION'
        )
      );
    }
    this.pendingApprovals.delete(approvalId);
    resolve(normalizeApprovalDecision(decision));
    return ok(undefined);
  }

  public async steer(message: string): Promise<Result<void, BusinessError>> {
    const text = message.trim();
    if (!text) {
      return err(
        new BusinessError('E_INVALID_INPUT', '引导消息不能为空。', 'VALIDATION')
      );
    }
    const turnId = this.activeTurnId ?? this.connection.getActiveTurnId();
    if (!turnId) {
      return err(
        new BusinessError(
          'E_NO_ACTIVE_TURN',
          '当前没有进行中的回复，无法注入引导。',
          'VALIDATION'
        )
      );
    }
    return this.connection.steer(this.threadId, turnId, text);
  }

  public async interrupt(): Promise<Result<void, BusinessError>> {
    this.abort?.abort();
    for (const [id, settle] of this.pendingApprovals) {
      this.pendingApprovals.delete(id);
      settle('cancel', 'interrupt');
    }
    if (this.activeTurnId) {
      return this.connection.interrupt(this.threadId, this.activeTurnId);
    }
    return ok(undefined);
  }

  public async close(): Promise<Result<void, BusinessError>> {
    this.abort?.abort();
    for (const [id, resolve] of this.pendingApprovals) {
      resolve('cancel');
      this.pendingApprovals.delete(id);
    }
    return ok(undefined);
  }
}

export class CodexAdapter implements AgentAdapter {
  public readonly id = 'codex-app-server';
  public readonly name = 'Codex App Server Adapter';

  /** 本 Adapter 支持 AgentInput.attachments 内存图片输入（转 localImage）。 */
  public supportsImageInput(): boolean {
    return true;
  }

  private connection: CodexAppServerConnection | null = null;
  private readonly options: CodexAdapterOptions;
  private readonly threadBySession = new Map<
    string,
    { threadId: string; userId: string; toolNameMap?: Map<string, string> }
  >();
  private notificationUnsub: (() => void) | null = null;
  private notificationHandler:
    | ((method: string, params: unknown) => void)
    | null = null;

  constructor(options: CodexAdapterOptions = {}) {
    this.options = options;
    if (options.onNotification) {
      this.notificationHandler = options.onNotification;
    }
  }

  public setNotificationHandler(
    handler: ((method: string, params: unknown) => void) | null
  ): void {
    this.notificationHandler = handler;
    this.wireNotificationHandler();
  }

  public async createSession(
    options: CreateSessionOptions
  ): Promise<Result<AgentSession, BusinessError>> {
    try {
      const conn = await this.ensureConnection();
      if (!isOk(conn)) return conn;

      const bridge = options.tools?.length
        ? toolsToDynamicSpecs(options.tools as ToolDefinition[])
        : { specs: [], nameMap: new Map<string, string>() };

      let threadId: string;

      if (options.resumeThreadId) {
        const resumed = await conn.value.resumeThread(options.resumeThreadId);
        if (!isOk(resumed)) return resumed;
        threadId = options.resumeThreadId;
      } else {
        const threadParams: {
          dynamicTools: typeof bridge.specs;
          model?: string;
          approvalPolicy?: string;
          ephemeral?: boolean;
        } = {
          dynamicTools: bridge.specs,
        };
        if (options.model) threadParams.model = options.model;
        if (options.approvalPolicy) threadParams.approvalPolicy = options.approvalPolicy;
        if (typeof options.ephemeral === 'boolean') {
          threadParams.ephemeral = options.ephemeral;
        }

        const threadRes = await conn.value.startThread(threadParams);
        if (!isOk(threadRes)) return threadRes;
        threadId = threadRes.value.threadId;
      }

      this.threadBySession.set(options.sessionId, {
        threadId,
        userId: options.userId,
        toolNameMap: bridge.nameMap,
      });

      return ok(
        new CodexSession(
          options.sessionId,
          threadId,
          options.userId,
          conn.value,
          this.options.executeTool,
          bridge.nameMap
        )
      );
    } catch (raw) {
      return err(translateToBusinessError(raw, 'CODEX:createSession'));
    }
  }

  public async resumeSession(
    sessionId: string
  ): Promise<Result<AgentSession, BusinessError>> {
    try {
      const meta = this.threadBySession.get(sessionId);
      if (!meta) {
        return err(
          new BusinessError(
            'E_CODEX_SESSION',
            '找不到可恢复的 Codex thread，请重新开始对话。',
            'AGENT_RUNTIME'
          )
        );
      }
      const conn = await this.ensureConnection();
      if (!isOk(conn)) return conn;
      const resumed = await conn.value.resumeThread(meta.threadId);
      if (!isOk(resumed)) return resumed;
      return ok(
        new CodexSession(
          sessionId,
          meta.threadId,
          meta.userId,
          conn.value,
          this.options.executeTool,
          meta.toolNameMap
        )
      );
    } catch (raw) {
      return err(translateToBusinessError(raw, 'CODEX:resumeSession'));
    }
  }

  public async listModels(includeHidden = false): Promise<Result<CodexModelInfo[], BusinessError>> {
    const conn = await this.ensureConnection();
    if (!isOk(conn)) return conn;
    return conn.value.listModels({ includeHidden });
  }

  public async listThreads(params?: {
    limit?: number;
    cursor?: string;
    searchTerm?: string;
  }): Promise<
    Result<{ threads: CodexThreadSummary[]; nextCursor: string | null }, BusinessError>
  > {
    const conn = await this.ensureConnection();
    if (!isOk(conn)) return conn;
    return conn.value.listThreads(params);
  }

  public async listThreadItems(params: {
    threadId: string;
    limit?: number;
  }): Promise<Result<{ items: CodexThreadItemDto[]; nextCursor: string | null }, BusinessError>> {
    const conn = await this.ensureConnection();
    if (!isOk(conn)) return conn;
    return conn.value.listThreadItems(params);
  }

  public async setThreadName(
    threadId: string,
    name: string
  ): Promise<Result<void, BusinessError>> {
    const conn = await this.ensureConnection();
    if (!isOk(conn)) return conn;
    return conn.value.setThreadName(threadId, name);
  }

  public async archiveThread(threadId: string): Promise<Result<void, BusinessError>> {
    const conn = await this.ensureConnection();
    if (!isOk(conn)) return conn;
    return conn.value.archiveThread(threadId);
  }

  public async compactThread(threadId: string): Promise<Result<void, BusinessError>> {
    const conn = await this.ensureConnection();
    if (!isOk(conn)) return conn;
    return conn.value.compactThread(threadId);
  }

  public async forkThread(params: {
    threadId: string;
    ephemeral?: boolean;
    model?: string;
  }): Promise<Result<{ threadId: string }, BusinessError>> {
    const conn = await this.ensureConnection();
    if (!isOk(conn)) return conn;
    return conn.value.forkThread(params);
  }

  public async queueAdd(params: {
    threadId: string;
    message: string;
    clientUserMessageId?: string;
  }): Promise<Result<CodexQueuedSubmissionDto, BusinessError>> {
    const conn = await this.ensureConnection();
    if (!isOk(conn)) return conn;
    return conn.value.queueAdd(params);
  }

  public async queueList(params: {
    threadId: string;
    limit?: number;
  }): Promise<
    Result<{ items: CodexQueuedSubmissionDto[]; nextCursor: string | null }, BusinessError>
  > {
    const conn = await this.ensureConnection();
    if (!isOk(conn)) return conn;
    return conn.value.queueList(params);
  }

  public async queueDelete(params: {
    threadId: string;
    queuedSubmissionId: string;
  }): Promise<Result<void, BusinessError>> {
    const conn = await this.ensureConnection();
    if (!isOk(conn)) return conn;
    return conn.value.queueDelete(params);
  }

  public async queueStart(params: {
    threadId: string;
    queuedSubmissionId?: string;
  }): Promise<Result<{ turnId: string }, BusinessError>> {
    const conn = await this.ensureConnection();
    if (!isOk(conn)) return conn;
    return conn.value.queueStart(params);
  }

  public async listSkills(params?: {
    forceReload?: boolean;
  }): Promise<Result<CodexSkillDto[], BusinessError>> {
    const conn = await this.ensureConnection();
    if (!isOk(conn)) return conn;
    return conn.value.listSkills(params);
  }

  public async getRateLimits(): Promise<Result<CodexRateLimitsDto, BusinessError>> {
    const conn = await this.ensureConnection();
    if (!isOk(conn)) return conn;
    return conn.value.readRateLimits();
  }

  public async listMcpServerStatus(params?: {
    cursor?: string;
    limit?: number;
  }): Promise<
    Result<{ servers: CodexMcpServerStatusDto[]; nextCursor: string | null }, BusinessError>
  > {
    const conn = await this.ensureConnection();
    if (!isOk(conn)) return conn;
    return conn.value.listMcpServerStatus(params);
  }

  /** EXPERIMENTAL realtime — 见 app-server-protocol 注释 */
  public async probeRealtimeCapability(): Promise<
    Result<CodexRealtimeCapabilityDto, BusinessError>
  > {
    const conn = await this.ensureConnection();
    if (!isOk(conn)) return conn;
    return conn.value.probeRealtimeCapability();
  }

  public async listRealtimeVoices(): Promise<Result<CodexRealtimeVoicesDto, BusinessError>> {
    const conn = await this.ensureConnection();
    if (!isOk(conn)) return conn;
    return conn.value.listRealtimeVoices();
  }

  public async startRealtime(
    params: CodexRealtimeStartParams
  ): Promise<Result<{ ok: true }, BusinessError>> {
    const conn = await this.ensureConnection();
    if (!isOk(conn)) return conn;
    return conn.value.startRealtime(params);
  }

  public async stopRealtime(threadId: string): Promise<Result<void, BusinessError>> {
    const conn = await this.ensureConnection();
    if (!isOk(conn)) return conn;
    return conn.value.stopRealtime(threadId);
  }

  public async appendRealtimeText(params: {
    threadId: string;
    text: string;
    role?: CodexRealtimeTextRole;
  }): Promise<Result<void, BusinessError>> {
    const conn = await this.ensureConnection();
    if (!isOk(conn)) return conn;
    return conn.value.appendRealtimeText(params);
  }

  public async appendRealtimeSpeech(params: {
    threadId: string;
    text: string;
  }): Promise<Result<void, BusinessError>> {
    const conn = await this.ensureConnection();
    if (!isOk(conn)) return conn;
    return conn.value.appendRealtimeSpeech(params);
  }

  public async appendRealtimeAudio(params: {
    threadId: string;
    audio: CodexRealtimeAudioChunkDto;
  }): Promise<Result<void, BusinessError>> {
    const conn = await this.ensureConnection();
    if (!isOk(conn)) return conn;
    return conn.value.appendRealtimeAudio(params);
  }

  public async listCollaborationModes(): Promise<
    Result<CodexCollaborationModeDto[], BusinessError>
  > {
    const conn = await this.ensureConnection();
    if (!isOk(conn)) return conn;
    return conn.value.listCollaborationModes();
  }

  public async getAccountStatus(): Promise<Result<CodexAccountStatus, BusinessError>> {
    const conn = await this.ensureConnection();
    if (!isOk(conn)) {
      // connect 失败也尽量返回结构化状态
      const fallback = new CodexAppServerConnection(this.options.config);
      return fallback.readAccountStatus();
    }
    return conn.value.readAccountStatus();
  }

  public async shutdown(): Promise<Result<void, BusinessError>> {
    const c = this.connection;
    this.connection = null;
    this.threadBySession.clear();
    this.notificationUnsub?.();
    this.notificationUnsub = null;
    if (!c) return ok(undefined);
    return c.close();
  }

  private wireNotificationHandler(): void {
    this.notificationUnsub?.();
    this.notificationUnsub = null;
    if (!this.connection || !this.notificationHandler) return;
    const handler = this.notificationHandler;
    this.notificationUnsub = this.connection.onNotification((method, params) => {
      handler(method, params);
    });
  }

  private async ensureConnection(): Promise<
    Result<CodexAppServerConnection, BusinessError>
  > {
    if (this.connection) return ok(this.connection);
    const conn = new CodexAppServerConnection(this.options.config);
    const ready = await conn.connect();
    if (!isOk(ready)) return ready;
    this.connection = conn;
    this.wireNotificationHandler();
    return ok(conn);
  }
}

function resolveTurnUserText(input: AgentInput): string {
  return String(input.message || '').trim();
}

/** 学情走 additionalContext，避免写进 userMessage 污染聊天记录 */
export function buildLearnerContextEntry(
  snapshot: ContextSnapshot | undefined
): { value: string; kind: 'application' } | undefined {
  if (!snapshot) return undefined;
  const lines = [
    `targetLanguage: ${snapshot.targetLanguage}`,
    `learnerLevel: ${snapshot.learnerLevel}`,
  ];
  if (snapshot.learnerDigest) {
    lines.push('learnerEvidence: ' + JSON.stringify(snapshot.learnerDigest));
    lines.push('interpretation: Recorded stage is not language certification. Study goal is a target, not achieved ability. Practice accuracy only describes observed exercises; untested skills are unknown. Collection counts and activity completion are not mastery. For NOVICE, teach small foundational units before testing; do not prescribe intensive reading by default.');
  }
  if (snapshot.focus?.surface) lines.push(`focus: ${snapshot.focus.surface}`);
  if (snapshot.focus?.skillTag) lines.push(`skill: ${snapshot.focus.skillTag}`);
  if (snapshot.learnerDigest?.topWeaknesses?.length) {
    lines.push(
      `weaknesses: ${snapshot.learnerDigest.topWeaknesses
        .slice(0, 3)
        .map((w) => w.skillId)
        .join(', ')}`
    );
  }
  lines.push(
    'instruction: Prefer calling registered learning.* / quiz.* / ui.* tools when helpful. Reply in zh-CN coaching tone unless the learner writes in the target language.'
  );
  return { value: lines.join('\n'), kind: 'application' };
}

function failTool(message: string): DynamicToolCallResponse {
  return {
    contentItems: [{ type: 'inputText', text: JSON.stringify({ error: message }) }],
    success: false,
  };
}

export { sanitizeToolName };
