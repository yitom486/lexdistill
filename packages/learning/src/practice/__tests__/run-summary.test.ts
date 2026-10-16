import { describe, expect, it } from 'bun:test';
import type { PracticeBlockSpec, PracticeItemAttempt, PracticePlanRun } from '@lexdistill/protocol';
import { buildLocalRunSummary } from '../index.js';

/**
 * M7-14 练习运行本地汇总测试（纯逻辑，不读时钟；generatedAt 由调用方传入）。
 */
const GENERATED_AT = '2026-09-07T12:00:00.000Z';

function run(): PracticePlanRun {
  return {
    id: 'run_1',
    userId: 'u1',
    language: 'en',
    blocks: [
      { id: 'b1', kind: 'QUIZ', count: 3, gradingMode: 'AUTO_IMMEDIATE' } as PracticeBlockSpec,
      { id: 'b2', kind: 'TRANSLATION', count: 2, gradingMode: 'AI_BATCH' } as PracticeBlockSpec,
    ],
    status: 'COMPLETED',
    startedAt: '2026-09-05T00:00:00.000Z',
    createdAt: '2026-09-05T00:00:00.000Z',
  };
}

function attempt(over: Partial<PracticeItemAttempt> & { id: string }): PracticeItemAttempt {
  return {
    runId: 'run_1',
    blockId: 'b1',
    itemId: over.id,
    status: 'GRADED',
    userAnswer: 'x',
    ...over,
  } as PracticeItemAttempt;
}

describe('buildLocalRunSummary', () => {
  it('基本统计与平均分', () => {
    const s = buildLocalRunSummary(
      run(),
      [
        attempt({ id: 'a1', gradingResult: { isCorrect: true, score: 1, issues: ['拼写'] } }),
        attempt({ id: 'a2', gradingResult: { isCorrect: false, score: 0.4, issues: ['拼写', '语序'] } }),
        attempt({ id: 'a3', status: 'SUBMITTED', gradingResult: undefined }),
      ],
      GENERATED_AT
    );
    expect(s.totalItems).toBe(5);
    expect(s.submittedCount).toBe(3);
    expect(s.gradedCount).toBe(2);
    expect(s.correctCount).toBe(1);
    expect(s.averageScore).toBe(0.7);
    expect(s.source).toBe('local');
    expect(s.runId).toBe('run_1');
    expect(s.summary).toContain('共 5 题');
  });

  it('正确率偏低及未提交建议', () => {
    const s = buildLocalRunSummary(
      run(),
      [attempt({ id: 'a1', gradingResult: { isCorrect: false, score: 0.2 } })],
      GENERATED_AT
    );
    expect(s.nextPlanSuggestions.some((sg) => sg.includes('未提交'))).toBe(true);
    expect(s.nextPlanSuggestions.some((sg) => sg.includes('正确率偏低'))).toBe(true);
  });

  it('commonIssues 按频次排序并取前 3', () => {
    const s = buildLocalRunSummary(
      run(),
      [
        attempt({ id: 'a1', gradingResult: { isCorrect: true, score: 1, issues: ['甲', '乙'] } }),
        attempt({ id: 'a2', gradingResult: { isCorrect: true, score: 1, issues: ['甲', '丙'] } }),
        attempt({ id: 'a3', gradingResult: { isCorrect: true, score: 1, issues: ['甲', '丁'] } }),
        attempt({ id: 'a4', gradingResult: { isCorrect: true, score: 1, issues: ['乙'] } }),
      ],
      GENERATED_AT
    );
    expect(s.commonIssues).toEqual(['甲', '乙', '丙']);
    expect(s.nextPlanSuggestions.some((sg) => sg.includes('高频问题'))).toBe(true);
  });

  it('空 attempts：零分不伪造、未提交建议、source=local', () => {
    const s = buildLocalRunSummary(run(), [], GENERATED_AT);
    expect(s.totalItems).toBe(5);
    expect(s.submittedCount).toBe(0);
    expect(s.gradedCount).toBe(0);
    expect(s.correctCount).toBe(0);
    expect(s.averageScore).toBe(0);
    expect(s.commonIssues).toEqual([]);
    expect(s.source).toBe('local');
    expect(s.nextPlanSuggestions).toEqual(['尚有 5 题未提交，建议继续完成后复盘。']);
  });

  it('generatedAt 回声（包内无时钟）', () => {
    const stamp = '2031-05-06T07:08:09.000Z';
    const s = buildLocalRunSummary(run(), [], stamp);
    expect(s.generatedAt).toBe(stamp);
  });
});
