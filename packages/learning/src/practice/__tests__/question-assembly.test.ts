import { describe, expect, it } from 'bun:test';
import type { Flashcard, PracticeBlockSpec } from '@lexdistill/protocol';
import {
  acceptedDbTypesForBlock,
  buildVocabQuestionsFromCards,
  buildTranslationQuestionsFromCards,
} from '../index.js';

/** M7-16 题构造纯规则测试（无存储/时钟；干扰项与旋转语义锁定）。 */
function block(overrides: Partial<PracticeBlockSpec> = {}): PracticeBlockSpec {
  return { id: 'b', kind: 'QUIZ', count: 1, gradingMode: 'AUTO_IMMEDIATE', ...overrides };
}

function card(
  id: string,
  front: string,
  back: string,
  over: Partial<Flashcard> = {}
): Flashcard {
  return {
    id,
    userId: 'u1',
    type: 'VOCABULARY',
    front,
    back,
    tags: [],
    fsrs: { stability: 1, difficulty: 5, reps: 1, lapses: 0, dueAt: '2026-09-07T00:00:00.000Z', state: 'REVIEW' },
    ...over,
  };
}

describe('acceptedDbTypesForBlock', () => {
  it('各 block kind 默认题型映射', () => {
    expect(acceptedDbTypesForBlock(block({ kind: 'QUIZ' }))).toEqual(['CHOICE', 'FILL_BLANK', 'REORDER']);
    expect(acceptedDbTypesForBlock(block({ kind: 'VOCAB_REVIEW' }))).toEqual(['CHOICE', 'FILL_BLANK']);
    expect(acceptedDbTypesForBlock(block({ kind: 'TRANSLATION' }))).toEqual(['TRANSLATION']);
    expect(acceptedDbTypesForBlock(block({ kind: 'DICTATION' }))).toEqual(['DICTATION']);
    expect(acceptedDbTypesForBlock(block({ kind: 'READING' }))).toEqual(['CHOICE', 'FILL_BLANK']);
  });

  it('显式 questionFormats 覆盖默认并去重映射', () => {
    expect(
      acceptedDbTypesForBlock(block({ kind: 'QUIZ', questionFormats: ['TRANSLATION', 'TRANSLATION'] }))
    ).toEqual(['TRANSLATION']);
  });
});

describe('buildVocabQuestionsFromCards', () => {
  it('过滤非 VOCABULARY 与空面，干扰项≥2 才出题，旋转去首位', () => {
    const cards = [
      card('c1', 'elastic', '有弹性的', { tags: ['adj'] }),
      card('c2', 'fragile', '易碎的'),
      card('c3', 'visible', '可见的'),
      card('c4', 'durable', '耐用的'),
      card('s1', 'sent', '句子', { type: 'SENTENCE' }),
      card('e1', '', '空正面'),
    ];
    const qs = buildVocabQuestionsFromCards(cards, 4, 'en');
    expect(qs.length).toBe(4);
    expect(qs[0]?.id).toBe('vocab_c1');
    expect(qs[0]?.content).toBe('elastic');
    expect(qs[0]?.correctAnswer).toBe('有弹性的');
    expect(qs[0]?.options?.length).toBe(4);
    expect(qs[0]?.options).toContain('有弹性的');
    expect(qs[0]?.testedSkillId).toBe('en.vocab.review');
    expect(qs[0]?.explanation).toBe('adj');
    // i=0 不旋转：正确答案在首位；i=1 旋转一位
    expect(qs[0]?.options?.[0]).toBe('有弹性的');
    expect(qs[1]?.options?.[0]).not.toBe(qs[1]?.correctAnswer);
    // ja 语种前缀为 jp
    const ja = buildVocabQuestionsFromCards(cards, 1, 'ja');
    expect(ja[0]?.testedSkillId).toBe('jp.vocab.review');
  });

  it('干扰项不足时整轮停止（break 语义）', () => {
    const cards = [card('c1', 'a', '甲'), card('c2', 'b', '乙')];
    expect(buildVocabQuestionsFromCards(cards, 2, 'en')).toEqual([]);
  });

  it('空标签回退默认文案', () => {
    const qs = buildVocabQuestionsFromCards(
      [card('c1', 'a', '甲'), card('c2', 'b', '乙'), card('c3', 'c', '丙')],
      1,
      'en'
    );
    expect(qs[0]?.explanation).toBe('来自你的 FSRS 生词本');
  });
});

describe('buildTranslationQuestionsFromCards', () => {
  it('只吃讲透 SENTENCE 卡，未讲透/空面不进', () => {
    const cards = [
      card('s1', '原句一', '译文一', { type: 'SENTENCE', studiedAt: '2026-09-01T00:00:00.000Z' }),
      card('s2', '原句二', '译文二', { type: 'SENTENCE', studiedAt: '2026-09-01T00:00:00.000Z' }),
      card('s3', '原句三', '译文三', { type: 'SENTENCE', studiedAt: '2026-09-01T00:00:00.000Z' }),
      card('u1', '未讲透', '译文', { type: 'SENTENCE' }),
      card('v1', '词汇卡', '译文', { type: 'VOCABULARY' }),
    ];
    const qs = buildTranslationQuestionsFromCards(cards, 5, 'ja');
    expect(qs.length).toBe(3);
    expect(qs[0]?.id).toBe('sentence_s1');
    expect(qs[0]?.content).toBe('原句一');
    expect(qs[0]?.correctAnswer).toBe('译文一');
    expect(qs[0]?.testedSkillId).toBe('jp.sentence.review');
    expect(qs[0]?.explanation).toBe('来自你的课文句子卡');
    expect(qs.every((q) => q.prompt === '选出正确的翻译')).toBe(true);
  });

  it('count 上限与空输入', () => {
    expect(buildTranslationQuestionsFromCards([], 5, 'en')).toEqual([]);
    const cards = [
      card('s1', 'a', '甲', { type: 'SENTENCE', studiedAt: 't' }),
      card('s2', 'b', '乙', { type: 'SENTENCE', studiedAt: 't' }),
      card('s3', 'c', '丙', { type: 'SENTENCE', studiedAt: 't' }),
    ];
    expect(buildTranslationQuestionsFromCards(cards, 1, 'en').length).toBe(1);
  });
});
