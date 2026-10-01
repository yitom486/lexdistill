import type {
  AgentAdapter,
  AgentSession,
  CreateSessionOptions,
  AgentInput,
  AgentEvent,
  ApprovalDecision,
  ContextSnapshot,
} from '../../contracts/index.js';
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
import { CodexConnectionManager } from './codex-connection-manager.js';
import { unlink } from 'node:fs/promises';
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
  CodexApprovalDecision,
  DynamicToolCallParams,
  DynamicToolCallResponse,
} from './app-server-protocol.js';
import {
  normalizeApprovalPolicy,
  resolveCodexBinary,
  resolveCodexHome,
} from './app-server-protocol.js';

export type ExternalToolExecutor = (
  toolName: string,
  input: Record<string, unknown>,
  ctx: { sessionId: string; userId: string; turnId?: string; callId?: string }
) => Promise<unknown>;

export interface CodexAdapterOptions {
  config?: CodexAppServerConfig;
  /** Gateway 注入：执行 Server/Client Tools 并把结果回填 App Server */
  executeTool?: ExternalToolExecutor;
  /** Gateway 注入：转发 App Server 旁路通知（queue/changed 等） */
  onNotification?: (method: string, params: unknown) => void;
  /**
   * 测试注入：直接使用既有连接（跳过 codex 二进制 spawn）。
   * 生产缺席，走正常 ensureConnection。
   */
  connection?: CodexAppServerConnection;
}

/**
 * 会话工具路由记录：一次工具回调必须且只能用归属会话的四件套执行。
 * closed 为 true 的记录一律 fail-closed（防关闭后旧身份复活）。
 */
interface SessionToolRoute {
  sessionId: string;
  userId: string;
  threadId: string;
  toolNameMap?: Map<string, string> | undefined;
  executeTool?: ExternalToolExecutor | undefined;
  noteTurn?: ((turnId: string) => void) | undefined;
  runningTurnOf?: (() => string | null) | undefined;
  /** 创建时声明的审批策略（CreateSessionOptions.approvalPolicy；缺席走连接默认）。 */
  createApprovalPolicy?: string | undefined;
  /** 当前 turn 覆盖策略读取口（send variables 写入；缺席回退创建策略）。 */
  turnPolicyOf?: (() => string | undefined) | undefined;
  /** 归属会话的审批机械入口（事件进其 sink，pending 只记其名下）。 */
  handleApproval?: (
    req: { approvalId: string; action: string; description: string; riskLevel: string }
  ) => Promise<ApprovalDecision>;
  /** pending 审批清扫口（close/shutdown 用）。 */
  cancelPending?: (() => void) | undefined;
  closed: boolean;
}

/** 归属不明时的 fail-closed 回执（静态文案，不回显任何 id/原文）。 */
const ORPHAN_TOOL_CALL_MESSAGE = 'No owning session for this tool call (fail-closed)';

