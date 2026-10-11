import { SessionManager, type AgentLane } from './session/session-manager.js';
import { ContextBuilder } from './context/context-builder.js';
import { ToolRouter } from './router/tool-router.js';
import { SessionToolBridge } from './mcp/session-tool-bridge.js';
import { AcpAdapterPool } from '../infrastructure/acp/acp-adapter-pool.js';
import { resolveAgentRuntimeId } from './router/runtime-catalog.js';
import { checkProvenOptions } from './router/model-effort-guard.js';
import { batchLane } from './acp-batch/acp-batch-support.js';
import {
  AcpConversationLedger,
  type AcpLedgerBackend,
} from './acp-history/acp-conversation-ledger.js';
import { ToolRegistry } from '@study-studio/tool-core';
import type { AcpAdapter, AgentAdapter } from '@study-studio/agent-runtime';
import { ResponsesAdapter } from '@study-studio/agent-runtime';
import {
  type WsEnvelope,
  type EnrichJobSnapshot,
  WsEventTypes,
} from '@study-studio/protocol';
import {
  ok,
  err,
  type Result,
  BusinessError,
  generateId,
  isOk,
} from '@study-studio/shared';
import { type LearnerRepository } from '@study-studio/learner-core';
import {
  handleQuizGenerate,
  handleQuizGradeSubjective,
  handleQuizSubmit,
  type PracticeQuizSubmitWebSocketDependencies,
  type PracticeQuizToolWebSocketDependencies,
} from '../modules/practice/public.js';
import {
  handleProfileGet,
  handleProfileUpdate,
  handleTaskProgressGet,
  handleTaskActivityRecord,
  type LearningProgressWebSocketDependencies,
} from '../modules/learning-progress/public.js';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { EnrichJobRegistry, buildEnrichWsEnvelope } from '../modules/library/application/pdf-import/enrich-job-runner.js';
import { TextbookPipelineJobRegistry } from '../modules/library/application/pipeline-job-runner.js';
import { registerGatewayTools } from '../transport/tools/register-tools.js';
import { handleTurnSend } from './handlers/turn-handlers.js';
import { handleQueueStart } from './handlers/queue-handler.js';
import {
  handleApprovalRespond,
  handleTurnInterrupt,
  handleTurnSteer,
  handleToolResult,
} from './handlers/control-handlers.js';

export class GatewayServer {
  public readonly sessionManager = new SessionManager();
  public readonly contextBuilder = new ContextBuilder();
  public readonly toolRegistry = new ToolRegistry();
  public readonly toolRouter = new ToolRouter(this.toolRegistry);
  /** 默认 Agent 适配器（codex-acp 温复用池实例）。 */
  public readonly agentAdapter: AgentAdapter;
  /** 会话级工具 MCP 桥（ACP 多运行时底座；基址由启动层 listen 后绑定）。 */
  public readonly sessionToolBridge = new SessionToolBridge({
    execute: (toolName, args, context) => this.toolRegistry.execute(toolName, args, context),
    resolveBaseUrl: () => this.mcpBaseUrl,
  });
  public mcpBaseUrl = 'http://127.0.0.1:8080';
  /** ACP 适配器池（按 runtime 温复用；默认适配器即 codex-acp 池实例）。 */
  public readonly acpAdapterPool = new AcpAdapterPool({ bridge: this.sessionToolBridge });
  /** ACP 会话台账（历史/排队走 acp-client 的网关侧索引）。 */
  public readonly acpLedger: AcpConversationLedger;

  /**
   * 通用运行时选型：id 归一后一律走温复用池（未知 id 回落 codex-acp 默认）。
   */
  public resolveAgentAdapter(runtimeId?: string | undefined): AgentAdapter {
    return this.acpAdapterPool.get(resolveAgentRuntimeId(runtimeId));
  }

