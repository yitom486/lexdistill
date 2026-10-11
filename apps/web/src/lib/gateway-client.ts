import { toast } from 'sonner';
import {
  WsEventTypes,
  type WsEventType,
  type WsEnvelope,
  type GeneratedQuestion,
} from '@study-studio/protocol';
import { generateId } from '@study-studio/shared';
import { useGatewayStore } from '../stores/useGatewayStore.js';
import { useStudySessionStore } from '../stores/useStudySessionStore.js';
import { useUserProfileStore } from '../stores/useUserProfileStore.js';
import { emitAgentInvalidate } from '../queries/useAgentQueries.js';

export const DEFAULT_GATEWAY_WS_URL = 'ws://localhost:8080/ws';
export const DEFAULT_GATEWAY_USER_ID = 'student_web_01';

export interface StreamTurnOptions {
  input: string;
  intent?:
    | 'EXPLAIN'
    | 'GENERATE_QUIZ'
    | 'GRADE'
    | 'DRILL_KANA'
    | 'DRILL_HANGUL'
    | 'REVIEW_MISTAKES'
    | 'FREE_COACH'
    | undefined;
  contextSnapshot?: unknown;
  agentOptions?: {
    model?: string;
    effort?: string;
    approvalPolicy?: string;
    threadId?: string;
    ephemeral?: boolean;
    collaborationMode?: string;
    /** 显式工具 allowlist（业务名）：固定任务建会话/升级会话时直接采用，不走关键词正则 */
    tools?: string[];
    /** 固定任务 id（网关按中央目录解析；旧网关忽略本字段，仍用 tools） */
    task?: string;
    /** Agent 运行时 id（网关按 runtime 选池适配器） */
    runtimeId?: string;
    /** coach=聊天界面；learning=出题/批改/题目导师（与聊天隔离） */
    lane?: 'coach' | 'learning';
  };
  onStart?: () => void;
  onDelta: (delta: string, accumulated: string) => void;
  onReasoningDelta?: (delta: string, accumulated: string) => void;
  onToolCall?: (info: {
    callId?: string;
    toolName: string;
    arguments?: Record<string, unknown>;
  }) => void;
  onApprovalRequest?: (info: {
    approvalId: string;
    action: string;
    description: string;
    riskLevel: string;
    expiresAt?: number;
  }) => void;
  onApprovalResolved?: (info: {
    approvalId: string;
    decision: string;
    reason?: string;
  }) => void;
  onComplete: (data: {
    status: 'COMPLETED' | 'INTERRUPTED' | 'FAILED';
    finalOutput: string;
    toolResults?: unknown;
    source?: string;
    /** 本轮是否由 Agent 流式完成，或因 Agent 失败回退（新字段）。 */
    agentOutcome?: 'streamed' | 'fallback' | 'not_requested';
    /** 仅在 Agent 回退时提供的面向用户的错误说明（新字段）。 */
    agentFailureMessage?: string;
    /** @deprecated 旧字段别名（与 agentOutcome 同值），兼容旧网关 */
    codexOutcome?: 'streamed' | 'fallback' | 'not_requested';
    /** @deprecated 旧字段别名（与 agentFailureMessage 同值），兼容旧网关 */
    codexFailureMessage?: string;
    model?: string;
    threadId?: string;
    queueRemaining?: number;
    fromQueue?: boolean;
    // P3-C 结构化执行摘要字段（统一普通回合与队列回合）
    /** Agent 通路本轮结果（与 agentOutcome 等价，统一字段名） */
    outcome?: 'streamed' | 'fallback' | 'not_requested';
    /** 结构化失败原因；仅含用户可读信息，不含底层错误栈 */
    failure?: {
      code: string;
      userMessage: string;
      category: 'SESSION_CREATE' | 'STREAM' | 'QUEUE' | 'INTERRUPTED' | 'UNKNOWN';
      retryable?: boolean;
    };
    /** 本轮耗时（毫秒） */
    elapsedMs?: number;
    lane?: 'coach' | 'learning';
    /** 网关侧非致命提醒（如模型被替换为运行时默认），前端 toast 明示，不静默。 */
    toolWarnings?: string[];
    /** ACP 上下文用量（usage_update 只读透传；配额类无 ACP 对应物）。 */
    contextUsage?: { used: number; size: number };
  }) => void;
  onError?: (err: unknown) => void;
}

