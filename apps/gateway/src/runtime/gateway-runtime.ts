import { SessionManager, type AgentLane } from '../session/session-manager.js';
import { ContextBuilder } from '../context/context-builder.js';
import { ToolRouter } from '../router/tool-router.js';
import { ToolRegistry, ToolLocations } from '@study-studio/tool-core';
import { CodexAdapter } from '@study-studio/agent-runtime';
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
  handleQuizSubmit,
  handleProfileGet,
  handleProfileUpdate,
  handleTaskProgressGet,
  handleTaskActivityRecord,
  handleQuizGenerate,
  handleQuizGradeSubjective,
} from './handlers/learner-handlers.js';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { EnrichJobRegistry, buildEnrichWsEnvelope } from '../modules/library/application/pdf-import/enrich-job-runner.js';
import { registerGatewayTools } from '../transport/tools/register-tools.js';
import {
  handleTurnSend,
  handleQueueStart,
  handleApprovalRespond,
  handleTurnInterrupt,
  handleTurnSteer,
  handleToolResult,
} from './handlers/turn-handlers.js';

export class GatewayServer {
  public readonly sessionManager = new SessionManager();
  public readonly contextBuilder = new ContextBuilder();
  public readonly toolRegistry = new ToolRegistry();
  public readonly toolRouter = new ToolRouter(this.toolRegistry);
  public readonly agentAdapter: CodexAdapter;
  /** 轻量旁路：快问快答；学习闭环默认走 Codex App Server */
  public readonly responsesAdapter = new ResponsesAdapter();
  public readonly learnerRepo: LearnerRepository;
  /** @internal 供 runtime/handlers/turn-handlers.ts 使用 */
  public readonly activeStreamControllers = new Map<string, AbortController>();
  /** 当前 Turn 的 WS 下发器：供 Codex dynamic tool 触发 Client Tools */
  /** @internal 供 runtime/handlers/turn-handlers.ts 使用（回合内跨文件赋值，须保持可写） */
  public activeTurnEmit: ((env: WsEnvelope) => void) | undefined;
  /** sessionId → 当前进行中的 Agent lane（steer / interrupt / approval） */
  /** @internal 供 runtime/handlers/turn-handlers.ts 使用 */
  public readonly activeTurnLane = new Map<string, AgentLane>();
  /** sessionId → 持久 WS 下发（旁路通知用） */
  private readonly sessionEmitters = new Map<string, (env: WsEnvelope) => void>();
  /** 整本 enrich 后台任务注册表（进程内；已落库课天然续跑，重启不丢数据） */
  public readonly enrichJobs = new EnrichJobRegistry();