  /**
   * 批处理适配器选型（目录提炼等）：id 归一后一律走池，运行时选择即时生效。
   * 返回 lane 命名（用户历史默认排除批 lane）。
   */
  public resolveBatchAdapter(
    runtimeId: string | undefined,
    batchName: string,
  ): { adapter: AgentAdapter; batchLane: string | null } {
    const resolved = resolveAgentRuntimeId(runtimeId);
    return { adapter: this.acpAdapterPool.get(resolved), batchLane: batchLane(batchName) };
  }

  /**
   * 批处理模型/档位发前证伪（与聊天回合同一实现，见 model-effort-guard；
   * 域路由经此方法调用，不直引 runtime/，守模块边界）。
   */
  public async checkBatchModelEffort(
    runtimeId: string,
    model?: string,
    effort?: string,
  ): Promise<{ dropModel: boolean; dropEffort: boolean; warnings: string[] }> {
    const proven = await this.acpAdapterPool.getRuntimeOptions(runtimeId, model ? { model } : undefined);
    return checkProvenOptions(proven, model, effort);
  }

  /**
   * 建任务模型证伪（出题等冻结配置入口）：探针归一后的运行时目录。
   * 调用方将 dropModel 翻译为 400 指引。
   */
  public async checkRunModelEffort(
    runtimeId: string | undefined,
    model?: string,
  ): Promise<{ dropModel: boolean; warnings: string[] }> {
    const checked = await this.checkBatchModelEffort(resolveAgentRuntimeId(runtimeId), model, undefined);
    return { dropModel: checked.dropModel, warnings: checked.warnings };
  }
  /** 轻量旁路：快问快答（本地课程资产优先，未命中再走模型） */
  public readonly responsesAdapter = new ResponsesAdapter();
  public readonly learnerRepo: LearnerRepository;
  private readonly practiceWsDependencies: PracticeQuizSubmitWebSocketDependencies &
    PracticeQuizToolWebSocketDependencies;
  private readonly learningProgressWsDependencies: LearningProgressWebSocketDependencies;
  /** @internal 供 runtime/handlers/turn-handlers.ts 使用 */
  public readonly activeStreamControllers = new Map<string, AbortController>();
  /** sessionId → 当前进行中的 Agent lane（steer / interrupt / approval） */
  /** @internal 供 runtime/handlers/turn-handlers.ts 使用 */
  public readonly activeTurnLane = new Map<string, AgentLane>();
  /** sessionId → 持久 WS 下发（旁路通知用） */
  private readonly sessionEmitters = new Map<string, (env: WsEnvelope) => void>();
  /** 整本 enrich 后台任务注册表（进程内；已落库课天然续跑，重启不丢数据） */
  public readonly enrichJobs = new EnrichJobRegistry();
  public readonly pipelineJobs = new TextbookPipelineJobRegistry();

  constructor(
    learnerRepo?: LearnerRepository,
    /** @internal 测试注入 mock adapter；产品使用 codex-acp 池默认 */
    adapterOverride?: AgentAdapter,
    /** 台账持久化后端（缺席走文件；单测注入内存后端） */
    ledgerBackend?: AcpLedgerBackend
  ) {
    this.acpLedger = new AcpConversationLedger(ledgerBackend);
    this.learnerRepo = learnerRepo ?? new DrizzleLearnerRepository(':memory:');
    const repository = this.learnerRepo;
    this.practiceWsDependencies = {
      learnerRepo: repository,
      toolRegistry: this.toolRegistry,
      ...(repository instanceof DrizzleLearnerRepository
        ? { saveGeneratedQuestions: (questions) => repository.saveQuestions(questions) }
        : {}),
    };
    this.learningProgressWsDependencies = { learnerRepo: repository };

    // 默认适配器即 codex-acp 温复用池实例；各入口按 runtimeId 经
    // resolveAgentAdapter/resolveBatchAdapter 取池。
    this.agentAdapter = adapterOverride ?? this.acpAdapterPool.get('codex-acp');

    registerGatewayTools(this.toolRegistry, this.learnerRepo, this.agentAdapter);
  }