export interface StreamQueueStartOptions {
  queuedSubmissionId?: string;
  approvalPolicy?: string;
  lane?: 'coach' | 'learning';
  onStart?: () => void;
  onDelta: (delta: string, accumulated: string) => void;
  onReasoningDelta?: (delta: string, accumulated: string) => void;
  onToolCall?: StreamTurnOptions['onToolCall'];
  onApprovalRequest?: StreamTurnOptions['onApprovalRequest'];
  onApprovalResolved?: StreamTurnOptions['onApprovalResolved'];
  onComplete: StreamTurnOptions['onComplete'];
  onError?: (err: unknown) => void;
}

export interface QuizSubmitPayload {
  questionId: string;
  userAnswer: string;
  isCorrect: boolean;
  score: number;
  timeSpentMs: number;
  testedSkillId: string;
  questionContent?: string;
  correctAnswer?: string;
  explanation?: string;
}

export interface SubjectiveGradePayload {
  questionId: string;
  prompt: string;
  standardAnswer: string;
  userSubmission: string;
  testedSkillId: string;
  contextSentence?: string;
}

/** AGENT_TURN_COMPLETED payload 的前端消费视图（与 StreamTurnOptions.onComplete 入参同源）。 */
export type TurnCompletedPayload = Parameters<StreamTurnOptions['onComplete']>[0];

