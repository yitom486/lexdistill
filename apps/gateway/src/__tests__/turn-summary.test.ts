import { describe, it, expect, beforeEach } from 'bun:test';
import { GatewayServer } from '../runtime/gateway-runtime.js';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { WsEventTypes, type WsEnvelope, type TurnExecutionSummary } from '@study-studio/protocol';
import { isOk, ok, err, BusinessError } from '@study-studio/shared';
import { buildTurnExecutionSummary, formatAgentLocalFallbackNote } from '../runtime/turn-summary-builder.js';
import type { AgentEvent, AgentSession } from '@study-studio/agent-runtime';
import type { Result } from '@study-studio/shared';
import type { AgentAdapter } from '@study-studio/agent-runtime';

// ---------------------------------------------------------------------------
// 纯函数 builder 单测：覆盖 4 种场景的结构化摘要构造
// ---------------------------------------------------------------------------

describe('buildTurnExecutionSummary (P3-C pure builder)', () => {
  const startedAt = Date.now() - 1500;

  it('建会话失败 → fallback + SESSION_CREATE 失败原因', () => {
    const failureError = new BusinessError(
      'E_AGENT_SESSION_CREATE',
      'Agent 会话创建失败，请重试。',
      'AGENT_RUNTIME',
      true
    );
    const summary = buildTurnExecutionSummary({
      status: 'COMPLETED',
      startedAt,
      source: 'local',
      outcome: 'fallback',
      failureError,
    });
    expect(summary.status).toBe('COMPLETED');
    expect(summary.outcome).toBe('fallback');
    expect(summary.source).toBe('local');
    expect(summary.failure).toBeDefined();
    expect(summary.failure?.code).toBe('E_AGENT_SESSION_CREATE');
    expect(summary.failure?.userMessage).toBe('Agent 会话创建失败，请重试。');
    expect(summary.failure?.category).toBe('SESSION_CREATE');
    expect(summary.failure?.retryable).toBe(true);
    expect(typeof summary.elapsedMs).toBe('number');
    expect(summary.elapsedMs!).toBeGreaterThanOrEqual(1500);
  });

  it('流中失败 → fallback + STREAM 失败原因（不泄漏错误栈）', () => {
    const failureError = new BusinessError('E_AGENT_STREAM', '流式中断，请重试。', 'AGENT_RUNTIME');
    const summary = buildTurnExecutionSummary({
      status: 'COMPLETED',
      startedAt,
      source: 'local',
      outcome: 'fallback',
      failureError,
    });
    expect(summary.outcome).toBe('fallback');
    expect(summary.failure?.category).toBe('STREAM');
    expect(summary.failure?.userMessage).toBe('流式中断，请重试。');
    expect(summary.failure?.userMessage).not.toContain('Error');
    expect(summary.failure?.code).toBe('E_AGENT_STREAM');
  });

  it('队列失败 → FAILED + QUEUE 失败原因', () => {
    const failureError = new BusinessError('E_AGENT_QUEUE', '队列启动失败，请重试。', 'AGENT_RUNTIME', true);
    const summary = buildTurnExecutionSummary({
      status: 'FAILED',
      startedAt,
      source: 'local',
      outcome: 'fallback',
      failureError,
      failureCategory: 'QUEUE',
      fromQueue: true,
      queueRemaining: 2,
    });
    expect(summary.status).toBe('FAILED');
    expect(summary.failure?.category).toBe('QUEUE');
    expect(summary.fromQueue).toBe(true);
    expect(summary.queueRemaining).toBe(2);
    expect(summary.failure?.retryable).toBe(true);
  });

  it('用户中断 → INTERRUPTED + INTERRUPTED 类别，无原始 error', () => {
    const summary = buildTurnExecutionSummary({
      status: 'INTERRUPTED',
      startedAt,
      source: 'local',
      outcome: 'not_requested',
      failureError: null,
      failureCategory: 'INTERRUPTED',
    });
    expect(summary.status).toBe('INTERRUPTED');
    expect(summary.failure?.category).toBe('INTERRUPTED');
    expect(summary.failure?.code).toBe('E_TURN_INTERRUPTED');
    expect(summary.failure?.userMessage).toBe('本轮已中断。');
  });

  it('Agent 真流式成功 → streamed，无 failure', () => {
    const summary = buildTurnExecutionSummary({
      status: 'COMPLETED',
      startedAt,
      source: 'agent',
      outcome: 'streamed',
      threadId: 'thread_abc',
      lane: 'coach',
      model: 'gpt-5',
    });
    expect(summary.outcome).toBe('streamed');
    expect(summary.source).toBe('agent');
    expect(summary.failure).toBeUndefined();
    expect(summary.threadId).toBe('thread_abc');
    expect(summary.model).toBe('gpt-5');
  });

  it('无结构化 error 时用 legacyFailureMessage 兜底', () => {
    const summary = buildTurnExecutionSummary({
      status: 'COMPLETED',
      startedAt,
      source: 'local',
      outcome: 'fallback',
      legacyFailureMessage: 'Agent 服务暂时不可用。',
    });
    expect(summary.failure?.userMessage).toBe('Agent 服务暂时不可用。');
    expect(summary.failure?.category).toBe('UNKNOWN');
  });

  it('本地回退脚注带上真实原因，且默认不提 Gateway', () => {
    const note = formatAgentLocalFallbackNote(
      '本轮未完成：model stream aborted',
      new BusinessError('E_AGENT_TURN', '本轮未完成：model stream aborted', 'AGENT_RUNTIME', true)
    );
    expect(note).toContain('model stream aborted');
    expect(note).toContain('重试');
    expect(note).not.toContain('Gateway');
    expect(note).not.toContain('一点小问题');
  });

  it('回退脚注不拼装登录指引，一律给重试', () => {
    const loginNote = formatAgentLocalFallbackNote(
      '本轮未完成，请稍后重试。',
      new BusinessError('E_AGENT_UNAUTHORIZED', '认证失效。', 'SECURITY', false)
    );
    expect(loginNote).toContain('重试');
    expect(loginNote).not.toContain('Gateway');
  });
});

