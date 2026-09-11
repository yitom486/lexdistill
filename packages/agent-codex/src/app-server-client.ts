import {
  ok,
  err,
  isOk,
  type Result,
  BusinessError,
  translateToBusinessError,
} from '@study-studio/shared';
import type { AgentEvent } from '@study-studio/agent-core';
import { JsonRpcStdioClient } from './jsonrpc-stdio.js';
import {
  type CodexAppServerConfig,
  type DynamicToolCallParams,
  type DynamicToolCallResponse,
  type DynamicToolSpec,
  type ThreadStartParams,
  type ThreadStartResponse,
  type TurnInterruptParams,
  type TurnSteerParams,
  type TurnStartParams,
  type TurnStartResponse,
  loadCodexConfigFromEnv,
  buildCodexProcessEnv,
  type CodexAccountStatus,
  type CodexModelInfo,
  type CodexApprovalHandler,
  type CodexApprovalRequest,
  type CodexApprovalDecision,
  type CodexThreadSummary,
  type CodexThreadItemDto,
  type CodexCollaborationModeDto,
  type CodexQueuedSubmissionDto,
  type CodexSkillDto,
  type CodexRateLimitsDto,
  type CodexMcpServerStatusDto,
  type CodexRealtimeStartParams,
  type CodexRealtimeAudioChunkDto,
  type CodexRealtimeVoicesDto,
  type CodexRealtimeCapabilityDto,
  type CodexRealtimeTextRole,
  normalizeSandboxMode,
  normalizeApprovalPolicy,
} from './app-server-protocol.js';
import { mapAppServerNotificationToEvents } from './event-mapper.js';
import { buildTurnInputItems } from './image-attachments.js';
import {
  listModels,
  listThreads,
  listThreadItems,
  setThreadName,
  archiveThread,
  compactThread,
  forkThread,
  queueAdd,
  queueList,
  queueDelete,
  queueStart,
  listSkills,
  listCollaborationModes,
  readAccountStatus,
  readRateLimits,
  listMcpServerStatus,
  probeRealtimeCapability,
  listRealtimeVoices,
  startRealtime,
  stopRealtime,
  appendRealtimeText,
  appendRealtimeSpeech,
  appendRealtimeAudio,
} from './app-server/queries.js';

export type ToolCallHandler = (
  params: DynamicToolCallParams
) => Promise<DynamicToolCallResponse> | DynamicToolCallResponse;

/**
 * 单个 App Server 进程连接；可承载多个 Thread。
 */
export class CodexAppServerConnection {
  /** @internal 供 app-server/queries.ts 使用 */
  public readonly rpc = new JsonRpcStdioClient();
  private initialized = false;
  /** @internal 供 app-server/queries.ts 使用 */
  public readonly config: CodexAppServerConfig;
  private toolCallHandler: ToolCallHandler | null = null;
  private approvalHandler: CodexApprovalHandler | null = null;
  /** 当前 turn 的审批策略覆盖（never 则自动 accept） */
  private activeApprovalPolicy: string;
  /** 正在流式中的 turn id（供 steer / interrupt） */
  private activeTurnId: string | null = null;
  /** 连接级通知（含 idle 时 queue/changed 等） */
  private idleNotifyUnsub: (() => void) | null = null;
  private readonly idleNotifyHandlers = new Set<
    (method: string, params: unknown) => void
  >();

  constructor(config?: CodexAppServerConfig) {
    this.config = { ...loadCodexConfigFromEnv(), ...config };
    this.activeApprovalPolicy = normalizeApprovalPolicy(this.config.approvalPolicy);
  }

  /** 订阅 App Server 通知（不限于进行中的 turn） */
  public onNotification(
    handler: (method: string, params: unknown) => void
  ): () => void {
    this.idleNotifyHandlers.add(handler);
    return () => this.idleNotifyHandlers.delete(handler);
  }

  public setToolCallHandler(handler: ToolCallHandler | null): void {
    this.toolCallHandler = handler;
  }