/** 从未知形状的 WS payload 中安全读取字符串字段（缺失/非字符串一律 undefined）。 */
function payloadStringField(payload: unknown, key: string): string | undefined {
  if (typeof payload === 'object' && payload !== null && key in payload) {
    const value = (payload as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

type ActiveStream = {
  onStart?: (() => void) | undefined;
  onDelta: (delta: string, accumulated: string) => void;
  onReasoningDelta?: ((delta: string, accumulated: string) => void) | undefined;
  onToolCall?: ((info: {
    callId?: string;
    toolName: string;
    arguments?: Record<string, unknown>;
  }) => void) | undefined;
  onApprovalRequest?: StreamTurnOptions['onApprovalRequest'];
  onApprovalResolved?: StreamTurnOptions['onApprovalResolved'];
  onComplete: (data: TurnCompletedPayload) => void;
  onError?: ((err: unknown) => void) | undefined;
  accumulatedText: string;
  accumulatedReasoning: string;
};

/** 通用 WS 事件订阅（旁路通知用，如 import.enrich.*；Turn 流仍走专属回调）。 */
export type WsEventHandler = (envelope: WsEnvelope) => void;

export interface GatewayClientOptions {
  url?: string;
  userId?: string;
  autoConnect?: boolean;
}

/**
 * 无 React 的 Gateway WS 单例：连接 / 会话 / 流式 Turn / 学习命令。
 * UI 经 Zustand（连接态）+ hooks / TanStack Mutation 消费，禁止业务组件自建 WebSocket。
 */
export class GatewayClient {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pingSentAt = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private activeStream: ActiveStream | null = null;
  private pendingResolvers = new Map<string, (val: unknown) => void>();
  private started = false;
  private eventSubscribers = new Map<string, Set<WsEventHandler>>();
  private options: Required<GatewayClientOptions> = {
    url: DEFAULT_GATEWAY_WS_URL,
    userId: DEFAULT_GATEWAY_USER_ID,
    autoConnect: true,
  };

  public configure(opts: GatewayClientOptions = {}): void {
    this.options = {
      url: opts.url ?? this.options.url,
      userId: opts.userId ?? this.options.userId,
      autoConnect: opts.autoConnect ?? this.options.autoConnect,
    };
  }

  /** App 根挂载一次：等档案水合后再连，避免默认 en 抢跑 */
  public start(opts?: GatewayClientOptions): void {
    if (opts) this.configure(opts);
    if (this.started) return;
    this.started = true;

    const boot = () => {
      if (this.options.autoConnect) this.connect();
    };

    if (useUserProfileStore.persist.hasHydrated()) {
      boot();
      return;
    }
    useUserProfileStore.persist.onFinishHydration(boot);
  }

  public stop(): void {
    this.started = false;
    this.disconnect({ clearReconnect: true });
  }

  public get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  public getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * 按事件类型订阅旁路通知（返回退订函数）。
   * 供 hooks 层使用；业务组件禁止直连本单例（经 hook 消费）。
   */
  public subscribe(type: string, handler: WsEventHandler): () => void {
    let set = this.eventSubscribers.get(type);
    if (!set) {
      set = new Set();
      this.eventSubscribers.set(type, set);
    }
    set.add(handler);
    return () => {
      const live = this.eventSubscribers.get(type);
      if (live) {
        live.delete(handler);
        if (live.size === 0) this.eventSubscribers.delete(type);
      }
    };
  }

  private dispatchToSubscribers(envelope: WsEnvelope): void {
    const set = this.eventSubscribers.get(envelope.type);
    if (!set || set.size === 0) return;
    for (const handler of [...set]) {
      try {
        handler(envelope);
      } catch {
        // 订阅者异常不影响主分发
      }
    }
  }

  public connect(): void {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    useGatewayStore.getState().patch({ isConnecting: true, lastError: null });

    try {
      const ws = new WebSocket(this.options.url);
      this.ws = ws;

      ws.onopen = () => {
        useGatewayStore.getState().patch({
          isConnected: true,
          isConnecting: false,
          lastError: null,
        });
        if (this.reconnectTimeout) {
          clearTimeout(this.reconnectTimeout);
          this.reconnectTimeout = null;
        }

        const profile = useUserProfileStore.getState().profile;
        this.sendRaw({
          version: '1.0',
          id: generateId('msg'),
          sessionId: 'init_req',
          type: WsEventTypes.CLIENT_SESSION_INIT,
          payload: {
            userId: this.options.userId,
            targetLanguage: profile.targetLanguage || 'en',
            targetLevel: profile.overallLevel || 'B1',
          },
          timestamp: Date.now(),
        });

        if (this.pingInterval) clearInterval(this.pingInterval);
        this.pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            this.pingSentAt = Date.now();
            this.sendRaw({
              version: '1.0',
              id: generateId('msg'),
              sessionId: this.sessionId ?? 'active_session',
              type: WsEventTypes.CLIENT_PING,
              payload: {},
              timestamp: Date.now(),
            });
          }
        }, 15_000);
      };

      ws.onmessage = (event) => {
        this.handleMessage(event.data.toString());
      };

      ws.onclose = () => {
        useGatewayStore.getState().patch({
          isConnected: false,
          isConnecting: false,
        });
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
          this.pingInterval = null;
        }
        if (this.options.autoConnect && this.started) {
          if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
          this.reconnectTimeout = setTimeout(() => this.connect(), 3000);
        }
      };

      ws.onerror = () => {
        useGatewayStore.getState().patch({
          isConnected: false,
          isConnecting: false,
          lastError: 'Gateway WebSocket 连接异常',
        });
      };
    } catch {
      useGatewayStore.getState().patch({
        isConnected: false,
        isConnecting: false,
        lastError: '无法创建 Gateway 连接',
      });
      if (this.options.autoConnect && this.started) {
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = setTimeout(() => this.connect(), 3000);
      }
    }
  }

  public disconnect(opts?: { clearReconnect?: boolean }): void {
    if (opts?.clearReconnect !== false && this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.close();
    }
    useGatewayStore.getState().patch({
      isConnected: false,
      isConnecting: false,
    });
  }

  public sendEnvelope(type: WsEventType, payload: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.sendRaw({
      version: '1.0',
      id: generateId('msg'),
      sessionId: this.sessionId ?? 'active_session',
      type,
      payload,
      timestamp: Date.now(),
    });
    return true;
  }

  public submitQuiz(data: QuizSubmitPayload): boolean {
    return this.sendEnvelope(WsEventTypes.CLIENT_QUIZ_SUBMIT, {
      userId: this.options.userId,
      ...data,
    });
  }

  // 双传输收敛：WS reviewCard 已删除——卡片评分唯一路径为 HTTP
  // POST /api/cards/:userId/:cardId/review（Gateway 单点计算 FSRS）。

  public async generateAdaptiveQuiz(options?: {
    weaknessSkillId?: string;
    count?: number;
  }): Promise<unknown> {
    const profile = useUserProfileStore.getState().profile;
    return this.sendRequest(WsEventTypes.CLIENT_QUIZ_GENERATE, {
      userId: this.options.userId,
      targetLanguage: profile.targetLanguage || 'en',
      targetLevel: profile.overallLevel || 'CEFR B1',
      ...options,
    });
  }

  public async gradeSubjectiveQuiz(data: SubjectiveGradePayload): Promise<unknown> {
    return this.sendRequest(WsEventTypes.CLIENT_QUIZ_GRADE_SUBJECTIVE, {
      userId: this.options.userId,
      ...data,
    });
  }

  public sendTurnStream(options: StreamTurnOptions): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      options.onError?.(new Error('Gateway is not connected'));
      return false;
    }

    this.activeStream = {
      onStart: options.onStart,
      onDelta: options.onDelta,
      onReasoningDelta: options.onReasoningDelta,
      onToolCall: options.onToolCall,
      onApprovalRequest: options.onApprovalRequest,
      onApprovalResolved: options.onApprovalResolved,
      onComplete: options.onComplete,
      onError: options.onError,
      accumulatedText: '',
      accumulatedReasoning: '',
    };

    this.sendRaw({
      version: '1.0',
      id: generateId('turn_req'),
      sessionId: this.sessionId ?? 'active_session',
      type: WsEventTypes.CLIENT_TURN_SEND,
      payload: {
        userId: this.options.userId,
        input: options.input,
        intent: options.intent ?? 'EXPLAIN',
        contextSnapshot: options.contextSnapshot,
        agentOptions: options.agentOptions,
      },
      timestamp: Date.now(),
    });
    return true;
  }

  /** 启动队列下一项并流式推送（client.queue.start） */
  public startQueueStream(options: StreamQueueStartOptions): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      options.onError?.(new Error('Gateway is not connected'));
      return false;
    }

    this.activeStream = {
      onStart: options.onStart,
      onDelta: options.onDelta,
      onReasoningDelta: options.onReasoningDelta,
      onToolCall: options.onToolCall,
      onApprovalRequest: options.onApprovalRequest,
      onApprovalResolved: options.onApprovalResolved,
      onComplete: options.onComplete,
      onError: options.onError,
      accumulatedText: '',
      accumulatedReasoning: '',
    };

    this.sendRaw({
      version: '1.0',
      id: generateId('queue_req'),
      sessionId: this.sessionId ?? 'active_session',
      type: WsEventTypes.CLIENT_QUEUE_START,
      payload: {
        lane: options.lane ?? 'coach',
        ...(options.queuedSubmissionId
          ? { queuedSubmissionId: options.queuedSubmissionId }
          : {}),
        ...(options.approvalPolicy ? { approvalPolicy: options.approvalPolicy } : {}),
      },
      timestamp: Date.now(),
    });
    return true;
  }

  public interruptTurn(lane?: 'coach' | 'learning'): boolean {
    return this.sendEnvelope(WsEventTypes.CLIENT_TURN_INTERRUPT, {
      ...(lane ? { lane } : {}),
    });
  }

  public steerTurn(message: string, lane?: 'coach' | 'learning'): boolean {
    const text = message.trim();
    if (!text) return false;
    return this.sendEnvelope(WsEventTypes.CLIENT_TURN_STEER, {
      input: text,
      ...(lane ? { lane } : {}),
    });
  }

  public respondApproval(
    approvalId: string,
    decision: boolean | 'accept' | 'acceptForSession' | 'decline' | 'cancel'
  ): boolean {
    const normalized =
      typeof decision === 'boolean' ? (decision ? 'accept' : 'decline') : decision;
    return this.sendEnvelope(WsEventTypes.CLIENT_APPROVAL_RESPOND, {
      approvalId,
      decision: normalized,
      approved: normalized === 'accept' || normalized === 'acceptForSession',
    });
  }

  private sendRaw(envelope: WsEnvelope): void {
    this.ws?.send(JSON.stringify(envelope));
  }

  private sendRequest<T = unknown>(type: WsEventType, payload: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Gateway is not connected'));
        return;
      }

      this.pendingResolvers.set(type, resolve as (val: unknown) => void);
      this.sendRaw({
        version: '1.0',
        id: generateId('req'),
        sessionId: this.sessionId ?? 'active_session',
        type,
        payload,
        timestamp: Date.now(),
      });

      setTimeout(() => {
        if (this.pendingResolvers.has(type)) {
          this.pendingResolvers.delete(type);
          reject(new Error('Gateway request timed out'));
        }
      }, 6000);
    });
  }

  private handleMessage(raw: string): void {
    try {
      const envelope = JSON.parse(raw) as WsEnvelope;

      if (envelope.type === WsEventTypes.AGENT_TURN_START) {
        this.activeStream?.onStart?.();
      } else if (envelope.type === WsEventTypes.AGENT_TEXT_DELTA) {
        if (this.activeStream) {
          const p = envelope.payload as { delta?: unknown; textDelta?: unknown };
          const delta = payloadStringField(p, 'delta') || payloadStringField(p, 'textDelta') || '';
          this.activeStream.accumulatedText += delta;
          this.activeStream.onDelta(delta, this.activeStream.accumulatedText);
        }
      } else if (envelope.type === WsEventTypes.AGENT_REASONING_DELTA) {
        if (this.activeStream) {
          const p = envelope.payload as { delta?: unknown };
          const delta = payloadStringField(p, 'delta') || '';
          this.activeStream.accumulatedReasoning += delta;
          this.activeStream.onReasoningDelta?.(
            delta,
            this.activeStream.accumulatedReasoning
          );
        }
      } else if (envelope.type === WsEventTypes.AGENT_TURN_COMPLETED) {
        const status = (envelope.payload as { status?: unknown })?.status;
        if (status === 'APPROVAL_ACK' || status === 'STEER_ACK' || status === 'TOOL_RESULT_ACK') return;

        if (status === 'INITIALIZED') {
          this.sessionId = envelope.sessionId;
          useGatewayStore.getState().setSessionId(envelope.sessionId);
          return;
        } else if (Array.isArray((envelope.payload as { questions?: unknown })?.questions)) {
          const resolver = this.pendingResolvers.get(WsEventTypes.CLIENT_QUIZ_GENERATE);
          if (resolver) {
            this.pendingResolvers.delete(WsEventTypes.CLIENT_QUIZ_GENERATE);
            resolver(envelope.payload);
          }
          return;
        } else if (
          (envelope.payload as { refinementSuggestion?: unknown })?.refinementSuggestion !== undefined ||
          (envelope.payload as { errorDiagnosis?: unknown })?.errorDiagnosis !== undefined
        ) {
          const resolver = this.pendingResolvers.get(
            WsEventTypes.CLIENT_QUIZ_GRADE_SUBJECTIVE
          );
          if (resolver) {
            this.pendingResolvers.delete(WsEventTypes.CLIENT_QUIZ_GRADE_SUBJECTIVE);
            resolver(envelope.payload);
          }
          return;
        }
        if (status === 'RECORDED') return;
        if (this.activeStream) {
          const listener = this.activeStream;
          this.activeStream = null;
          listener.onComplete(envelope.payload as TurnCompletedPayload);
        }
      } else if (envelope.type === WsEventTypes.AGENT_QUEUE_CHANGED) {
        const sessionId = (envelope.payload as { sessionId?: string } | undefined)?.sessionId;
        emitAgentInvalidate({
          kind: 'queue',
          ...(sessionId ? { sessionId } : {}),
        });
      } else if (envelope.type === WsEventTypes.AGENT_APPROVAL_REQUEST) {
        const p = envelope.payload as {
          approvalId?: string;
          action?: string;
          description?: string;
          riskLevel?: string;
          expiresAt?: number;
        };
        if (p?.approvalId) {
          this.activeStream?.onApprovalRequest?.({
            approvalId: p.approvalId,
            action: String(p.action || 'action'),
            description: String(p.description || ''),
            riskLevel: String(p.riskLevel || 'medium'),
            ...(typeof p.expiresAt === 'number' ? { expiresAt: p.expiresAt } : {}),
          });
        }
      } else if (envelope.type === WsEventTypes.AGENT_APPROVAL_RESOLVED) {
        const p = envelope.payload as {
          approvalId?: string;
          decision?: string;
          reason?: string;
        };
        if (p?.approvalId && p.decision) {
          this.activeStream?.onApprovalResolved?.({
            approvalId: p.approvalId,
            decision: p.decision,
            ...(p.reason ? { reason: p.reason } : {}),
          });
        }
      } else if (envelope.type === WsEventTypes.AGENT_TOOL_CALL) {
        this.handleToolCall(envelope);
      } else if (envelope.type === WsEventTypes.GATEWAY_PONG) {
        if (this.pingSentAt > 0) {
          useGatewayStore.getState().setLatencyMs(Date.now() - this.pingSentAt);
        }
      } else if (envelope.type === WsEventTypes.AGENT_ERROR) {
        if (this.activeStream) {
          const listener = this.activeStream;
          this.activeStream = null;
          listener.onError?.(envelope.payload);
        }
        const errPayload = (envelope.payload as { error?: unknown })?.error ?? envelope.payload;
        const userMsg =
          typeof errPayload === 'string'
            ? errPayload
            : payloadStringField(errPayload, 'userMessage') ||
              payloadStringField(errPayload, 'message') ||
              '本轮请求未完成，请稍后重试。';
        toast.error(userMsg);
      }
      this.dispatchToSubscribers(envelope);
    } catch {
      // 忽略畸形帧
    }
  }

  private handleToolCall(envelope: WsEnvelope): void {
    const p = envelope.payload as {
      callId?: string;
      toolName?: string;
      args?: Record<string, unknown>;
      arguments?: Record<string, unknown>;
    };
    const toolName = p?.toolName;
    const args = p?.args ?? p?.arguments ?? {};
    if (toolName) {
      const toolInfo: {
        toolName: string;
        callId?: string;
        arguments?: Record<string, unknown>;
      } = { toolName };
      if (p.callId) toolInfo.callId = p.callId;
      if (Object.keys(args).length) toolInfo.arguments = args;
      this.activeStream?.onToolCall?.(toolInfo);
    }

    const session = useStudySessionStore.getState();
    // 仅 Client 工具（ui.*）在本地执行；Server 工具由网关内联回填，无需回执。
    let executed = false;
    if (toolName === 'ui.navigate') {
      session.applyUiNavigate(String(args.target ?? ''), Boolean(args.openTutor));
      toast.success(`已切换到 ${String(args.target ?? '工作台')}`);
      executed = true;
    } else if (toolName === 'ui.present') {
      const questions = Array.isArray(args.questions)
        ? (args.questions as GeneratedQuestion[])
        : [];
      if (questions.length > 0) {
        session.presentQuiz({
          surface: (args.surface as 'quiz') || 'quiz',
          layout: args.layout as 'SINGLE_COLUMN' | undefined,
          collectionId: args.collectionId as string | undefined,
          questions,
          stepIndex: typeof args.stepIndex === 'number' ? args.stepIndex : 0,
          passageId: args.passageId as string | undefined,
        });
        toast.success(`已推送 ${questions.length} 道练习到工作台`);
        executed = true;
      }
    }

    if (executed) {
      this.sendEnvelope(WsEventTypes.CLIENT_TOOL_RESULT, {
        callId: p?.callId,
        toolName,
        ok: true,
      });
    }
  }
}

/** 全应用共享的 Gateway 连接实例 */
export const gatewayClient = new GatewayClient();