// ---------------------------------------------------------------------------
// 集成测试：通过可注入 mock adapter 模拟 4 种端到端场景
// ---------------------------------------------------------------------------

function makeMockAdapter(opts: {
  scenario: 'session-create-fail' | 'stream-error' | 'queue-error' | 'success' | 'interruptible';
  threadId?: string;
  streamError?: BusinessError;
}): AgentAdapter {
  const threadId = opts.threadId ?? 'mock-thread-001';
  const okResult = <T>(value: T): Result<T, BusinessError> => ok(value);

  const session: AgentSession & {
    sendQueued(opts?: { queuedSubmissionId?: string; approvalPolicy?: string }): AsyncIterable<AgentEvent>;
  } = {
    sessionId: 'mock-sess',
    threadId,
    async *send(_input): AsyncIterable<AgentEvent> {
      if (opts.scenario === 'stream-error') {
        yield { type: 'TEXT_DELTA', delta: '部分回复' };
        yield {
          type: 'ERROR',
          error:
            opts.streamError ??
            new BusinessError('E_AGENT_STREAM', '流式中断，请重试。', 'AGENT_RUNTIME'),
        };
        return;
      }
      if (opts.scenario === 'interruptible') {
        yield { type: 'TEXT_DELTA', delta: '第1段' };
        yield { type: 'TEXT_DELTA', delta: '第2段' };
        yield { type: 'TEXT_DELTA', delta: '第3段' };
        yield { type: 'COMPLETED', finalOutput: '第1段第2段第3段' };
        return;
      }
      yield { type: 'TEXT_DELTA', delta: '你好，这是 mock 回复。' };
      yield { type: 'COMPLETED', finalOutput: '你好，这是 mock 回复。' };
    },
    async *sendQueued(_options: { queuedSubmissionId?: string; approvalPolicy?: string } = {}): AsyncIterable<AgentEvent> {
      if (opts.scenario === 'queue-error') {
        yield {
          type: 'ERROR',
          error: new BusinessError('E_AGENT_QUEUE', '队列启动失败，请重试。', 'AGENT_RUNTIME', true),
        };
        return;
      }
      yield { type: 'TEXT_DELTA', delta: '队列回复' };
      yield { type: 'COMPLETED', finalOutput: '队列回复' };
    },
    async submitToolResult() {
      return okResult(undefined);
    },
    async submitApproval() {
      return okResult(undefined);
    },
    async steer() {
      return okResult(undefined);
    },
    async interrupt() {
      return okResult(undefined);
    },
    async close() {
      return okResult(undefined);
    },
  };

  const adapter = {
    id: 'mock',
    name: 'Mock',
    async createSession(): Promise<Result<AgentSession, BusinessError>> {
      if (opts.scenario === 'session-create-fail') {
        return err(
          new BusinessError(
            'E_AGENT_SESSION_CREATE',
            'Agent 会话创建失败，请重试。',
            'AGENT_RUNTIME',
            true
          )
        );
      }
      return okResult(session);
    },
    async resumeSession(): Promise<Result<AgentSession, BusinessError>> {
      return okResult(session);
    },
    async queueList(): Promise<Result<{ items: unknown[] }, BusinessError>> {
      return okResult({ items: [] });
    },
  };

  return adapter as unknown as AgentAdapter;
}

