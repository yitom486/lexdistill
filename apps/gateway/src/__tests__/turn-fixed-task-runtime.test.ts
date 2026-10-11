import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { startGatewayServer } from '../index.js';
import { WsEventTypes, type WsEnvelope } from '@study-studio/protocol';
import { generateId } from '@study-studio/shared';

/**
 * 固定工具任务运行时门禁回归：vocabulary.explain 在未验证运行时（agy）上
 * 必须秒级 fail-fast（指引切 codex-acp），不得建会话、不得烧模型轮次、
 * 更不得挂起至 session/prompt 超时。
 */
describe('Fixed tool task runtime gate', () => {
  const TEST_PORT = 8998;
  let server: ReturnType<typeof startGatewayServer>;

  beforeAll(() => {
    server = startGatewayServer(TEST_PORT);
  });

  afterAll(() => {
    server.stop(true);
  });

  it('vocabulary.explain + agy 秒级回指引，不挂起', async () => {    const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(e);
    });

    const testUserId = generateId('student_gate');
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
        if (((data.payload ?? {}) as Record<string, unknown>)['status'] === 'INITIALIZED') {
          ws.removeEventListener('message', handler);
          resolve(data);
        }
      };
      ws.addEventListener('message', handler);
    });
    ws.send(JSON.stringify(initEnvelope));
    const initReply = await initReplyPromise;
    const activeSessionId = initReply.sessionId;

    const startedAt = Date.now();
    const turnEnvelope: WsEnvelope = {
      version: '1.0',
      id: generateId('msg'),
      sessionId: activeSessionId,
      type: WsEventTypes.CLIENT_TURN_SEND,
      payload: {
        input: '请为「おはよう」（おはよう）生成AI讲解并保存讲解：先调用 vocabulary.learning.context 读取词汇依据与任务，再按要求生成讲解内容并调用 vocabulary.learning.submit 提交保存。',
        intent: 'EXPLAIN',
        contextSnapshot: { targetLanguage: 'ja', learnerLevel: 'N3', locale: 'zh-CN' },
        agentOptions: {
          lane: 'learning',
          task: 'vocabulary.explain',
          tools: ['vocabulary.learning.context', 'vocabulary.learning.submit', 'dictionary.lookup'],
          model: 'gemini-3.8-flash-high',
          runtimeId: 'agy',
        },
      },
      timestamp: Date.now(),
    };
    const completedPromise = new Promise<WsEnvelope>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('门禁未生效：30s 内无完成回执')), 30_000);
      const handler = (evt: MessageEvent) => {
        const data = JSON.parse(evt.data.toString()) as WsEnvelope;
        // 回合完成回执带 finalOutput（初始化回执带 status，二者同 type，需区分）。
        if (data.type === WsEventTypes.AGENT_TURN_COMPLETED
          && 'finalOutput' in ((data.payload ?? {}) as Record<string, unknown>)) {
          clearTimeout(timer);
          ws.removeEventListener('message', handler);
          resolve(data);
        }
      };
      ws.addEventListener('message', handler);
    });
    ws.send(JSON.stringify(turnEnvelope));
    const completed = await completedPromise;    const elapsedMs = Date.now() - startedAt;
    const payload = (completed.payload ?? {}) as Record<string, unknown>;

    // 秒级（远小于模型超时），且是本地指引而非模型流式/回退
    expect(elapsedMs).toBeLessThan(30_000);
    expect(payload['source']).toBe('local');
    expect(payload['outcome']).toBe('not_requested');
    expect(payload['failure']).toBeUndefined();
    expect(String(payload['finalOutput'] ?? '')).toContain('codex-acp');
    expect(String(payload['finalOutput'] ?? '')).toContain('本次未发送模型请求');
    ws.close();
  }, 60_000);
});
