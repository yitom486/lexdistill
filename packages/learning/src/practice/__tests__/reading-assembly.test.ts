import { describe, expect, it } from 'bun:test';
import { ok, err, BusinessError } from '@lexdistill/shared';
import type { PracticeBlockSpec, ReadingPassageSet } from '@lexdistill/protocol';
import {
  buildReadingQuestions,
  type ReadingQuestionPorts,
} from '../index.js';

/** M7-17 阅读装配用例测试（port 桩，不碰仓储/门控）。 */
function block(count = 5): PracticeBlockSpec {
  return { id: 'b1', kind: 'READING', count, gradingMode: 'AUTO_IMMEDIATE' };
}

function set(
  id: string,
  difficulty: number,
  questionCount: number
): ReadingPassageSet {
  return {
    id,
    origin: 'user_import',
    title: `Title ${id}`,
    topic: '综合',
    difficulty,
    language: 'EN',
    sourceLabel: 'test',
    body: `Body ${id}`,
    questions: Array.from({ length: questionCount }, (_, i) => ({
      id: `q${i}`,
      prompt: `P${i}`,
      options: [
        { key: 'A', text: 'opt-a' },
        { key: 'B', text: 'opt-b' },
      ],
      correctAnswer: 'A',
      explanation: `E${i}`,
    })),
  };
}

function portsWith(
  sets: ReadingPassageSet[] | 'error',
  cap: number | 'throw' = 5,
  seen?: { language?: string }
): ReadingQuestionPorts {
  return {
    listReadingSets: async (input) => {
      if (seen) seen.language = input.language;
      if (sets === 'error') return err(new BusinessError('E_DB', '库错', 'DATABASE', true));
      return ok(sets);
    },
    getTierCap: async () => {
      if (cap === 'throw') throw new Error('gate down');
      return cap;
    },
  };
}

describe('buildReadingQuestions', () => {
  it('tier cap 筛选：跳过超纲与无题篇目，取最近可用', async () => {
    const qs = await buildReadingQuestions(
      portsWith([set('hard', 5, 2), set('empty', 2, 0), set('ok', 3, 4)], 3),
      'u1',
      block(),
      'en'
    );
    expect(qs.length).toBe(4);
    expect(qs[0]?.id).toBe('read_q0');
  });

  it('count 截断与完整字段映射（含语种映射与 passage）', async () => {
    const seen: { language?: string } = {};
    const qs = await buildReadingQuestions(portsWith([set('s1', 2, 4)], 5, seen), 'u1', block(2), 'ja');
    expect(seen.language).toBe('JA');
    expect(qs.length).toBe(2);
    const q = qs[0]!;
    expect(q.type).toBe('MULTIPLE_CHOICE');
    expect(q.prompt).toBe('P0');
    expect(q.content).toBe('');
    expect(q.options).toEqual(['A. opt-a', 'B. opt-b']);
    expect(q.correctAnswer).toBe('A');
    expect(q.explanation).toBe('E0');
    expect(q.testedSkillId).toBe('jp.reading.comprehension');
    expect(q.difficultyTier).toBe(2);
    expect(q.reading).toEqual({ setId: 's1', title: 'Title s1', body: 'Body s1' });
  });

  it('空集合 / 全无题 / 查询错误 → 空数组', async () => {
    expect(await buildReadingQuestions(portsWith([]), 'u1', block(), 'en')).toEqual([]);
    expect(await buildReadingQuestions(portsWith([set('e', 1, 0)]), 'u1', block(), 'en')).toEqual([]);
    expect(await buildReadingQuestions(portsWith('error'), 'u1', block(), 'en')).toEqual([]);
  });

  it('tier cap 查询失败回退 5（难度 5 篇目仍可选）', async () => {
    const qs = await buildReadingQuestions(portsWith([set('s5', 5, 1)], 'throw'), 'u1', block(), 'ko');
    expect(qs.length).toBe(1);
    expect(qs[0]?.testedSkillId).toBe('ko.reading.comprehension');
  });
});