function getSummary(envelopes: WsEnvelope[]): TurnExecutionSummary | undefined {
  const done = envelopes.find((e) => e.type === WsEventTypes.AGENT_TURN_COMPLETED);
  return done?.payload as TurnExecutionSummary | undefined;
}

function collectStreamedText(envelopes: WsEnvelope[]): string {
  return envelopes
    .filter((e) => e.type === WsEventTypes.AGENT_TEXT_DELTA)
    .map((e) => {
      const payload = e.payload as { delta?: string; textDelta?: string; finalOutput?: string };
      return String(payload?.delta ?? payload?.textDelta ?? '');
    })
    .join('');
}

/** 创建 WS 学习会话，返回其 id（供后续 turn/queue 信封复用） */
function createWsSession(server: GatewayServer): string {
  const res = server.sessionManager.createSession('student_web_01', 'ja', 'N4');
  if (!isOk(res)) throw new Error('createSession failed');
  return res.value.id;
}

function makeTurnEnvelope(sessionId: string, input = '请帮我讲解这个语法点'): WsEnvelope {
  return {
    version: '1.0',
    id: `env_${sessionId}`,
    sessionId,
    type: WsEventTypes.CLIENT_TURN_SEND,
    payload: {
      userId: 'student_web_01',
      input,
      intent: 'FREE_COACH',
      contextSnapshot: { targetLanguage: 'ja' },
      agentOptions: { lane: 'coach' },
    },
    timestamp: Date.now(),
  };
}

function makeQueueStartEnvelope(sessionId: string): WsEnvelope {
  return {
    version: '1.0',
    id: `env_q_${sessionId}`,
    sessionId,
    type: WsEventTypes.CLIENT_QUEUE_START,
    payload: { lane: 'coach' },
    timestamp: Date.now(),
  };
}

