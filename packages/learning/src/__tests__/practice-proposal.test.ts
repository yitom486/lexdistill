import { describe, expect, it } from 'bun:test';
import {
  proposeTemplateFromSnapshot,
  type AnalysisSnapshot,
} from '../index.js';

/**
 * M7-20 计划建议草案测试（自 Gateway practice-phase-d.test.ts 迁入纯部分；
 * 确定性、无时钟、无存储副作用；令牌/消费仍归 Gateway）。
 */
function snapshot(overrides: Partial<AnalysisSnapshot> = {}): AnalysisSnapshot {
  return {
    userId: 'u1',
    targetLanguage: 'en',
    overallLevel: 'B1',
    strengths: [],
    weaknesses: [
      { skillId: 'en.grammar.subjunctive', name: '虚拟语气', proficiency: 0.4, consecutiveErrors: 3 },
    ],
    dueCardsCount: 8,
    unresolvedMistakesCount: 4,
    assembledAt: '2026-09-05T00:00:00.000Z',
    ...overrides,
  };
}

describe('proposeTemplateFromSnapshot', () => {
  it('从快照生成非空块且包含薄弱靶向/复习/错题回炉/新词', () => {
    const { blocks } = proposeTemplateFromSnapshot(snapshot(), 'en');
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.length).toBeLessThanOrEqual(8);
    const kinds = blocks.map((b) => b.kind);
    expect(kinds).toContain('QUIZ'); // 薄弱靶向
    expect(kinds).toContain('VOCAB_REVIEW'); // 到期卡
    expect(kinds).toContain('TRANSLATION'); // 错题回炉
    expect(kinds).toContain('VOCAB_NEW'); // 新词
    const quiz = blocks.find((b) => b.kind === 'QUIZ')!;
    expect(quiz.skillIds).toContain('en.grammar.subjunctive');
  });

  it('薄弱项最多 2 个 QUIZ 块（截断多余）', () => {
    const { blocks } = proposeTemplateFromSnapshot(
      snapshot({
        weaknesses: [
          { skillId: 'w1', name: '一', proficiency: 0.1, consecutiveErrors: 3 },
          { skillId: 'w2', name: '二', proficiency: 0.2, consecutiveErrors: 3 },
          { skillId: 'w3', name: '三', proficiency: 0.3, consecutiveErrors: 3 },
        ],
      }),
      'en'
    );
    const quizzes = blocks.filter((b) => b.kind === 'QUIZ');
    expect(quizzes.length).toBe(2);
    expect(blocks.length).toBeLessThanOrEqual(8);
  });

  it('到期卡和错题块的条件与数量上限', () => {
    const { blocks } = proposeTemplateFromSnapshot(
      snapshot({ weaknesses: [], dueCardsCount: 100, unresolvedMistakesCount: 100 }),
      'en'
    );
    const review = blocks.find((b) => b.kind === 'VOCAB_REVIEW')!;
    expect(review.count).toBe(10);
    expect(review.gradingMode).toBe('AUTO_IMMEDIATE');
    const translation = blocks.find((b) => b.kind === 'TRANSLATION')!;
    expect(translation.count).toBe(5);
    expect(translation.gradingMode).toBe('AI_BATCH');
    const empty = proposeTemplateFromSnapshot(
      snapshot({ weaknesses: [], dueCardsCount: 0, unresolvedMistakesCount: 0 }),
      'en'
    );
    expect(empty.blocks.find((b) => b.kind === 'VOCAB_REVIEW')).toBeUndefined();
    expect(empty.blocks.find((b) => b.kind === 'TRANSLATION')).toBeUndefined();
    // 新词兜底保证非空
    expect(empty.blocks.length).toBe(1);
  });

  it('三语建议名称与翻译方向', () => {
    expect(proposeTemplateFromSnapshot(snapshot(), 'en').suggestedName).toBe('英语智能建议计划');
    expect(proposeTemplateFromSnapshot(snapshot(), 'ja').suggestedName).toBe('日语智能建议计划');
    expect(proposeTemplateFromSnapshot(snapshot(), 'ko').suggestedName).toBe('韩语智能建议计划');
    const { blocks } = proposeTemplateFromSnapshot(snapshot(), 'ja');
    const t = blocks.find((b) => b.kind === 'TRANSLATION')!;
    expect(t.translationDirection).toEqual({ sourceLanguage: 'zh', targetLanguage: 'ja' });
  });

  it('block ID 顺序命名且确定性（无时钟无随机）', () => {
    const a = proposeTemplateFromSnapshot(snapshot(), 'en');
    const b = proposeTemplateFromSnapshot(snapshot(), 'en');
    expect(a).toEqual(b);
    expect(a.blocks.map((x) => x.id)).toEqual(['blk-1', 'blk-2', 'blk-3', 'blk-4']);
  });
});