  public registerSessionEmit(
    sessionId: string,
    emit: (env: WsEnvelope) => void
  ): void {
    if (!sessionId) return;
    this.sessionEmitters.set(sessionId, emit);
  }

  public unregisterSessionEmit(sessionId: string | undefined): void {
    if (!sessionId) return;
    this.sessionEmitters.delete(sessionId);
  }

  /**
   * 向指定浏览器会话定向推送（enrich 后台任务进度用）。
   * 会话已断开时静默跳过——前端 GET 轮询会兜底补齐状态。
   */
  public emitToSession(sessionId: string, type: string, payload: unknown): void {
    const emit = this.sessionEmitters.get(sessionId);
    if (!emit) return;
    emit(
      buildEnrichWsEnvelope(sessionId, type, payload as EnrichJobSnapshot)
    );
  }

  /** Provider-neutral runtime status for the public Agent API. */
  public async getAgentStatus() {
    // 网关自有就绪态：各运行时认证态由 /api/agent/runtimes 的 configured 承载，
    // 回合失败大声报错；不以单运行时登录态卡住全运行时查询门禁。
    return ok({
      available: true,
      message: 'Agent runtime is ready.',
    });
  }

  public async listAgentSessions(params?: {
    limit?: number;
    cursor?: string;
    searchTerm?: string;
  }): Promise<Result<{
    sessions: Array<{
      id: string;
      preview: string;
      name: string | null;
      createdAt: number;
      updatedAt: number;
      ephemeral: boolean;
    }>;
    nextCursor: string | null;
  }, BusinessError>> {
    // 会话历史唯一来源：网关台账（ACP 会话 id 为键）。
    const sessions = this.acpLedger.listConversations(params?.limit ?? 50).map(item => ({
      id: item.id,
      preview: item.preview,
      name: item.name as string | null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      ephemeral: item.ephemeral,
    })).sort((a, b) => b.updatedAt - a.updatedAt);
    return ok({ sessions, nextCursor: null });
  }

  public async listAgentSessionItems(params: { sessionId: string; limit?: number }): Promise<Result<{
    items: Array<{
      turnId: string;
      type: string;
      text?: string;
      id?: string;
      toolName?: string;
      arguments?: Record<string, unknown>;
    }>;
    nextCursor: string | null;
  }, BusinessError>> {
    // 会话回放唯一来源：网关台账 transcript；未知 id 报不存在。
    const items = this.acpLedger.has(params.sessionId)
      ? this.acpLedger.getTranscriptItems(params.sessionId, params.limit ?? 200)
      : null;
    if (!items) {
      return err(new BusinessError('E_SESSION_NOT_FOUND', '会话不存在', 'VALIDATION'));
    }
    return ok({ items: items ?? [], nextCursor: null });
  }

  public async setAgentSessionName(sessionId: string, name: string) {
    if (!this.acpLedger.has(sessionId)) {
      return err(new BusinessError('E_SESSION_NOT_FOUND', '会话不存在', 'VALIDATION'));
    }
    const renamed = this.acpLedger.rename(sessionId, name);
    if (!renamed) {
      return err(new BusinessError('E_SESSION_NOT_FOUND', '会话不存在', 'VALIDATION'));
    }
    return ok(undefined);
  }

  public async archiveAgentSession(sessionId: string) {
    if (!this.acpLedger.has(sessionId)) {
      return err(new BusinessError('E_SESSION_NOT_FOUND', '会话不存在', 'VALIDATION'));
    }
    const archived = this.acpLedger.archive(sessionId);
    if (!archived) {
      return err(new BusinessError('E_SESSION_NOT_FOUND', '会话不存在', 'VALIDATION'));
    }
    return ok(undefined);
  }

