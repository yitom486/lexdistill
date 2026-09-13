import { describe, expect, it } from 'bun:test';
import {
  parseAnalysisJson,
  buildLocalRuleReport,
  type AnalysisSnapshot,
} from '../index.js';

/**
 * M7-8 ai-content 确定性规则测试（自 Gateway learning-analysis.test.ts 迁入纯部分，
 * 并补优先级/上限与垃圾前后缀覆盖；时间戳固定传入，全程确定性）。
 */
const GENERATED_AT = '2026-09-07T12:00:00.000Z';

function snapshot(overrides: Partial<AnalysisSnapshot> = {}): AnalysisSnapshot {
  return {
    userId: 'u1',
    targetLanguage: 'en',
    overallLevel: 'B1',
    strengths: [],
    weaknesses: [],
    dueCardsCount: 0,
    unresolvedMistakesCount: 0,
    assembledAt: GENERATED_AT,
    ...overrides,
  };
}

describe('parseAnalysisJson', () => {
  it('parses plain JSON', () => {
    const res = parseAnalysisJson(
      JSON.stringify({
        summary: '总览',
        suggestions: [{ kind: 'WEAKNESS', title: 't', detail: 'd', skillId: 's1' }],
      })
    );
    expect(res?.summary).toBe('总览');
    expect(res?.suggestions[0]?.kind).toBe('WEAKNESS');
  });

  it('strips markdown fences and surrounding text', () => {
    const raw = '好的，分析如下：\n```json\n{"summary":"s","suggestions":[]}\n```\n以上。';
    const res = parseAnalysisJson(raw);
    expect(res?.summary).toBe('s');
  });

  it('tolerates garbage prefix and suffix without fences', () => {
    const raw =
      '思考过程……\n{"summary":"g","suggestions":[{"kind":"TIP","title":"t","detail":"d"}]}\n完毕。';
    const res = parseAnalysisJson(raw);
    expect(res?.summary).toBe('g');
    expect(res?.suggestions.length).toBe(1);
  });

  it('rejects garbage and missing suggestions', () => {
    expect(parseAnalysisJson('not json at all')).toBeNull();
    expect(parseAnalysisJson('{"summary":"s"}')).toBeNull();
  });

  it('rejects empty result (no summary and no suggestions)', () => {
    expect(parseAnalysisJson('{"summary":"","suggestions":[]}')).toBeNull();
    expect(parseAnalysisJson('')).toBeNull();
  });

  it('drops suggestions with invalid kind or missing fields', () => {
    const res = parseAnalysisJson(
      JSON.stringify({
        summary: 's',
        suggestions: [
          { kind: 'BOGUS', title: 't', detail: 'd' },
          { kind: 'TIP', title: 'ok', detail: 'd' },
          { kind: 'TIP', title: 'no detail' },
        ],
      })
    );
    expect(res?.suggestions.length).toBe(1);
    expect(res?.suggestions[0]?.kind).toBe('TIP');
  });
});

describe('buildLocalRuleReport', () => {
  it('generates deterministic suggestions from snapshot', () => {
    const report = buildLocalRuleReport(
      snapshot({
        streakDays: 3,
        dailyGoalQuizzes: 5,
        weaknesses: [{ skillId: 'en.grammar.tense', name: '时态', proficiency: 0.3, consecutiveErrors: 2 }],
        dueCardsCount: 8,
        unresolvedMistakesCount: 2,
        dailyTask: { quizzesCount: 2, cardsReviewedCount: 0, readingCount: 0, mistakesResolvedCount: 0 },
      }),
      GENERATED_AT
    );
    expect(report.source).toBe('local-rules');
    const kinds = report.suggestions.map((s) => s.kind);
    expect(kinds).toContain('WEAKNESS');
    expect(kinds).toContain('PLAN');
    expect(kinds).toContain('TIP');
    expect(kinds).toContain('ENCOURAGEMENT');
    expect(report.suggestions.length).toBeLessThanOrEqual(5);
    expect(report.generatedAt).toBe(GENERATED_AT);
  });

  it('caps at 5 with priority order (weaknesses first, encouragement last)', () => {
    const report = buildLocalRuleReport(
      snapshot({
        streakDays: 7,
        dailyGoalQuizzes: 5,
        weaknesses: [
          { skillId: 'w1', name: '弱项一', proficiency: 0.2, consecutiveErrors: 3 },
          { skillId: 'w2', name: '弱项二', proficiency: 0.4, consecutiveErrors: 2 },
          { skillId: 'w3', name: '弱项三（超额丢弃）', proficiency: 0.1, consecutiveErrors: 5 },
        ],
        dueCardsCount: 8,
        unresolvedMistakesCount: 2,
        dailyTask: { quizzesCount: 1, cardsReviewedCount: 0, readingCount: 0, mistakesResolvedCount: 0 },
      }),
      GENERATED_AT
    );
    // 候选 2 弱项 + 到期 + 错题 + 进度 + 鼓励 = 6，取前 5
    expect(report.suggestions.length).toBe(5);
    const kinds = report.suggestions.map((s) => s.kind);
    expect(kinds).toEqual(['WEAKNESS', 'WEAKNESS', 'PLAN', 'PLAN', 'TIP']);
    expect(report.summary).toContain('弱项一');
  });

  it('handles empty snapshot gracefully', () => {
    const report = buildLocalRuleReport(snapshot(), GENERATED_AT);
    expect(report.source).toBe('local-rules');
    expect(report.suggestions.length).toBe(0);
    expect(report.summary.length).toBeGreaterThan(0);
    expect(report.generatedAt).toBe(GENERATED_AT);
  });
});
