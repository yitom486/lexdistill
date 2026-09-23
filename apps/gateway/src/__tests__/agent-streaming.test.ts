import { describe, it, expect, beforeEach } from 'bun:test';
import { GatewayServer } from '../runtime/gateway-runtime.js';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { WsEventTypes, type WsEnvelope } from '@study-studio/protocol';
import { isOk, ok } from '@study-studio/shared';
import type { AgentEvent, AgentSession } from '@study-studio/agent-runtime';
import type { CodexAdapter } from '@study-studio/agent-runtime';
import { LearningContentTool } from '../modules/learning-content/public.js';
import { LearningAssessTool } from '../modules/practice/tools/learning-assess-tool.js';

/**
 * 确定性 mock adapter：模板短路删除后，流式回合必须走真实 adapter 通路；
 * 此处用 mock 保证不断网可测（此前两用例误用模板短路秒回）。
 */
function makeStreamingMockAdapter(): CodexAdapter {
  const session: AgentSession = {
    sessionId: 'mock-stream-sess',
    threadId: 'mock-thread-stream',
    async *send(): AsyncIterable<AgentEvent> {
      yield { type: 'TEXT_DELTA', delta: '助词「に」表示存在场所，' };
      yield { type: 'TEXT_DELTA', delta: '「で」表示动作场所。' };
      yield {
        type: 'COMPLETED',
        finalOutput: '助词「に」表示存在场所，「で」表示动作场所。',
      };
    },
    async submitToolResult() {
      return ok(undefined);
    },
    async submitApproval() {
      return ok(undefined);
    },
    async steer() {
      return ok(undefined);
    },
    async interrupt() {
      return ok(undefined);
    },
    async close() {
      return ok(undefined);
    },
  };
  return {
    id: 'mock-stream',
    name: 'MockStream',
    async createSession() {
      return ok(session);
    },
    async resumeSession() {
      return ok(session);
    },
    async queueList() {
      return ok({ items: [] });
    },
  } as unknown as CodexAdapter;
}

