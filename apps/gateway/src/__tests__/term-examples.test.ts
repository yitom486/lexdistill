import { describe, expect, it, beforeEach } from 'bun:test';
import { BusinessError, isOk, ok, err } from '@study-studio/shared';
import type { AgentAdapter, AgentSession } from '@study-studio/agent-runtime';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import {
  generateTermExamples,
  getTermExamples,
} from '../modules/dictionary/application/term-examples.js';

function mockAdapter(text: string): AgentAdapter {
  const session: AgentSession = {
    sessionId: 's1',
    send: async function* () {
      yield { type: 'TEXT_DELTA' as const, delta: text };
      yield { type: 'COMPLETED' as const };
    },
    submitToolResult: async () => ok(undefined),
    submitApproval: async () => ok(undefined),
    steer: async () => ok(undefined),
    interrupt: async () => ok(undefined),
    close: async () => ok(undefined),
  };
  return {
    id: 'mock',
    name: 'mock',
    createSession: async () => ok(session),
    resumeSession: async () => ok(session),
  };
}

const AI_JSON = JSON.stringify({
  examples: [
    { sentence: 'I drink water every morning.', translation: '我每天早晨喝水。' },
    { sentence: 'The cat drinks water.', translation: '猫喝水。' },
    { sentence: 'Completely unrelated words here.', translation: '无关句子。' },
  ],
});

describe('term-examples（例句生成+缓存）', () => {
  let repo: DrizzleLearnerRepository;
  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  it('接地：例句必须包含目标词，无关句子丢弃，最多 2 条', async () => {
    const res = await generateTermExamples(mockAdapter(AI_JSON), {
      language: 'en',
      headword: 'water',
      meanings: ['水'],
    });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.length).toBe(2);
    expect(res.value.every((e) => e.sentence.toLowerCase().includes('water'))).toBe(true);
  });

  it('无模型报错 E_EXAMPLES_NO_ADAPTER；非法输入拒绝', async () => {
    const noAdapter = await generateTermExamples(undefined, {
      language: 'en',
      headword: 'water',
      meanings: ['水'],
    });
    expect(isOk(noAdapter)).toBe(false);
    const badLang = await generateTermExamples(mockAdapter(AI_JSON), {
      language: 'fr',
      headword: 'water',
      meanings: ['水'],
    });
    expect(isOk(badLang)).toBe(false);
    const garbage = await generateTermExamples(mockAdapter('not json at all'), {
      language: 'en',
      headword: 'water',
      meanings: ['水'],
    });
    expect(isOk(garbage)).toBe(false);
  });

  it('缓存优先：命中后不再调模型；未命中生成入库', async () => {
    const input = { language: 'en', headword: 'water', meanings: ['水'] };
    const first = await repo.getTermExamples(input, mockAdapter(AI_JSON));
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    expect(first.value.length).toBe(2);
    expect(first.value.every((e) => e.cached === false)).toBe(true);
    // 第二次无模型也命中
    const second = await repo.getTermExamples(input, undefined);
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    expect(second.value.length).toBe(2);
    expect(second.value.every((e) => e.cached === true)).toBe(true);
    // 无模型无缓存 → 明确报错（前端静默隐藏）
    const miss = await repo.getTermExamples(
      { language: 'en', headword: 'kjasdhfk', meanings: ['x'] },
      undefined
    );
    expect(isOk(miss)).toBe(false);
  });

  it('迁移 v10 落库', () => {
    const rows = repo
      .getRawDb()
      .query<{ version: number }, []>(
        'SELECT version AS version FROM schema_migrations ORDER BY version'
      )
      .all();
    expect(rows.map((r) => r.version)).toContain(10);
  });
});