  public setApprovalHandler(handler: CodexApprovalHandler | null): void {
    this.approvalHandler = handler;
  }

  public setActiveApprovalPolicy(policy?: string | null): void {
    this.activeApprovalPolicy = normalizeApprovalPolicy(
      policy ?? this.config.approvalPolicy
    );
  }

  public async connect(): Promise<Result<void, BusinessError>> {
    if (this.config.enabled === false) {
      return err(
        new BusinessError(
          'E_CODEX_DISABLED',
          '已关闭 Codex App Server（STUDY_STUDIO_CODEX=0）。',
          'AGENT_RUNTIME'
        )
      );
    }
    if (this.rpc.isConnected && this.initialized) return ok(undefined);

    const startOpts: {
      command: string;
      args: string[];
      cwd?: string;
      env?: NodeJS.ProcessEnv;
    } = {
      command: this.config.command || 'codex',
      args: this.config.args ?? ['app-server', '--listen', 'stdio://'],
      env: buildCodexProcessEnv(this.config),
    };
    if (this.config.cwd) startOpts.cwd = this.config.cwd;
    const startRes = await this.rpc.start(startOpts);
    if (!isOk(startRes)) return startRes;

    this.rpc.onServerRequest(async (req) => {
      if (req.method === 'item/tool/call') {
        const params = req.params as DynamicToolCallParams;
        if (!this.toolCallHandler) {
          return {
            contentItems: [
              {
                type: 'inputText',
                text: JSON.stringify({ error: 'No tool handler registered on Gateway' }),
              },
            ],
            success: false,
          } satisfies DynamicToolCallResponse;
        }
        return await this.toolCallHandler(params);
      }

      // 审批：never 自动放行；on-request / untrusted 交给 Gateway→前端
      if (
        req.method === 'item/commandExecution/requestApproval' ||
        req.method === 'item/fileChange/requestApproval' ||
        req.method === 'item/permissions/requestApproval' ||
        req.method === 'applyPatchApproval' ||
        req.method === 'execCommandApproval'
      ) {
        const policy = this.activeApprovalPolicy;
        if (policy === 'never') {
          return { decision: 'accept' satisfies CodexApprovalDecision };
        }
        if (!this.approvalHandler) {
          return { decision: 'decline' satisfies CodexApprovalDecision };
        }
        const params = (req.params ?? {}) as Record<string, unknown>;
        const approvalReq = buildApprovalRequest(req.method, params);
        const decision = await this.approvalHandler(approvalReq);
        return { decision };
      }

      if (req.method === 'currentTime/read') {
        return { isoTime: new Date().toISOString() };
      }

      throw new BusinessError(
        'E_CODEX_UNHANDLED_REQ',
        `未处理的 App Server 请求：${req.method}`,
        'AGENT_RUNTIME'
      );
    });

    const initRes = await this.rpc.request('initialize', {
      clientInfo: {
        name: 'study_studio_gateway',
        title: 'Lingua Studio Gateway',
        version: '0.1.0',
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    if (!isOk(initRes)) return initRes;

    const notified = this.rpc.notify('initialized');
    if (!isOk(notified)) return notified;

    this.initialized = true;
    if (!this.idleNotifyUnsub) {
      this.idleNotifyUnsub = this.rpc.onNotification((note) => {
        for (const h of this.idleNotifyHandlers) {
          try {
            h(note.method, note.params);
          } catch {
            // 旁路通知失败不拖垮连接
          }
        }
      });
    }
    return ok(undefined);
  }

  public async startThread(params?: {
    dynamicTools?: DynamicToolSpec[];
    model?: string;
    cwd?: string;
    sandbox?: string;
    approvalPolicy?: string;
    ephemeral?: boolean;
  }): Promise<Result<{ threadId: string }, BusinessError>> {
    const ready = await this.connect();
    if (!isOk(ready)) return ready;

    const body: ThreadStartParams = {
      model: params?.model ?? this.config.model ?? null,
      cwd: params?.cwd ?? this.config.cwd ?? null,
      sandbox: normalizeSandboxMode(params?.sandbox ?? this.config.sandbox),
      approvalPolicy: normalizeApprovalPolicy(
        params?.approvalPolicy ?? this.config.approvalPolicy
      ),
      ephemeral: params?.ephemeral ?? true,
      dynamicTools: params?.dynamicTools ?? null,
    };

    const res = await this.rpc.request<ThreadStartResponse>('thread/start', body);
    if (!isOk(res)) return res;
    const threadId = res.value?.thread?.id;
    if (!threadId) {
      return err(
        new BusinessError('E_CODEX_THREAD', 'thread/start 未返回 thread.id', 'AGENT_RUNTIME', true)
      );
    }
    return ok({ threadId });
  }

  public async resumeThread(threadId: string): Promise<Result<void, BusinessError>> {
    const ready = await this.connect();
    if (!isOk(ready)) return ready;
    const res = await this.rpc.request('thread/resume', { threadId });
    if (!isOk(res)) return res;
    return ok(undefined);
  }

  /**
   * 启动一轮 turn，并把通知流转为 AgentEvent。
   * 调用方负责执行 TOOL_CALL（通过 setToolCallHandler）并继续读流直至 COMPLETED。
   */
  public async *runTurn(params: {
    threadId: string;
    message: string;
    signal?: AbortSignal;
    /** 本轮临时图片绝对路径（Adapter 已物化；按序转为 localImage 输入）。 */
    imagePaths?: string[];
    model?: string;
    effort?: string;
    approvalPolicy?: string;
    collaborationMode?: string;
    additionalContext?: Record<
      string,
      { value: string; kind: 'untrusted' | 'application' }
    >;
  }): AsyncGenerator<AgentEvent, void, unknown> {
    const ready = await this.connect();
    if (!isOk(ready)) {
      yield { type: 'ERROR', error: ready.error };
      return;
    }

    this.setActiveApprovalPolicy(params.approvalPolicy ?? this.config.approvalPolicy);
    const turnBody: TurnStartParams = {
      threadId: params.threadId,
      input: buildTurnInputItems(params.message, params.imagePaths ?? []),
    };
    if (params.additionalContext) {
      turnBody.additionalContext = params.additionalContext;
    }
    if (params.model) turnBody.model = params.model;
    if (params.effort) turnBody.effort = params.effort;
    if (params.approvalPolicy) {
      turnBody.approvalPolicy = normalizeApprovalPolicy(params.approvalPolicy);
    }
    if (params.collaborationMode) {
      const mode =
        params.collaborationMode === 'plan' || params.collaborationMode === 'default'
          ? params.collaborationMode
          : 'default';
      turnBody.collaborationMode = {
        mode,
        settings: {
          model: params.model ?? this.config.model ?? '',
          reasoning_effort: params.effort ?? this.config.effort ?? null,
          developer_instructions: null,
        },
      };
    }
    if (!params.effort && this.config.effort) {
      turnBody.effort = this.config.effort;
    }

    const startRes = await this.rpc.request<TurnStartResponse>('turn/start', turnBody);
    if (!isOk(startRes)) {
      yield { type: 'ERROR', error: startRes.error };
      return;
    }
    const turnId = startRes.value?.turn?.id ?? null;
    yield* this.consumeTurnNotifications({
      threadId: params.threadId,
      turnId,
      ...(params.signal ? { signal: params.signal } : {}),
    });
  }

  /**
   * thread/queue/start — 启动队列项并流式消费该 turn。
   */
  public async *streamQueueStart(params: {
    threadId: string;
    queuedSubmissionId?: string;
    signal?: AbortSignal;
    approvalPolicy?: string;
  }): AsyncGenerator<AgentEvent, void, unknown> {
    const ready = await this.connect();
    if (!isOk(ready)) {
      yield { type: 'ERROR', error: ready.error };
      return;
    }

    this.setActiveApprovalPolicy(params.approvalPolicy ?? this.config.approvalPolicy);
    const body: Record<string, unknown> = { threadId: params.threadId };
    if (params.queuedSubmissionId) body.queuedSubmissionId = params.queuedSubmissionId;

    const startRes = await this.rpc.request<{ turn?: { id?: string } }>(
      'thread/queue/start',
      body
    );
    if (!isOk(startRes)) {
      yield { type: 'ERROR', error: startRes.error };
      return;
    }
    const turnId = startRes.value?.turn?.id ?? null;
    if (!turnId) {
      yield {
        type: 'ERROR',
        error: new BusinessError(
          'E_CODEX_QUEUE',
          'thread/queue/start 未返回 turn.id',
          'AGENT_RUNTIME',
          true
        ),
      };
      return;
    }
    yield* this.consumeTurnNotifications({
      threadId: params.threadId,
      turnId,
      ...(params.signal ? { signal: params.signal } : {}),
    });
  }

  /** 订阅 turn 通知直至 completed / abort / error */
  private async *consumeTurnNotifications(params: {
    threadId: string;
    turnId: string | null;
    signal?: AbortSignal;
  }): AsyncGenerator<AgentEvent, void, unknown> {
    const queue: AgentEvent[] = [];
    let wake: (() => void) | null = null;
    let done = false;
    let hadError = false;
    let turnId = params.turnId;
    let sawText = false;
    let lastFinal: string | undefined;

    const push = (ev: AgentEvent) => {
      if (ev.type === 'ERROR') {
        hadError = true;
        done = true;
      }
      if (ev.type === 'TEXT_DELTA' && ev.delta) sawText = true;
      if (ev.type === 'COMPLETED' && ev.finalOutput) {
        lastFinal = ev.finalOutput;
        if (sawText) {
          queue.push({ type: 'COMPLETED' });
        } else {
          queue.push(ev);
        }
      } else {
        queue.push(ev);
      }
      wake?.();
    };

    this.activeTurnId = turnId;

    const unsub = this.rpc.onNotification((note) => {
      const mapped = mapAppServerNotificationToEvents(note.method, note.params);
      for (const ev of mapped) {
        if (ev.type === 'COMPLETED' && note.method === 'turn/completed') {
          done = true;
        }
        if (note.method === 'turn/started') {
          turnId = (note.params as { turn?: { id?: string } })?.turn?.id ?? turnId;
          this.activeTurnId = turnId;
        }
        push(ev);
      }
      if (note.method === 'turn/completed') {
        done = true;
        wake?.();
      }
    });

    const onAbort = () => {
      if (turnId) {
        void this.rpc.request('turn/interrupt', {
          threadId: params.threadId,
          turnId,
        } satisfies TurnInterruptParams);
      }
      done = true;
      wake?.();
    };
    params.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      while (!done || queue.length > 0) {
        if (params.signal?.aborted) break;
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            wake = resolve;
            setTimeout(resolve, 50);
          });
          wake = null;
          continue;
        }
        const next = queue.shift()!;
        yield next;
        if (next.type === 'ERROR') break;
        if (next.type === 'COMPLETED' && done && queue.length === 0) break;
      }

      if (hadError) {
        return;
      }
      if (!sawText && lastFinal) {
        yield { type: 'TEXT_DELTA', delta: lastFinal };
        yield { type: 'COMPLETED', finalOutput: lastFinal };
      } else if (!done) {
        yield { type: 'COMPLETED' };
      }
    } catch (e) {
      yield {
        type: 'ERROR',
        error: translateToBusinessError(e, 'CODEX_TURN'),
      };
    } finally {
      this.activeTurnId = null;
      unsub();
      params.signal?.removeEventListener('abort', onAbort);
    }
  }

  public getActiveTurnId(): string | null {
    return this.activeTurnId;
  }

  public async steer(
    threadId: string,
    turnId: string,
    message: string
  ): Promise<Result<void, BusinessError>> {
    const res = await this.rpc.request('turn/steer', {
      threadId,
      expectedTurnId: turnId,
      input: [{ type: 'text', text: message }],
    } satisfies TurnSteerParams);
    if (!isOk(res)) return res;
    return ok(undefined);
  }

  public async interrupt(threadId: string, turnId: string): Promise<Result<void, BusinessError>> {
    const res = await this.rpc.request('turn/interrupt', {
      threadId,
      turnId,
    } satisfies TurnInterruptParams);
    if (!isOk(res)) return res;
    return ok(undefined);
  }

  /** 实现已外迁 app-server/queries.ts */
  public async listModels(params?: {
    includeHidden?: boolean;
  }): Promise<Result<CodexModelInfo[], BusinessError>> {
    return listModels(this, params);
  }

  /** 实现已外迁 app-server/queries.ts */
  public async listThreads(params?: {
    limit?: number;
    cursor?: string;
    searchTerm?: string;
    archived?: boolean;
  }): Promise<
    Result<{ threads: CodexThreadSummary[]; nextCursor: string | null }, BusinessError>
  > {
    return listThreads(this, params);
  }

  /** 实现已外迁 app-server/queries.ts */
  public async listThreadItems(params: {
    threadId: string;
    limit?: number;
  }): Promise<Result<{ items: CodexThreadItemDto[]; nextCursor: string | null }, BusinessError>> {
    return listThreadItems(this, params);
  }

  /** 实现已外迁 app-server/queries.ts */
  public async setThreadName(
    threadId: string,
    name: string
  ): Promise<Result<void, BusinessError>> {
    return setThreadName(this, threadId, name);
  }

  /** 实现已外迁 app-server/queries.ts */
  public async archiveThread(threadId: string): Promise<Result<void, BusinessError>> {
    return archiveThread(this, threadId);
  }

  /** 实现已外迁 app-server/queries.ts */
  public async compactThread(threadId: string): Promise<Result<void, BusinessError>> {
    return compactThread(this, threadId);
  }

  /** 实现已外迁 app-server/queries.ts */
  public async forkThread(params: {
    threadId: string;
    ephemeral?: boolean;
    model?: string;
  }): Promise<Result<{ threadId: string }, BusinessError>> {
    return forkThread(this, params);
  }

  /** 实现已外迁 app-server/queries.ts */
  public async queueAdd(params: {
    threadId: string;
    message: string;
    clientUserMessageId?: string;
  }): Promise<Result<CodexQueuedSubmissionDto, BusinessError>> {
    return queueAdd(this, params);
  }

  /** 实现已外迁 app-server/queries.ts */
  public async queueList(params: {
    threadId: string;
    limit?: number;
  }): Promise<
    Result<{ items: CodexQueuedSubmissionDto[]; nextCursor: string | null }, BusinessError>
  > {
    return queueList(this, params);
  }

  /** 实现已外迁 app-server/queries.ts */
  public async queueDelete(params: {
    threadId: string;
    queuedSubmissionId: string;
  }): Promise<Result<void, BusinessError>> {
    return queueDelete(this, params);
  }

  /** 实现已外迁 app-server/queries.ts */
  public async queueStart(params: {
    threadId: string;
    queuedSubmissionId?: string;
  }): Promise<Result<{ turnId: string }, BusinessError>> {
    return queueStart(this, params);
  }

  /** 实现已外迁 app-server/queries.ts */
  public async listSkills(params?: {
    forceReload?: boolean;
  }): Promise<Result<CodexSkillDto[], BusinessError>> {
    return listSkills(this, params);
  }

  /** 实现已外迁 app-server/queries.ts */
  public async listCollaborationModes(): Promise<
    Result<CodexCollaborationModeDto[], BusinessError>
  > {
    return listCollaborationModes(this);
  }

  /** 实现已外迁 app-server/queries.ts */
  public async readAccountStatus(): Promise<Result<CodexAccountStatus, BusinessError>> {
    return readAccountStatus(this);
  }

  /** 实现已外迁 app-server/queries.ts */
  public async readRateLimits(): Promise<Result<CodexRateLimitsDto, BusinessError>> {
    return readRateLimits(this);
  }

  /** 实现已外迁 app-server/queries.ts */
  public async listMcpServerStatus(params?: {
    cursor?: string;
    limit?: number;
  }): Promise<
    Result<{ servers: CodexMcpServerStatusDto[]; nextCursor: string | null }, BusinessError>
  > {
    return listMcpServerStatus(this, params);
  }

  /** 实现已外迁 app-server/queries.ts */
  public async probeRealtimeCapability(): Promise<
    Result<CodexRealtimeCapabilityDto, BusinessError>
  > {
    return probeRealtimeCapability(this);
  }

  /** 实现已外迁 app-server/queries.ts */
  public async listRealtimeVoices(): Promise<Result<CodexRealtimeVoicesDto, BusinessError>> {
    return listRealtimeVoices(this);
  }

  /** 实现已外迁 app-server/queries.ts */
  public async startRealtime(
    params: CodexRealtimeStartParams
  ): Promise<Result<{ ok: true }, BusinessError>> {
    return startRealtime(this, params);
  }

  /** 实现已外迁 app-server/queries.ts */
  public async stopRealtime(threadId: string): Promise<Result<void, BusinessError>> {
    return stopRealtime(this, threadId);
  }

  /** 实现已外迁 app-server/queries.ts */
  public async appendRealtimeText(params: {
    threadId: string;
    text: string;
    role?: CodexRealtimeTextRole;
  }): Promise<Result<void, BusinessError>> {
    return appendRealtimeText(this, params);
  }

  /** 实现已外迁 app-server/queries.ts */
  public async appendRealtimeSpeech(params: {
    threadId: string;
    text: string;
  }): Promise<Result<void, BusinessError>> {
    return appendRealtimeSpeech(this, params);
  }

  /** 实现已外迁 app-server/queries.ts */
  public async appendRealtimeAudio(params: {
    threadId: string;
    audio: CodexRealtimeAudioChunkDto;
  }): Promise<Result<void, BusinessError>> {
    return appendRealtimeAudio(this, params);
  }

  public async close(): Promise<Result<void, BusinessError>> {
    this.initialized = false;
    this.idleNotifyUnsub?.();
    this.idleNotifyUnsub = null;
    this.idleNotifyHandlers.clear();
    return this.rpc.close();
  }
}

