import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { startGatewayServer } from '../index.js';
import { WsEventTypes, type WsEnvelope } from '@study-studio/protocol';
import { generateId } from '@study-studio/shared';

describe('Gateway WebSocket Server E2E', () => {
  const TEST_PORT = 8999;
  let server: ReturnType<typeof startGatewayServer>;

  /** WS 回包 payload 的测试期字段探测（未知形状按 key 读取，不断言时不抛）。 */
  const payloadField = (envelope: WsEnvelope, key: string): unknown =>
    ((envelope.payload ?? {}) as Record<string, unknown>)[key];

  beforeAll(() => {
    server = startGatewayServer(TEST_PORT);
  });

  afterAll(() => {
    server.stop(true);
  });

  it('should respond to HTTP health check', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status?: unknown;
      service?: unknown;
      bootId?: unknown;
      startedAt?: unknown;
      version?: unknown;
    };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('Lingua Studio Agent Gateway');
    // AGENTS §7.3 身份握手：bootId + 启动时间 + 版本号；同一进程两次握手 bootId 稳定。
    expect(typeof body.bootId).toBe('string');
    expect((body.bootId as string).length).toBeGreaterThan(0);
    expect(typeof body.startedAt).toBe('string');
    expect(typeof body.version).toBe('string');
    const res2 = await fetch(`http://localhost:${TEST_PORT}/api/health`);
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { bootId?: unknown };
    expect(body2.bootId).toBe(body.bootId);
  });

  it('should establish WebSocket connection and handle session init + ping + quiz submit', async () => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws`);

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(e);
    });

    const testUserId = generateId('student_e2e');
    let activeSessionId = '';

    // 1. 发送 session.init
    const initEnvelope: WsEnvelope = {
      version: '1.0',
      id: generateId('msg'),
      sessionId: 'temp_init',
      type: WsEventTypes.CLIENT_SESSION_INIT,
      payload: { userId: testUserId, targetLanguage: 'ja', targetLevel: 'N3' },
      timestamp: Date.now(),
    };

    const initReplyPromise = new Promise<WsEnvelope>((resolve) => {
      const handler = (evt: MessageEvent) => {
        const data = JSON.parse(evt.data.toString()) as WsEnvelope;
        if (payloadField(data, 'status') === 'INITIALIZED') {
          ws.removeEventListener('message', handler);
          resolve(data);
        }
      };
      ws.addEventListener('message', handler);
    });

    ws.send(JSON.stringify(initEnvelope));
    const initReply = await initReplyPromise;
    expect(initReply.type).toBe(WsEventTypes.AGENT_TURN_COMPLETED);
    expect(initReply.sessionId).toBeDefined();
    activeSessionId = initReply.sessionId;

    // 2. 发送 ping
    const pingEnvelope: WsEnvelope = {
      version: '1.0',
      id: generateId('msg'),
      sessionId: activeSessionId,
      type: WsEventTypes.CLIENT_PING,
      payload: {},
      timestamp: Date.now(),
    };

    const pongPromise = new Promise<WsEnvelope>((resolve) => {
      const handler = (evt: MessageEvent) => {
        const data = JSON.parse(evt.data.toString()) as WsEnvelope;
        if (data.type === WsEventTypes.GATEWAY_PONG) {
          ws.removeEventListener('message', handler);
          resolve(data);
        }
      };
      ws.addEventListener('message', handler);
    });

    ws.send(JSON.stringify(pingEnvelope));
    const pongReply = await pongPromise;
    expect(pongReply.type).toBe(WsEventTypes.GATEWAY_PONG);

    // 3. 发送 quiz.submit 并验证写入 SQLite
    const quizEnvelope: WsEnvelope = {
      version: '1.0',
      id: generateId('msg'),
      sessionId: activeSessionId,
      type: WsEventTypes.CLIENT_QUIZ_SUBMIT,
      payload: {
        userId: testUserId,
        questionId: 'q_ws_test',
        userAnswer: 'A',
        isCorrect: true,
        score: 1.0,
        timeSpentMs: 2500,
        testedSkillId: 'jp.particle.wa',
      },
      timestamp: Date.now(),
    };

    const quizPromise = new Promise<WsEnvelope>((resolve) => {
      const handler = (evt: MessageEvent) => {
        const data = JSON.parse(evt.data.toString()) as WsEnvelope;
        if (payloadField(data, 'status') === 'RECORDED') {
          ws.removeEventListener('message', handler);
          resolve(data);
        }
      };
      ws.addEventListener('message', handler);
    });

    ws.send(JSON.stringify(quizEnvelope));
    const quizReply = await quizPromise;
    expect(payloadField(quizReply, 'persistedToDb')).toBe(true);

    // 4. 先讲后测：新用户系统出题先被讲义锁拦 → 学完讲义 → 再出题放行
    const lockRes = await fetch(`http://localhost:${TEST_PORT}/api/lessons/${testUserId}?lang=ja`);
    expect(lockRes.status).toBe(200);
    const lockList = (await lockRes.json()) as Array<{ skillId: string; completed: boolean }>;
    expect(lockList.some((l) => l.skillId === 'jp.particle.ni_vs_de')).toBe(true);
    const completeRes = await fetch(
      `http://localhost:${TEST_PORT}/api/lessons/${testUserId}/complete`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillId: 'jp.particle.ni_vs_de' }),
      }
    );
    expect(completeRes.status).toBe(200);

    // 5. 发送 quiz.generate 自适应出题
    const genEnvelope: WsEnvelope = {
      version: '1.0',
      id: generateId('msg'),
      sessionId: activeSessionId,
      type: WsEventTypes.CLIENT_QUIZ_GENERATE,
      payload: { userId: testUserId, targetLanguage: 'ja', count: 1 },
      timestamp: Date.now(),
    };

    const genPromise = new Promise<WsEnvelope>((resolve) => {
      const handler = (evt: MessageEvent) => {
        const data = JSON.parse(evt.data.toString()) as WsEnvelope;
        if (Array.isArray(payloadField(data, 'questions'))) {
          ws.removeEventListener('message', handler);
          resolve(data);
        }
      };
      ws.addEventListener('message', handler);
    });

    ws.send(JSON.stringify(genEnvelope));
    const genReply = await genPromise;
    expect((payloadField(genReply, 'questions') as unknown[])?.length).toBe(1);
    expect(payloadField(genReply, 'targetSkillId')).toBeDefined();

    // 6. 发送 quiz.grade_subjective 主观题多维深度批改
    const gradeEnvelope: WsEnvelope = {
      version: '1.0',
      id: generateId('msg'),
      sessionId: activeSessionId,
      type: WsEventTypes.CLIENT_QUIZ_GRADE_SUBJECTIVE,
      payload: {
        userId: testUserId,
        questionId: 'q_ws_trans',
        prompt: '翻译：在图书馆学习。',
        standardAnswer: '図書館で勉強します。',
        userSubmission: '図書館勉強します。', // 缺格助词 で
        testedSkillId: 'jp.particle.ni_vs_de',
      },
      timestamp: Date.now(),
    };

    const gradePromise = new Promise<WsEnvelope>((resolve) => {
      const handler = (evt: MessageEvent) => {
        const data = JSON.parse(evt.data.toString()) as WsEnvelope;
        if (payloadField(data, 'errorDiagnosis') !== undefined) {
          ws.removeEventListener('message', handler);
          resolve(data);
        }
      };
      ws.addEventListener('message', handler);
    });

    ws.send(JSON.stringify(gradeEnvelope));
    const gradeReply = await gradePromise;
    // 7. 测试 CLIENT_PROFILE_GET & CLIENT_PROFILE_UPDATE
    const profileGetEnvelope: WsEnvelope = {
      version: '1.0',
      id: generateId('msg'),
      sessionId: activeSessionId,
      type: WsEventTypes.CLIENT_PROFILE_GET,
      payload: { userId: testUserId },
      timestamp: Date.now(),
    };

    const profileGetPromise = new Promise<WsEnvelope>((resolve) => {
      const handler = (evt: MessageEvent) => {
        const data = JSON.parse(evt.data.toString()) as WsEnvelope;
        if (payloadField(data, 'userId') === testUserId) {
          ws.removeEventListener('message', handler);
          resolve(data);
        }
      };
      ws.addEventListener('message', handler);
    });

    ws.send(JSON.stringify(profileGetEnvelope));
    const profileGetReply = await profileGetPromise;
    expect(payloadField(profileGetReply, 'studyGoal')).toBe('JLPT_N2');

    // 8. 测试更新 profile
    const profileUpdateEnvelope: WsEnvelope = {
      version: '1.0',
      id: generateId('msg'),
      sessionId: activeSessionId,
      type: WsEventTypes.CLIENT_PROFILE_UPDATE,
      payload: {
        userId: testUserId,
        displayName: '极光学者',
        studyGoal: 'JLPT_N1',
        dailyGoalQuizzes: 6,
      },
      timestamp: Date.now(),
    };

    const profileUpdatePromise = new Promise<WsEnvelope>((resolve) => {
      const handler = (evt: MessageEvent) => {
        const data = JSON.parse(evt.data.toString()) as WsEnvelope;
        if (data.type === WsEventTypes.LEARNER_PROFILE_UPDATED) {
          ws.removeEventListener('message', handler);
          resolve(data);
        }
      };
      ws.addEventListener('message', handler);
    });

    ws.send(JSON.stringify(profileUpdateEnvelope));
    const profileUpdateReply = await profileUpdatePromise;
    expect(payloadField(profileUpdateReply, 'displayName')).toBe('极光学者');
    expect(payloadField(profileUpdateReply, 'studyGoal')).toBe('JLPT_N1');
    expect(payloadField(profileUpdateReply, 'dailyGoalQuizzes')).toBe(6);

    // 9. 测试 HTTP 每日打卡端点
    const taskHttpRes = await fetch(`http://localhost:${TEST_PORT}/api/task/progress/${testUserId}`);
    expect(taskHttpRes.status).toBe(200);
    const taskBody = await taskHttpRes.json();
    expect(taskBody.dailyGoalQuizzes).toBe(6);

    ws.close();
  });
});