/** thread/turn 指向不同会话时的 fail-closed 回执（静态文案，不回显任何 id/原文）。 */
const CONFLICT_TOOL_CALL_MESSAGE = 'Conflicting thread/turn ownership for this tool call (fail-closed)';

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
  /** 本会话累计物化的图片临时文件（会话级生命周期，close 时统一删除）。 */
  private readonly attachmentPaths: string[] = [];
  /**
   * 本 turn 覆盖的审批策略（send() 从 turnOptions 写入；缺席回退创建时策略）。
   * sticky 到下一次 send 覆盖为止——同会话内串 turn 不串会话，跨会话隔离由路由保证。
   */
  private turnPolicy?: string | undefined;

  constructor(
    public readonly sessionId: string,
    public readonly threadId: string,
    public readonly userId: string,
    private readonly connection: CodexAppServerConnection,
    private readonly executeTool?: ExternalToolExecutor,
    private readonly toolNameMap?: Map<string, string>,
    private readonly onClose?: () => void,
    public readonly toolSpecs: NonNullable<AgentSession['toolSpecs']> = []
  ) {
    // 注意：工具调用与审批处理器一律由 CodexAdapter 在连接层统一安装一次
    //（按 thread/turn 路由到归属会话），本构造不再逐会话覆盖连接处理器——
    // 否则后创建会话赢得全部回调（含审批）。
  }

  /**
   * @internal 路由回填本 turn（替代旧写法里 handler 闭包直接写 activeTurnId）。
   * 只由归属会话的回调触发，不再跨会话串扰 steer/interrupt 目标。
   */
  public noteActiveTurn(turnId: string): void {
    this.activeTurnId = turnId;
  }
  public currentRunningTurnId(): string | null { return this.abort ? this.activeTurnId : null; }

  /** @internal 本轮审批策略覆盖（send 进入时写入；缺席即清除回退创建策略）。 */
  public setTurnPolicy(policy: string | undefined): void {
    this.turnPolicy = policy;
  }

  /** @internal 当前 turn 有效策略（路由层读取；raw 透传由路由归一化）。 */
  public currentTurnPolicy(): string | undefined {
    return this.turnPolicy;
  }

  /**
   * @internal 处理已路由到本会话的审批请求（原构造内 handler 主体，原样下沉）。
   * 事件只进本会话的 sink，pending 只记本会话，超时自 decline。
   */
  public handleRoutedApproval(req: {
    approvalId: string;
    action: string;
    description: string;
    riskLevel: string;
  }): Promise<ApprovalDecision> {
    const expiresAt = Date.now() + APPROVAL_TIMEOUT_MS;
    this.eventSink?.({
      type: 'APPROVAL_REQUESTED',
      approvalId: req.approvalId,
      action: req.action,
      description: req.description,
      riskLevel: req.riskLevel,
      expiresAt,
    });
    return new Promise<ApprovalDecision>((resolve) => {
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
  }

  /** @internal 取消本会话全部 pending 审批（close/shutdown 清扫用）。 */
  public cancelPendingApprovals(reason: 'user' | 'timeout' | 'interrupt' = 'interrupt'): void {
    for (const [id, settle] of this.pendingApprovals) {
      this.pendingApprovals.delete(id);
      settle('cancel', reason);
    }
  }

  public async *send(input: AgentInput): AsyncIterable<AgentEvent> {
    this.activeTurnId = null;
    this.abort = new AbortController();
    // 本轮审批策略覆盖（缺席即清除，回退创建策略；只影响本会话各轮，不跨会话）。
    this.setTurnPolicy(input.turnOptions?.approvalPolicy);
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

    // 图片附件（Gateway 已知事实）：内存 PNG → 临时文件 → localImage。
    // 物化失败直接报 ERROR，不发起 turn。
    // 生命周期是会话级（非单轮）：同 thread 后续轮次仍会引用首轮图片
    //（真机实测：次轮工具调用时引擎重读首轮图；轮末删图直接导致调用失败）。
    // 全部临时文件在 close() 统一删除；路径与内容永不记日志。
    const attachments = input.attachments ?? [];
    let imagePaths: string[] = [];
    if (attachments.length > 0) {
      const materialized = await materializePngAttachments(attachments);
      if (!isOk(materialized)) {
        yield { type: 'ERROR', error: materialized.error };
        this.eventSink = null;
        this.abort = null;
        return;
      }
      imagePaths = materialized.value.paths;
      this.attachmentPaths.push(...imagePaths);
    }

    const turnOpts: {
      threadId: string;
      message: string;
      onTurnStarted?: (turnId: string) => void;
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
      onTurnStarted: turnId => { this.noteActiveTurn(turnId); input.onTurnStarted?.(turnId); },
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
    const turnId = this.activeTurnId ?? this.connection.getActiveTurnId(this.threadId);
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
    this.cancelPendingApprovals();
    if (this.activeTurnId) {
      return this.connection.interrupt(this.threadId, this.activeTurnId);
    }
    return ok(undefined);
  }

  public async close(): Promise<Result<void, BusinessError>> {
    this.abort?.abort();
    this.cancelPendingApprovals('user');
    // 会话级图片清理：同 thread 多轮共享首轮图片，轮末删图会导致后续调用失败；
    // 只在 close 删（失败静默吞掉，不记路径）。
    const paths = this.attachmentPaths.splice(0, this.attachmentPaths.length);
    if (paths.length > 0) {
      await Promise.allSettled(paths.map((p) => unlink(p)));
    }
    try {
      this.onClose?.();
    } catch {
      // 注销失败不影响关闭（路由表以 closed 标记兜底 fail-closed）
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

  private readonly connectionManager: CodexConnectionManager;
  /** 当前连接上的旁路通知订阅；连接实例本身由 Manager 拥有。 */
  private notificationConnection: CodexAppServerConnection | null = null;
  private readonly options: CodexAdapterOptions;
  private readonly threadBySession = new Map<
    string,
    { threadId: string; userId: string; toolNameMap?: Map<string, string> }
  >();
  /**
   * 连接级工具路由表（单例 handler + thread/turn 双键）。
   * 旧设计在每个 CodexSession 构造里覆盖 setToolCallHandler，后创建会话
   * 赢得全部回调；现改为连接只装一次，按归属会话路由。
   */
  private readonly toolRouteByThread = new Map<string, SessionToolRoute>();
  private readonly toolRouteByTurn = new Map<string, SessionToolRoute>();
  private toolRouterConn: CodexAppServerConnection | null = null;
  private notificationUnsub: (() => void) | null = null;
  private notificationHandler:
    | ((method: string, params: unknown) => void)
    | null = null;

  constructor(options: CodexAdapterOptions = {}) {
    this.options = options;
    this.connectionManager = new CodexConnectionManager({
      createConnection: () => this.createConnection(),
      ...(options.connection ? { initialConnection: options.connection } : {}),
    });
    if (options.onNotification) {
      this.notificationHandler = options.onNotification;
    }
  }

  /**
   * 连接级工具调用单例路由：threadId 主键，turnId 为已学习到的次键。
   * 查不到归属或记录已关闭 → fail-closed，绝不猜测 session/user。
   */
  private routeToolCall(
    params: DynamicToolCallParams
  ): Promise<DynamicToolCallResponse> | DynamicToolCallResponse {
    const byThread =
      typeof params.threadId === 'string' ? this.toolRouteByThread.get(params.threadId) : undefined;
    const byTurn =
      typeof params.turnId === 'string' && params.turnId
        ? this.toolRouteByTurn.get(params.turnId)
        : undefined;
    // P3.4B-FIX3：thread 与已学 turn 分属不同会话 → 立即 fail-closed。
    // 该分支不学映射、不 noteTurn、不执行（与审批矛盾分支同语义）。
    if (byThread && byTurn && byThread !== byTurn) {
      return failTool(CONFLICT_TOOL_CALL_MESSAGE);
    }
    const route = byThread ?? byTurn;
    if (!route || route.closed) {
      return failTool(ORPHAN_TOOL_CALL_MESSAGE);
    }
    const runningTurn = route.runningTurnOf?.();
    if (runningTurn && params.turnId !== runningTurn) return failTool('工具调用不属于当前运行轮次，已拒绝迟到调用');
    // 学到 turn 映射：同 thread 后续只带 turnId 也能找回（仍受 closed 门控）。
    if (typeof params.turnId === 'string' && params.turnId) {
      this.toolRouteByTurn.set(params.turnId, route);
    }
    try {
      route.noteTurn?.(params.turnId);
    } catch {
      // 回填失败不影响执行（steer 中断目标缺席即回退连接级）
    }
    return this.executeRoutedTool(route, params);
  }

  private async executeRoutedTool(
    route: SessionToolRoute,
    params: DynamicToolCallParams
  ): Promise<DynamicToolCallResponse> {
    const toolName = params.tool;
    const args =
      params.arguments && typeof params.arguments === 'object'
        ? (params.arguments as Record<string, unknown>)
        : {};
    try {
      if (!route.executeTool) {
        return failTool('Gateway 未注入工具执行器');
      }
      // P3.4B-FIX2 allowlist 执行门：sanitize/别名归一可以走，但归一后的
      // 最终名字必须属于本 route 创建时声明的集合（toolNameMap 值集）；
      // 空 tools 会话、未声明的全局注册工具一律到不了 executeTool（零调用）。
      const declared = new Set<string>(route.toolNameMap?.values() ?? []);
      const candidates = resolveToolName(toolName, route.toolNameMap).filter((name) =>
        declared.has(name)
      );
      if (candidates.length === 0) {
        return failTool('tool not declared for this session');
      }
      let lastErr = 'tool not found';
      for (const name of candidates) {
        try {
          const result = await route.executeTool(name, args, {
            sessionId: route.sessionId,
            userId: route.userId,
            turnId: params.turnId,
            callId: params.callId,
          });
          return {
            contentItems: [{ type: 'inputText', text: JSON.stringify(result ?? null) }],
            success: true,
          } satisfies DynamicToolCallResponse;
        } catch (e) {
          if (e instanceof BusinessError) return {
            success: false,
            contentItems: [{ type: 'inputText', text: JSON.stringify({
              code: e.code, message: e.userMessage, retryable: e.retryable,
              // Only explicit validation feedback is safe to expose; runtime/DB internal details are private.
              ...(e.category === 'VALIDATION' && ['E_LLM_', 'E_TOC_', 'E_SOURCE_', 'E_SUBMISSION_'].some(prefix => e.code.startsWith(prefix)) ? { issues: e.internalDetails } : {}),
            }) }],
          };
          lastErr = e instanceof Error ? e.message : String(e);
        }
      }
      return failTool(lastErr);
    } catch (e) {
      return failTool(e instanceof Error ? e.message : String(e));
    }
  }

  /** 连接上只装一次路由 handler（连接重建时重装）：工具 + 审批各一个单例。 */
  private ensureToolRouter(conn: CodexAppServerConnection): void {
    if (this.toolRouterConn === conn) return;
    conn.setToolCallHandler((params) => this.routeToolCall(params));
    conn.setApprovalHandler((req) => this.routeApproval(req));
    this.toolRouterConn = conn;
  }

  /**
   * 连接级审批单例路由：thread/turn 双键找归属会话，策略按“本轮覆盖 >
   * 创建声明 > 连接默认”逐级判定（旧全局 activeApprovalPolicy 已删除）。
   * - 找不到 / 已关闭 / thread 与 turn 指向不同记录 → decline，绝不猜测；
   * - 策略 never → 直接 accept，不打扰用户、不注册 pending；
   * - 其余 → 交归属会话的审批机械（事件进其 sink，pending 只记其名下）。
   */
  private async routeApproval(req: {    approvalId: string;
    threadId?: string;
    turnId?: string;
    action: string;
    description: string;
    riskLevel: string;
  }): Promise<CodexApprovalDecision> {
    const byThread =
      typeof req.threadId === 'string' && req.threadId
        ? this.toolRouteByThread.get(req.threadId)
        : undefined;
    const byTurn =
      typeof req.turnId === 'string' && req.turnId ? this.toolRouteByTurn.get(req.turnId) : undefined;
    if (byThread && byTurn && byThread !== byTurn) return 'decline';
    const route = byThread ?? byTurn;
    if (!route || route.closed) return 'decline';
    // 学到 turn 映射（与工具路径同语义；仍受 closed 门控）。
    if (typeof req.turnId === 'string' && req.turnId) {
      this.toolRouteByTurn.set(req.turnId, route);
    }
    const policy = normalizeApprovalPolicy(
      route.turnPolicyOf?.() ?? route.createApprovalPolicy ?? this.defaultApprovalPolicy()
    );
    if (policy === 'never') return 'accept';
    // 需要用户决定的审批却无会话机械可用 → fail-closed decline（绝不静默放行）。
    if (!route.handleApproval) return 'decline';
    try {
      return await route.handleApproval(req);
    } catch {
      return 'decline';
    }
  }

  /** 连接构造时 baked 的审批默认（env/配置），只读回退用。 */
  private defaultApprovalPolicy(): string {
    try {
      return this.toolRouterConn?.getConfiguredApprovalPolicy() ?? 'never';
    } catch {
      return 'never';
    }
  }

  /** 注册会话路由（create/resume 成功后调用；同 thread 后登记者覆盖先登记者）。 */
  private registerToolRoute(record: SessionToolRoute): void {
    this.toolRouteByThread.set(record.threadId, record);
  }

  /**
   * 注销会话路由（session.close 时调用）：compare-and-delete + turn 映射清扫。
   * 后关闭者不得注销先注册的新记录（同 thread 换代场景）。
   */
  private unregisterToolRoute(record: SessionToolRoute): void {
    if (this.toolRouteByThread.get(record.threadId) === record) {
      this.toolRouteByThread.delete(record.threadId);
    }
    for (const [turnId, current] of this.toolRouteByTurn) {
      if (current === record) this.toolRouteByTurn.delete(turnId);
    }
    record.closed = true;
  }

  public setNotificationHandler(
    handler: ((method: string, params: unknown) => void) | null
  ): void {
    this.notificationHandler = handler;
    this.wireNotificationHandler(this.notificationConnection);
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
          developerInstructions?: string;
        } = {
          dynamicTools: bridge.specs,
        };
        if (options.model) threadParams.model = options.model;
        if (options.approvalPolicy) threadParams.approvalPolicy = options.approvalPolicy;
        // P3.4B-FIX4：systemPrompt 经官方 developerInstructions 进线程。
        // 此前该字段被静默丢弃（adapter 内零引用），模型只能从用户消息尾部
        // 一句话得知工具契约——工具“可选”外观的主因。
        if (options.systemPrompt?.trim()) threadParams.developerInstructions = options.systemPrompt;
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

      this.ensureToolRouter(conn.value);
      const route: SessionToolRoute = {
        sessionId: options.sessionId,
        userId: options.userId,
        threadId,
        toolNameMap: bridge.nameMap,
        executeTool: this.options.executeTool,
        ...(options.approvalPolicy ? { createApprovalPolicy: options.approvalPolicy } : {}),
        closed: false,
      };
      const sess = new CodexSession(
        options.sessionId,
        threadId,
        options.userId,
        conn.value,
        this.options.executeTool,
        bridge.nameMap,
        () => this.unregisterToolRoute(route),
        bridge.specs.map(spec => ({ name: spec.name, businessName: bridge.nameMap.get(spec.name) ?? spec.name, description: spec.description, inputSchema: spec.inputSchema }))
      );
      route.noteTurn = (turnId: string) => sess.noteActiveTurn(turnId);
      route.runningTurnOf = () => sess.currentRunningTurnId();
      route.turnPolicyOf = () => sess.currentTurnPolicy();
      route.handleApproval = (req) => sess.handleRoutedApproval(req);
      route.cancelPending = () => sess.cancelPendingApprovals('interrupt');
      this.registerToolRoute(route);
      return ok(sess);
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
      this.ensureToolRouter(conn.value);
      const route: SessionToolRoute = {
        sessionId,
        userId: meta.userId,
        threadId: meta.threadId,
        toolNameMap: meta.toolNameMap,
        executeTool: this.options.executeTool,
        closed: false,
      };
      const sess = new CodexSession(
        sessionId,
        meta.threadId,
        meta.userId,
        conn.value,
        this.options.executeTool,
        meta.toolNameMap,
        () => this.unregisterToolRoute(route)
      );
      route.noteTurn = (turnId: string) => sess.noteActiveTurn(turnId);
      route.runningTurnOf = () => sess.currentRunningTurnId();
      route.turnPolicyOf = () => sess.currentTurnPolicy();
      route.handleApproval = (req) => sess.handleRoutedApproval(req);
      route.cancelPending = () => sess.cancelPendingApprovals('interrupt');
      this.registerToolRoute(route);
      return ok(sess);
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
      // 连接失败不再另起进程做 fallback（旧行为：readAccountStatus 内再
      // connect → 启动第二个 App Server，加剧启动期进程竞争）。
      // 直接由失败原因拼结构化未联动状态：零 spawn。
      const binary = this.options.config?.command || resolveCodexBinary();
      const codexHome = resolveCodexHome(this.options.config?.codexHome);
      const status: CodexAccountStatus = {
        linked: false,
        requiresOpenaiAuth: true,
        binary,
        message: conn.error.userMessage || conn.error.message,
      };
      if (codexHome) status.codexHome = codexHome;
      return ok(status);
    }
    return conn.value.readAccountStatus();
  }

  public async shutdown(): Promise<Result<void, BusinessError>> {
    this.threadBySession.clear();
    // 清扫全部路由记录的 pending 审批（会话可能未来得及 close；取唯一集防重入）。
    const seen = new Set<SessionToolRoute>();
    for (const record of [...this.toolRouteByThread.values(), ...this.toolRouteByTurn.values()]) {
      if (seen.has(record)) continue;
      seen.add(record);
      record.closed = true;
      try {
        record.cancelPending?.();
      } catch {
        // 清扫期错误忽略（连接即将关闭）
      }
    }
    this.toolRouteByThread.clear();
    this.toolRouteByTurn.clear();
    this.toolRouterConn = null;
    this.wireNotificationHandler(null);
    return this.connectionManager.shutdown();
  }

  private wireNotificationHandler(conn: CodexAppServerConnection | null): void {
    this.notificationConnection = conn;
    this.notificationUnsub?.();
    this.notificationUnsub = null;
    if (!conn || !this.notificationHandler) return;
    const handler = this.notificationHandler;
    this.notificationUnsub = conn.onNotification((method, params) => {
      handler(method, params);
    });
  }

  /**
   * 可覆盖的连接工厂（生产 spawn 真进程；测试注入计数替身）。
   * 拆出此工厂是为回归测试让路，不改变生产装配。
   */
  protected createConnection(): CodexAppServerConnection {
    return new CodexAppServerConnection(this.options.config);
  }

  private async ensureConnection(): Promise<
    Result<CodexAppServerConnection, BusinessError>
  > {
    const result = await this.connectionManager.getOrConnect();
    if (isOk(result)) this.wireNotificationHandler(result.value);
    return result;
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