  constructor(
    learnerRepo?: LearnerRepository,
    /** @internal 测试注入 mock adapter；产品调用走默认 CodexAdapter */
    adapterOverride?: CodexAdapter
  ) {
    this.learnerRepo = learnerRepo ?? new DrizzleLearnerRepository(':memory:');

    // P6-3：先建 adapter 再注册工具，使 learning.assess 的 ai 模式可用；
    // executeTool 闭包在调用时才读 toolRegistry，提前创建无初始化顺序问题。
    this.agentAdapter =
      adapterOverride ??
      new CodexAdapter({
        executeTool: async (toolName, input, ctx) => {
          const tool = this.toolRegistry.get(toolName);
          if (!tool) {
            throw new BusinessError(
              'E_TOOL_NOT_FOUND',
              `未注册工具：${toolName}`,
              'TOOL_EXECUTION'
            );
          }
          const res = await tool.execute(input as never, {
            userId: ctx.userId,
            sessionId: ctx.sessionId,
          });
          if (!isOk(res)) {
            throw res.error;
          }
          // Client Tools：进程内校验参数后，经 WS 下发前端执行
          if (tool.location === ToolLocations.CLIENT && this.activeTurnEmit) {
            this.activeTurnEmit({
              version: '1.0',
              id: generateId('tool'),
              sessionId: ctx.sessionId,
              type: WsEventTypes.AGENT_TOOL_CALL,
              payload: {
                callId: generateId('call'),
                toolName: tool.name,
                args: res.value,
              },
              timestamp: Date.now(),
            });
          }
          return res.value;
        },
        onNotification: (method, params) => {
          this.handleCodexNotification(method, params);
        },
      });

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

  private handleCodexNotification(method: string, params: unknown): void {
    const p = (params ?? {}) as Record<string, unknown>;
    if (method === 'thread/queue/changed') {
      const threadId = p.threadId != null ? String(p.threadId) : '';
      if (!threadId) return;
      this.emitToThreadSessions(threadId, {
        type: WsEventTypes.AGENT_QUEUE_CHANGED,
        payload: { threadId },
      });
      return;
    }
    if (method === 'skills/changed') {
      this.emitToAllSessions({
        type: WsEventTypes.AGENT_SKILLS_CHANGED,
        payload: {},
      });
      return;
    }

    // EXPERIMENTAL realtime 通知转发（音频/UI 管线未接，仅推送信封便于日后联调）
    const realtimeMap: Record<string, string> = {
      'thread/realtime/started': WsEventTypes.AGENT_REALTIME_STARTED,
      'thread/realtime/closed': WsEventTypes.AGENT_REALTIME_CLOSED,
      'thread/realtime/error': WsEventTypes.AGENT_REALTIME_ERROR,
      'thread/realtime/transcript/delta': WsEventTypes.AGENT_REALTIME_TRANSCRIPT_DELTA,
      'thread/realtime/transcript/done': WsEventTypes.AGENT_REALTIME_TRANSCRIPT_DONE,
      'thread/realtime/outputAudio/delta': WsEventTypes.AGENT_REALTIME_AUDIO_DELTA,
      'thread/realtime/sdp': WsEventTypes.AGENT_REALTIME_SDP,
      'thread/realtime/itemAdded': WsEventTypes.AGENT_REALTIME_ITEM_ADDED,
    };
    const wsType = realtimeMap[method];
    if (!wsType) return;
    const threadId = p.threadId != null ? String(p.threadId) : '';
    if (threadId) {
      this.emitToThreadSessions(threadId, {
        type: wsType,
        payload: { ...p, experimental: true },
      });
    } else {
      this.emitToAllSessions({
        type: wsType,
        payload: { ...p, experimental: true },
      });
    }
  }

  private emitToThreadSessions(
    threadId: string,
    partial: { type: string; payload: Record<string, unknown> }
  ): void {
    for (const [sessionId, emit] of this.sessionEmitters) {
      const sess = this.sessionManager.getSession(sessionId);
      if (!isOk(sess)) continue;
      const lanes = sess.value.agentByLane;
      const hit =
        lanes.coach?.threadId === threadId || lanes.learning?.threadId === threadId;
      if (!hit) continue;
      emit({
        version: '1.0',
        id: generateId('note'),
        sessionId,
        type: partial.type as (typeof WsEventTypes)[keyof typeof WsEventTypes],
        payload: partial.payload,
        timestamp: Date.now(),
      });
    }
  }

  private emitToAllSessions(partial: {
    type: string;
    payload: Record<string, unknown>;
  }): void {
    for (const [sessionId, emit] of this.sessionEmitters) {
      emit({
        version: '1.0',
        id: generateId('note'),
        sessionId,
        type: partial.type as (typeof WsEventTypes)[keyof typeof WsEventTypes],
        payload: partial.payload,
        timestamp: Date.now(),
      });
    }
  }

  /** 本机 Codex 登录态 / 模型清单（HTTP 探测用） */
  public async getCodexAccountStatus() {
    return this.agentAdapter.getAccountStatus();
  }

  public async listCodexModels(includeHidden = false) {
    return this.agentAdapter.listModels(includeHidden);
  }

  public async listCodexThreads(params?: {
    limit?: number;
    cursor?: string;
    searchTerm?: string;
  }) {
    return this.agentAdapter.listThreads(params);
  }

  public async listCodexThreadItems(params: { threadId: string; limit?: number }) {
    return this.agentAdapter.listThreadItems(params);
  }

  public async setCodexThreadName(threadId: string, name: string) {
    return this.agentAdapter.setThreadName(threadId, name);
  }

  public async archiveCodexThread(threadId: string) {
    return this.agentAdapter.archiveThread(threadId);
  }

  public async compactCodexThread(threadId: string) {
    return this.agentAdapter.compactThread(threadId);
  }

  public async forkCodexThread(params: {
    threadId: string;
    ephemeral?: boolean;
    model?: string;
  }) {
    return this.agentAdapter.forkThread(params);
  }

  public async queueCodexAdd(params: {
    threadId: string;
    message: string;
    clientUserMessageId?: string;
  }) {
    return this.agentAdapter.queueAdd(params);
  }

  public async listCodexQueue(params: { threadId: string; limit?: number }) {
    return this.agentAdapter.queueList(params);
  }

  public async deleteCodexQueueItem(params: {
    threadId: string;
    queuedSubmissionId: string;
  }) {
    return this.agentAdapter.queueDelete(params);
  }

  public async startCodexQueue(params: {
    threadId: string;
    queuedSubmissionId?: string;
  }) {
    return this.agentAdapter.queueStart(params);
  }

  public async listCodexSkills(params?: { forceReload?: boolean }) {
    return this.agentAdapter.listSkills(params);
  }

  public async getCodexRateLimits() {
    return this.agentAdapter.getRateLimits();
  }

  public async listCodexMcpServers(params?: { cursor?: string; limit?: number }) {
    return this.agentAdapter.listMcpServerStatus(params);
  }

  /** EXPERIMENTAL realtime — 预留接口，产品 UI 尚未接入 */
  public async probeCodexRealtime() {
    return this.agentAdapter.probeRealtimeCapability();
  }

  public async listCodexRealtimeVoices() {
    return this.agentAdapter.listRealtimeVoices();
  }

  public async startCodexRealtime(
    params: Parameters<CodexAdapter['startRealtime']>[0]
  ) {
    return this.agentAdapter.startRealtime(params);
  }

  public async stopCodexRealtime(threadId: string) {
    return this.agentAdapter.stopRealtime(threadId);
  }

  public async appendCodexRealtimeText(
    params: Parameters<CodexAdapter['appendRealtimeText']>[0]
  ) {
    return this.agentAdapter.appendRealtimeText(params);
  }

  public async appendCodexRealtimeSpeech(
    params: Parameters<CodexAdapter['appendRealtimeSpeech']>[0]
  ) {
    return this.agentAdapter.appendRealtimeSpeech(params);
  }

  public async appendCodexRealtimeAudio(
    params: Parameters<CodexAdapter['appendRealtimeAudio']>[0]
  ) {
    return this.agentAdapter.appendRealtimeAudio(params);
  }

  public async listCodexCollaborationModes() {
    return this.agentAdapter.listCollaborationModes();
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
        return handleQuizSubmit(this, envelope);

      // 双传输收敛：CLIENT_CARD_REVIEW WS 处理已删除——卡片评分唯一路径为
      // HTTP POST /api/cards/:userId/:cardId/review（避免双写 FSRS 状态）。

      case WsEventTypes.CLIENT_PROFILE_GET:
        return handleProfileGet(this, envelope);

      case WsEventTypes.CLIENT_PROFILE_UPDATE:
        return handleProfileUpdate(this, envelope);

      case WsEventTypes.CLIENT_TASK_PROGRESS_GET:
        return handleTaskProgressGet(this, envelope);

      case WsEventTypes.CLIENT_TASK_ACTIVITY_RECORD:
        return handleTaskActivityRecord(this, envelope);

      case WsEventTypes.CLIENT_QUIZ_GENERATE:
        return handleQuizGenerate(this, envelope);

      case WsEventTypes.CLIENT_QUIZ_GRADE_SUBJECTIVE:
        return handleQuizGradeSubjective(this, envelope);

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