  public async compactAgentSession(sessionId: string) {
    // ACP 无压缩原语：大声拒绝，不静默走错后端。
    if (!this.acpLedger.has(sessionId)) {
      return err(new BusinessError('E_SESSION_NOT_FOUND', '会话不存在', 'VALIDATION'));
    }
    return err(new BusinessError('E_ACP_UNSUPPORTED', 'ACP 会话暂不支持压缩（显式拒绝）', 'AGENT_RUNTIME'));
  }

  public async forkAgentSession(params: {
    sessionId: string;
    ephemeral?: boolean;
    model?: string;
  }) {
    // ACP 无 fork 原语：大声拒绝，不静默走错后端。
    if (!this.acpLedger.has(params.sessionId)) {
      return err(new BusinessError('E_SESSION_NOT_FOUND', '会话不存在', 'VALIDATION'));
    }
    return err(new BusinessError('E_ACP_UNSUPPORTED', 'ACP 会话暂不支持分支（显式拒绝）', 'AGENT_RUNTIME'));
  }

  public async queueAgentAdd(params: {
    sessionId: string;
    message: string;
    clientUserMessageId?: string;
  }) {
    // 网关侧 ACP 队列（与旧 queue 同 DTO，前端零改动）。
    if (!this.acpLedger.has(params.sessionId)) {
      return err(new BusinessError('E_SESSION_NOT_FOUND', '会话不存在', 'VALIDATION'));
    }
    try {
      const item = this.acpLedger.queueAdd(params.sessionId, params.message);
      return ok({
        id: item.id,
        text: item.message,
        clientUserMessageId: params.clientUserMessageId ?? '',
      });
    } catch (error) {
      return err(error instanceof BusinessError ? error : new BusinessError('E_QUEUE_ADD', String(error), 'AGENT_RUNTIME'));
    }
  }

  public async listAgentQueue(params: { sessionId: string; limit?: number }) {
    if (!this.acpLedger.has(params.sessionId)) {
      return err(new BusinessError('E_SESSION_NOT_FOUND', '会话不存在', 'VALIDATION'));
    }
    const items = this.acpLedger.queueList(params.sessionId, params.limit ?? 20).map(item => ({
      id: item.id,
      text: item.message,
      clientUserMessageId: '',
    }));
    return ok({ items });
  }

  public async deleteAgentQueueItem(params: {
    sessionId: string;
    queuedSubmissionId: string;
  }) {
    if (!this.acpLedger.has(params.sessionId)) {
      return err(new BusinessError('E_SESSION_NOT_FOUND', '会话不存在', 'VALIDATION'));
    }
    const removed = this.acpLedger.queueRemove(params.sessionId, params.queuedSubmissionId);
    if (!removed) {
      return err(new BusinessError('E_QUEUE_NOT_FOUND', '队列项不存在（可能已被消费）', 'VALIDATION'));
    }
    return ok(undefined);
  }

  public async startAgentQueue(params: {
    sessionId: string;
    queuedSubmissionId?: string;
  }) {
    // ACP 队列消费走 WS 流（handleQueueStart 的 ACP 分支，带流式回放）；
    // HTTP 启不动无 emit 的 turn，大声指路，不静默吞掉。
    if (!this.acpLedger.has(params.sessionId)) {
      return err(new BusinessError('E_SESSION_NOT_FOUND', '会话不存在', 'VALIDATION'));
    }
    return err(new BusinessError('E_ACP_QUEUE_HTTP_UNSUPPORTED', 'ACP 队列请走工作区消息流消费（自动续跑）', 'VALIDATION'));
  }