function buildApprovalRequest(
  method: string,
  params: Record<string, unknown>
): CodexApprovalRequest {
  const itemId = params.itemId != null ? String(params.itemId) : '';
  const approvalId = String(params.approvalId || itemId || `appr_${Date.now()}`);
  const command = params.command != null ? String(params.command) : '';
  const reason = params.reason != null ? String(params.reason) : '';
  const cwd = params.cwd != null ? String(params.cwd) : '';

  let action = method;
  if (method.includes('commandExecution') || method.includes('execCommand')) {
    action = 'exec';
  } else if (method.includes('fileChange') || method.includes('applyPatch')) {
    action = 'file_change';
  } else if (method.includes('permissions')) {
    action = 'permissions';
  }

  const description =
    reason ||
    command ||
    (typeof params.summary === 'string' ? params.summary : '') ||
    `Codex 请求批准：${method}`;

  const available = Array.isArray(params.availableDecisions)
    ? params.availableDecisions.map((d) => String(d))
    : undefined;

  const req: CodexApprovalRequest = {
    method,
    approvalId,
    action,
    description: [description, cwd ? `cwd: ${cwd}` : ''].filter(Boolean).join('\n'),
    riskLevel: action === 'exec' ? 'high' : 'medium',
  };
  if (params.threadId != null) req.threadId = String(params.threadId);
  if (params.turnId != null) req.turnId = String(params.turnId);
  if (itemId) req.itemId = itemId;
  if (available?.length) req.availableDecisions = available;
  return req;
}
