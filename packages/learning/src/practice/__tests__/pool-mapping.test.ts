import { describe, expect, it } from 'bun:test';
import {
  mapPoolQuestion,
  mapQuestionType,
  type PoolQuestionRow,
} from '../index.js';

/** M7-18 池行映射测试（纯逻辑；DB 行以降级结构化输入表达）。 */
function row(over: Partial<PoolQuestionRow> = {}): PoolQuestionRow {
  return {
    id: 'q1',
    type: 'CHOICE',
    prompt: 'P',
    content: 'C',
    options: ['a', 'b'],
    correctAnswer: 'a',
    explanation: 'E',
    testedSkillId: 'en.test',
    difficulty: 2,
    ...over,
  };
}

describe('mapQuestionType', () => {
  it('双向别名映射', () => {
    expect(mapQuestionType('CHOICE')).toBe('MULTIPLE_CHOICE');
    expect(mapQuestionType('MULTIPLE_CHOICE')).toBe('MULTIPLE_CHOICE');
    expect(mapQuestionType('FILL_BLANK')).toBe('FILL_IN_BLANK');
    expect(mapQuestionType('FILL_IN_BLANK')).toBe('FILL_IN_BLANK');
    expect(mapQuestionType('REORDER')).toBe('SENTENCE_REORDER');
    expect(mapQuestionType('SENTENCE_REORDER')).toBe('SENTENCE_REORDER');
    expect(mapQuestionType('TRANSLATION')).toBe('TRANSLATION');
    expect(mapQuestionType('DICTATION')).toBe('LISTENING_DICTATION');
    expect(mapQuestionType('LISTENING_DICTATION')).toBe('LISTENING_DICTATION');
  });

  it('未知/非法回退 MULTIPLE_CHOICE（大小写不敏感）', () => {
    expect(mapQuestionType('BOGUS')).toBe('MULTIPLE_CHOICE');
    expect(mapQuestionType(undefined)).toBe('MULTIPLE_CHOICE');
    expect(mapQuestionType(42)).toBe('MULTIPLE_CHOICE');
    expect(mapQuestionType('choice')).toBe('MULTIPLE_CHOICE');
  });
});

describe('mapPoolQuestion', () => {
  it('完整行映射与默认规则', () => {
    const q = mapPoolQuestion(row());
    expect(q.id).toBe('q1');
    expect(q.type).toBe('MULTIPLE_CHOICE');
    expect(q.prompt).toBe('P');
    expect(q.content).toBe('C');
    expect(q.options).toEqual(['a', 'b']);
    expect(q.correctAnswer).toBe('a');
    expect(q.explanation).toBe('E');
    expect(q.testedSkillId).toBe('en.test');
    expect(q.difficultyTier).toBe(2);
    expect(q.dictation).toBeUndefined();
  });

  it('缺字段默认值：空串/testedSkill 回退 review/难度 3', () => {
    const q = mapPoolQuestion({ testedSkill: 'en.fallback' });
    expect(q.id).toBe('');
    expect(q.type).toBe('MULTIPLE_CHOICE');
    expect(q.prompt).toBe('');
    expect(q.options).toBeUndefined();
    expect(q.testedSkillId).toBe('en.fallback');
    expect(q.difficultyTier).toBe(3);
    const q2 = mapPoolQuestion({});
    expect(q2.testedSkillId).toBe('review');
  });

  it('options 非数组 → undefined（不臆造）', () => {
    expect(mapPoolQuestion(row({ options: 'a,b' })).options).toBeUndefined();
    // 非字符串数组原样透传（与原实现一致：只判 Array，不判元素类型）
    const passthrough = mapPoolQuestion(row({ options: [1, 2] as unknown as string[] })).options;
    expect(passthrough as unknown).toEqual([1, 2]);
  });

  it('dictation 完整透传条件字段，不完整丢弃', () => {
    const full = mapPoolQuestion(
      row({ dictation: { fullJapanese: '日本語', speaker: 's', chinese: '日语', extra: 1 } })
    );
    expect(full.dictation).toEqual({ fullJapanese: '日本語', speaker: 's', chinese: '日语' });
    expect(mapPoolQuestion(row({ dictation: { speaker: 's' } })).dictation).toBeUndefined();
    expect(mapPoolQuestion(row({ dictation: 'str' })).dictation).toBeUndefined();
    expect(mapPoolQuestion(row()).dictation).toBeUndefined();
  });
});