  /**
   * 处理客户端接入的 WebSocket 消息信封，支持可选多步流式发射器
   */
  public async handleClientMessage(
    envelope: WsEnvelope,
    emit?: (env: WsEnvelope) => void
  ): Promise<Result<WsEnvelope, BusinessError>> {
    if (emit && envelope.sessionId) {
      this.registerSessionEmit(envelope.sessionId, emit);
    }
    switch (envelope.type) {
      case WsEventTypes.CLIENT_SESSION_INIT: {
        const payload = envelope.payload as {
          userId: string;
          targetLanguage: 'ja' | 'en' | 'ko';
          targetLevel: string;
        };
        const sessionRes = this.sessionManager.createSession(
          payload.userId,
          payload.targetLanguage,
          payload.targetLevel
        );
        if (!isOk(sessionRes)) {
          return err(sessionRes.error);
        }

        // 仅同步目标语种轨道；禁止每次重连强行改写 studyGoal（否则刷新会把韩语打回英语）
        await this.learnerRepo.updateLearnerProfile(payload.userId, {
          targetLanguage: payload.targetLanguage,
        });

        // 获取该学习者的最新画像快照
        const snapshotRes = await this.learnerRepo.getProfileSnapshot(payload.userId);
        const snapshot = isOk(snapshotRes) ? snapshotRes.value : undefined;

        if (emit) {
          this.registerSessionEmit(sessionRes.value.id, emit);
        }

        return ok({
          version: '1.0',
          id: generateId('msg'),
          sessionId: sessionRes.value.id,
          type: WsEventTypes.AGENT_TURN_COMPLETED,
          payload: { status: 'INITIALIZED', session: sessionRes.value, profile: snapshot },
          timestamp: Date.now(),
        });
      }

      case WsEventTypes.CLIENT_PING: {
        return ok({
          version: '1.0',
          id: generateId('msg'),
          sessionId: envelope.sessionId,
          type: WsEventTypes.GATEWAY_PONG,
          payload: { serverTimestamp: Date.now() },
          timestamp: Date.now(),
        });
      }

      case WsEventTypes.CLIENT_QUIZ_SUBMIT:
        return handleQuizSubmit(this.practiceWsDependencies, envelope);

      // 双传输收敛：CLIENT_CARD_REVIEW WS 处理已删除——卡片评分唯一路径为
      // HTTP POST /api/cards/:userId/:cardId/review（避免双写 FSRS 状态）。

      case WsEventTypes.CLIENT_PROFILE_GET:
        return handleProfileGet(this.learningProgressWsDependencies, envelope);

      case WsEventTypes.CLIENT_PROFILE_UPDATE:
        return handleProfileUpdate(this.learningProgressWsDependencies, envelope);

      case WsEventTypes.CLIENT_TASK_PROGRESS_GET:
        return handleTaskProgressGet(this.learningProgressWsDependencies, envelope);

      case WsEventTypes.CLIENT_TASK_ACTIVITY_RECORD:
        return handleTaskActivityRecord(this.learningProgressWsDependencies, envelope);

      case WsEventTypes.CLIENT_QUIZ_GENERATE:
        return handleQuizGenerate(this.practiceWsDependencies, envelope);

      case WsEventTypes.CLIENT_QUIZ_GRADE_SUBJECTIVE:
        return handleQuizGradeSubjective(this.practiceWsDependencies, envelope);

      case WsEventTypes.CLIENT_TURN_SEND:
        return handleTurnSend(this, envelope, emit);

      case WsEventTypes.CLIENT_QUEUE_START:
        return handleQueueStart(this, envelope, emit);

      case WsEventTypes.CLIENT_APPROVAL_RESPOND:
        return handleApprovalRespond(this, envelope);

      case WsEventTypes.CLIENT_TURN_INTERRUPT:
        return handleTurnInterrupt(this, envelope);

      case WsEventTypes.CLIENT_TURN_STEER:
        return handleTurnSteer(this, envelope);

      case WsEventTypes.CLIENT_TOOL_RESULT:
        return handleToolResult(this, envelope);

      default:
        return err(
          new BusinessError(
            'E_UNSUPPORTED_EVENT',
            `暂不支持此事件类型 [${envelope.type}]`,
            'VALIDATION'
          )
        );
    }
  }
}