describe('AI Native Agent Streaming & Parameterized Tools', () => {
  let server: GatewayServer;
  let repo: DrizzleLearnerRepository;

  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
    server = new GatewayServer(repo);
  });

  it('should stream agent turn with AGENT_TURN_START, AGENT_TEXT_DELTA, and AGENT_TURN_COMPLETED', async () => {
    const server = new GatewayServer(repo, makeStreamingMockAdapter());
    const emittedEvents: WsEnvelope[] = [];
    const envelope: WsEnvelope = {
      version: '1.0',
      id: 'env_stream_test',
      sessionId: 'sess_user_test',
      type: WsEventTypes.CLIENT_TURN_SEND,
      payload: {
        userId: 'student_web_01',
        input: '请给我几个关于助词的例句',
        intent: 'EXPLAIN',
        contextSnapshot: {
          targetLanguage: 'ja',
          focus: {
            kind: 'QUESTION',
            surface: '助词「に」与「で」',
            skillTag: 'jp.particle.ni_vs_de',
          },
        },
      },
      timestamp: Date.now(),
    };

    const res = await server.handleClientMessage(envelope, (evt) => {
      emittedEvents.push(evt);
    });

    expect(isOk(res)).toBe(true);

    // 验证事件流序列
    const types = emittedEvents.map((e) => e.type);
    expect(types).toContain(WsEventTypes.AGENT_TURN_START);
    expect(types).toContain(WsEventTypes.AGENT_TEXT_DELTA);
    expect(types).toContain(WsEventTypes.AGENT_TURN_COMPLETED);

    // 验证 Delta 文本流非空
    const deltas = emittedEvents.filter((e) => e.type === WsEventTypes.AGENT_TEXT_DELTA);
    expect(deltas.length).toBeGreaterThan(1);
    const accumulatedText = deltas
      .map((d) => {
        const delta = (d.payload as { delta?: unknown }).delta;
        return typeof delta === 'string' ? delta : '';
      })
      .join('');
    expect(accumulatedText).toContain('助词');

    // 验证最终完成事件：模板短路删除后必须为 Codex streamed，不再是 not_requested
    const completeEvt = emittedEvents.find((e) => e.type === WsEventTypes.AGENT_TURN_COMPLETED);
    expect(completeEvt).toBeDefined();
    const completedPayload = (completeEvt?.payload ?? {}) as {
      status?: unknown;
      finalOutput?: unknown;
      outcome?: unknown;
      source?: unknown;
    };
    expect(completedPayload.status).toBe('COMPLETED');
    expect(completedPayload.finalOutput).toBe(accumulatedText);
    expect(completedPayload.outcome).toBe('streamed');
    expect(completedPayload.source).toBe('codex');
  });

  it('should allow CLIENT_TURN_INTERRUPT to halt streaming generation', async () => {
    const server = new GatewayServer(repo, makeStreamingMockAdapter());
    const emittedEvents: WsEnvelope[] = [];
    const sessionId = 'sess_interrupt_test';

    const envelope: WsEnvelope = {
      version: '1.0',
      id: 'env_interrupt_test',
      sessionId,
      type: WsEventTypes.CLIENT_TURN_SEND,
      payload: {
        userId: 'student_web_01',
        input: '请详细讲透这个语法点的所有考点辨析和规则',
      },
      timestamp: Date.now(),
    };

    // 启动流式，并在第一次收到 delta 后立即发起打断
    const handlePromise = server.handleClientMessage(envelope, (evt) => {
      emittedEvents.push(evt);
      if (evt.type === WsEventTypes.AGENT_TEXT_DELTA && emittedEvents.length === 2) {
        // 立即触发打断
        void server.handleClientMessage({
          version: '1.0',
          id: 'env_interrupt_call',
          sessionId,
          type: WsEventTypes.CLIENT_TURN_INTERRUPT,
          payload: {},
          timestamp: Date.now(),
        });
      }
    });

    const res = await handlePromise;
    expect(isOk(res)).toBe(true);

    // 验证流被中止并且状态为 INTERRUPTED
    const completeEvt = emittedEvents.find(
      (e) =>
        e.type === WsEventTypes.AGENT_TURN_COMPLETED &&
        (e.payload as { status?: unknown }).status === 'INTERRUPTED'
    );
    expect(completeEvt).toBeDefined();
  });

  it('should execute learning.content tool with parameterized actions', async () => {
    const tool = server.toolRegistry.get('learning.content') as LearningContentTool;
    expect(tool).toBeDefined();

    // 1. generate_quiz
    const quizRes = await tool.execute(
      {
        action: 'generate_quiz',
        count: 2,
        difficulty: 3,
        skillIds: ['jp.particle.ni_vs_de'],
        language: 'ja',
      },
      { userId: 'student_web_01', sessionId: 's1' }
    );
    expect(isOk(quizRes)).toBe(true);
    if (isOk(quizRes)) {
      expect(quizRes.value.questions).toHaveLength(2);
      expect(quizRes.value.questions?.[0]?.testedSkillId).toBe('jp.particle.ni_vs_de');
    }

    // 2. explain
    const explainRes = await tool.execute(
      {
        action: 'explain',
        topic: '格助词辨析',
        language: 'ja',
      },
      { userId: 'student_web_01', sessionId: 's1' }
    );
    expect(isOk(explainRes)).toBe(true);
    if (isOk(explainRes)) {
      expect(explainRes.value.explanation).toBeDefined();
      expect(explainRes.value.explanation?.rules.length).toBeGreaterThan(0);
      expect(explainRes.value.explanation?.mnemonicTip).toBeDefined();
    }

    // 3. example_set
    const exampleRes = await tool.execute(
      {
        action: 'example_set',
        topic: '助词',
        language: 'ja',
      },
      { userId: 'student_web_01', sessionId: 's1' }
    );
    expect(isOk(exampleRes)).toBe(true);
    if (isOk(exampleRes)) {
      expect(exampleRes.value.examples?.length).toBe(3);
    }
  });

  it('should execute learning.assess tool for objective matching and subjective diagnosis', async () => {
    const tool = server.toolRegistry.get('learning.assess') as LearningAssessTool;
    expect(tool).toBeDefined();

    // 1. 精确匹配
    const exactRes = await tool.execute(
      {
        prompt: '选择助词',
        standardAnswer: 'で',
        userSubmission: 'で',
        testedSkillId: 'jp.particle.ni_vs_de',
      },
      { userId: 'student_web_01', sessionId: 's1' }
    );
    expect(isOk(exactRes)).toBe(true);
    if (isOk(exactRes) && !('results' in exactRes.value)) {
      expect(exactRes.value.isCorrect).toBe(true);
      expect(exactRes.value.score).toBe(100);
      expect(exactRes.value.mistakeDetected).toBe(false);
    }

    // 2. 负迁移混淆诊断 (例如输入 'に' 对应正解 'で')
    const diagRes = await tool.execute(
      {
        prompt: '选择场所助词',
        standardAnswer: 'で',
        userSubmission: 'に',
        testedSkillId: 'jp.particle.ni_vs_de',
      },
      { userId: 'student_web_01', sessionId: 's1' }
    );
    expect(isOk(diagRes)).toBe(true);
    if (isOk(diagRes) && !('results' in diagRes.value)) {
      expect(diagRes.value.isCorrect).toBe(false);
      expect(diagRes.value.mistakeDetected).toBe(true);
      expect(diagRes.value.grammarFeedback).toContain('归着点');
      expect(diagRes.value.negativeTransferTag).toBe('PARTICLE_NI_INSTEAD_OF_DE');
    }
  });
});