describe('P3-C Gateway 回合执行摘要（4 场景端到端）', () => {
  let repo: DrizzleLearnerRepository;

  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  it('场景1 建会话失败：Agent createSession 失败 → fallback + 结构化 failure', async () => {
    const server = new GatewayServer(repo, makeMockAdapter({ scenario: 'session-create-fail' }));
    const sessionId = createWsSession(server);
    const envelopes: WsEnvelope[] = [];
    const res = await server.handleClientMessage(makeTurnEnvelope(sessionId), (e) =>
      envelopes.push(e)
    );
    expect(isOk(res)).toBe(true);

    const summary = getSummary(envelopes);
    expect(summary).toBeDefined();
    expect(summary?.status).toBe('COMPLETED');
    expect(summary?.outcome).toBe('fallback');
    expect(summary?.source).toBe('local');
    expect(summary?.failure).toBeDefined();
    expect(summary?.failure?.category).toBe('SESSION_CREATE');
    expect(summary?.failure?.code).toBe('E_AGENT_SESSION_CREATE');
    expect(summary?.failure?.userMessage).toBe('Agent 会话创建失败，请重试。');
    expect(summary?.failure?.retryable).toBe(true);
    expect((summary as unknown as { agentOutcome?: unknown })?.agentOutcome).toBe('fallback');
    expect((summary as unknown as { codexOutcome?: unknown })?.codexOutcome).toBe('fallback');
    expect(typeof summary?.elapsedMs).toBe('number');
    expect(summary?.failure?.userMessage).not.toMatch(/ECONN|fetch failed|stack/i);
  });

  it('场景2 流中失败：Agent 流式 ERROR → fallback + STREAM failure', async () => {
    const server = new GatewayServer(repo, makeMockAdapter({ scenario: 'stream-error' }));
    const sessionId = createWsSession(server);
    const envelopes: WsEnvelope[] = [];
    const res = await server.handleClientMessage(makeTurnEnvelope(sessionId), (e) =>
      envelopes.push(e)
    );
    expect(isOk(res)).toBe(true);

    const summary = getSummary(envelopes);
    expect(summary?.status).toBe('COMPLETED');
    expect(summary?.outcome).toBe('fallback');
    expect(summary?.failure?.category).toBe('STREAM');
    expect(summary?.failure?.code).toBe('E_AGENT_STREAM');
    expect(summary?.failure?.userMessage).toBe('流式中断，请重试。');
  });

  it('对象形 TurnError 回退文案带原文，且不误导检查 Gateway', async () => {
    // 对象形错误直接构造（不再经 App Server 通知映射）：回退文案必须带原文、无 [object Object]。
    const streamError = new BusinessError(
      'E_AGENT_TURN',
      'model stream aborted after retry (upstream reset)',
      'AGENT_RUNTIME',
      true
    );
    const server = new GatewayServer(
      repo,
      makeMockAdapter({ scenario: 'stream-error', streamError })
    );
    const sessionId = createWsSession(server);
    const envelopes: WsEnvelope[] = [];
    const res = await server.handleClientMessage(makeTurnEnvelope(sessionId), (e) =>
      envelopes.push(e)
    );
    expect(isOk(res)).toBe(true);

    const summary = getSummary(envelopes);
    const reply = collectStreamedText(envelopes);
    expect(summary?.outcome).toBe('fallback');
    expect(summary?.failure?.code).toBe('E_AGENT_TURN');
    expect(summary?.failure?.userMessage).toContain('model stream aborted after retry');
    expect(reply).toContain('model stream aborted after retry');
    expect(reply).toContain('重试');
    expect(reply).not.toContain('Gateway');
    expect(reply).not.toContain('一点小问题');
    expect(reply).not.toContain('[object Object]');
  });

  it('场景3 队列失败：sendQueued ERROR → FAILED + QUEUE failure', async () => {
    const server = new GatewayServer(repo, makeMockAdapter({ scenario: 'queue-error' }));
    const sessionId = createWsSession(server);
    const envelopes: WsEnvelope[] = [];
    const turnRes = await server.handleClientMessage(makeTurnEnvelope(sessionId), (e) =>
      envelopes.push(e)
    );
    expect(isOk(turnRes)).toBe(true);
    expect(getSummary(envelopes)?.outcome).toBe('streamed');

    envelopes.length = 0;
    const qRes = await server.handleClientMessage(makeQueueStartEnvelope(sessionId), (e) =>
      envelopes.push(e)
    );
    expect(isOk(qRes)).toBe(true);

    const summary = getSummary(envelopes);
    expect(summary?.status).toBe('FAILED');
    expect(summary?.outcome).toBe('fallback');
    expect(summary?.fromQueue).toBe(true);
    expect(summary?.failure?.category).toBe('QUEUE');
    expect(summary?.failure?.code).toBe('E_AGENT_QUEUE');
    expect(summary?.failure?.userMessage).toBe('队列启动失败，请重试。');
    expect(summary?.failure?.retryable).toBe(true);
  });

  it('场景4 用户中断：CLIENT_TURN_INTERRUPT → INTERRUPTED + INTERRUPTED failure', async () => {
    const server = new GatewayServer(repo, makeMockAdapter({ scenario: 'interruptible' }));
    const sessionId = createWsSession(server);
    const envelopes: WsEnvelope[] = [];

    const handlePromise = server.handleClientMessage(makeTurnEnvelope(sessionId), (evt) => {
      envelopes.push(evt);
      if (evt.type === WsEventTypes.AGENT_TEXT_DELTA && envelopes.length === 2) {
        void server.handleClientMessage({
          version: '1.0',
          id: 'env_interrupt_call',
          sessionId,
          type: WsEventTypes.CLIENT_TURN_INTERRUPT,
          payload: { lane: 'coach' },
          timestamp: Date.now(),
        });
      }
    });

    const res = await handlePromise;
    expect(isOk(res)).toBe(true);

    const summary = getSummary(envelopes);
    expect(summary?.status).toBe('INTERRUPTED');
    expect(summary?.failure?.category).toBe('INTERRUPTED');
    expect(summary?.failure?.code).toBe('E_TURN_INTERRUPTED');
    expect(summary?.failure?.userMessage).toBe('本轮已中断。');
    expect(summary?.failure?.userMessage).not.toMatch(/ECONN|stack|fetch failed/i);
  });
});

describe('关键词模板已删除：触发词不再截获回合，一律经 AgentRouter', () => {
  let repo: DrizzleLearnerRepository;

  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  // 导师抽屉首轮 prompt 样例：含“例句”脚手架文字，但用户本意是讲解假名
  const tutorPrompt =
    '你是面向母语为中文的学习者的日语导师。请用中文讲解，例句与术语使用日语。' +
    '根据当前题目做简短导入讲解（3–6 句），点明考点「五十音权威底座」。题干：请深度剖析假名。';

  function makeTutorEnvelope(
    sessionId: string
  ): WsEnvelope {
    return {
      version: '1.0',
      id: `env_tutor_${sessionId}`,
      sessionId,
      type: WsEventTypes.CLIENT_TURN_SEND,
      payload: {
        userId: 'student_web_01',
        input: tutorPrompt,
        intent: 'EXPLAIN',
        contextSnapshot: { targetLanguage: 'ja' },
        agentOptions: {
          lane: 'learning',
        },
      },
      timestamp: Date.now(),
    };
  }

  it('含“例句”脚手架的拼装 prompt 直达 Agent（streamed），不再被模板截获', async () => {
    const server = new GatewayServer(repo, makeMockAdapter({ scenario: 'success' }));
    const sessionId = createWsSession(server);
    const envelopes: WsEnvelope[] = [];
    const res = await server.handleClientMessage(makeTutorEnvelope(sessionId), (e) =>
      envelopes.push(e)
    );
    expect(isOk(res)).toBe(true);
    const summary = getSummary(envelopes);
    expect(summary?.outcome).toBe('streamed');
    expect(summary?.source).toBe('agent');
  });
});

describe('client.tool.result：客户端工具回执只确认、永不报错', () => {
  let repo: DrizzleLearnerRepository;

  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  function makeToolResultEnvelope(payload: unknown): WsEnvelope {
    return {
      version: '1.0',
      id: 'env_tool_result',
      sessionId: 'sess_tool_result',
      type: WsEventTypes.CLIENT_TOOL_RESULT,
      payload,
      timestamp: Date.now(),
    };
  }

  it('正常回执 → TOOL_RESULT_ACK，不再报 E_UNSUPPORTED_EVENT', async () => {
    const server = new GatewayServer(repo, makeMockAdapter({ scenario: 'success' }));
    const res = await server.handleClientMessage(
      makeToolResultEnvelope({ callId: 'call_1', toolName: 'ui.present', ok: true })
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.type).toBe(WsEventTypes.AGENT_TURN_COMPLETED);
    const payload = res.value.payload as { status?: unknown; toolName?: unknown };
    expect(payload.status).toBe('TOOL_RESULT_ACK');
    expect(payload.toolName).toBe('ui.present');
  });

  it('畸形回执同样确认（永不抛错中断回合）', async () => {
    const server = new GatewayServer(repo, makeMockAdapter({ scenario: 'success' }));
    const res = await server.handleClientMessage(makeToolResultEnvelope({}));
    expect(isOk(res)).toBe(true);
  });
});

