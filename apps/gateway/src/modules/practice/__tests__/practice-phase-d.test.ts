import { describe, it, expect, beforeEach } from 'bun:test';
import { isOk, isErr } from '@lexdistill/shared';
import type { AnalysisSnapshot } from '../../learning-progress/public.js';
import {
  proposeTemplateFromSnapshot,
  createProposal,
  consumeProposal,
  _clearProposalsForTest,
} from '../application/practice-proposal.js';
import { buildLocalRunSummary, summarizePracticeRun, type RunSummaryReport } from '../application/practice-summary.js';
import type { PracticePlanRun, PracticeItemAttempt, PracticeBlockSpec } from '@lexdistill/protocol';

/* ------------------------------------------------------------------ *
 * P5-PhaseD：AI 分析与质量收口
 *  - 计划建议（propose）规则驱动、可审计、不保存
 *  - apply 一次性令牌（过期/跨用户拒绝/重复消费失败）
 *  - 运行汇总本地规则（不伪造分数、模型不可用回退）
 *  - 三语隔离
 * ------------------------------------------------------------------ */

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

describe('P5-PhaseD proposeTemplateFromSnapshot', () => {
  it('从快照生成非空块且包含薄弱靶向/复习/错题回炉/新词', () => {
    const { blocks } = proposeTemplateFromSnapshot(snapshot(), 'en');
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.length).toBeLessThanOrEqual(8);
    const kinds = blocks.map((b) => b.kind);
    expect(kinds).toContain('QUIZ'); // 薄弱靶向
    expect(kinds).toContain('VOCAB_REVIEW'); // 到期卡
    expect(kinds).toContain('TRANSLATION'); // 错题回炉
    expect(kinds).toContain('VOCAB_NEW'); // 新词
    // 薄弱靶向块带 skillIds
    const quiz = blocks.find((b) => b.kind === 'QUIZ')!;
    expect(quiz.skillIds).toContain('en.grammar.subjunctive');
  });

  it('翻译方向用结构化 source/target，不写死文案', () => {
    const { blocks } = proposeTemplateFromSnapshot(snapshot(), 'ja');
    const t = blocks.find((b) => b.kind === 'TRANSLATION')!;
    expect(t.translationDirection).toEqual({ sourceLanguage: 'zh', targetLanguage: 'ja' });
  });

  it('无到期卡时不生成 VOCAB_REVIEW 块', () => {
    const { blocks } = proposeTemplateFromSnapshot(snapshot({ dueCardsCount: 0 }), 'en');
    expect(blocks.find((b) => b.kind === 'VOCAB_REVIEW')).toBeUndefined();
  });
});

describe('P5-PhaseD proposal token lifecycle', () => {
  beforeEach(() => _clearProposalsForTest());

  it('createProposal 签发令牌且不保存任何模板', () => {
    const p = createProposal('u1', 'en', snapshot());
    expect(p.proposalId).toBeTruthy();
    expect(p.userId).toBe('u1');
    expect(p.language).toBe('en');
    expect(p.blocks.length).toBeGreaterThan(0);
  });

  it('consumeProposal 一次性消费：成功后再次消费失败', () => {
    const p = createProposal('u1', 'en', snapshot());
    const first = consumeProposal('u1', p.proposalId);
    expect(isOk(first)).toBe(true);
    const second = consumeProposal('u1', p.proposalId);
    expect(isErr(second)).toBe(true);
  });

  it('跨用户拒绝消费', () => {
    const p = createProposal('u1', 'en', snapshot());
    const res = consumeProposal('u2', p.proposalId);
    expect(isErr(res)).toBe(true);
  });

  it('不存在的令牌返回错误', () => {
    const res = consumeProposal('u1', 'nope');
    expect(isErr(res)).toBe(true);
  });
});

describe('P5-PhaseD buildLocalRunSummary（不伪造分数）', () => {
  function run(overrides: Partial<PracticePlanRun> = {}): PracticePlanRun {
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
      ...overrides,
    };
  }

  it('无已批改尝试时：correctCount=0、averageScore=0、source=local（不伪造）', () => {
    const attempts: PracticeItemAttempt[] = [
      { id: 'a1', runId: 'run_1', blockId: 'b1', itemId: 'i1', status: 'SUBMITTED', userAnswer: 'x' },
    ];
    const s = buildLocalRunSummary(run(), attempts);
    expect(s.correctCount).toBe(0);
    expect(s.averageScore).toBe(0);
    expect(s.gradedCount).toBe(0);
    expect(s.source).toBe('local');
    expect(s.summary).toContain('已批改 0');
  });

  it('统计已批改尝试的 correct/score 与共性问题', () => {
    const attempts: PracticeItemAttempt[] = [
      { id: 'a1', runId: 'run_1', blockId: 'b1', itemId: 'i1', status: 'GRADED', userAnswer: 'A', gradingResult: { isCorrect: true, score: 1, issues: ['拼写'] } },
      { id: 'a2', runId: 'run_1', blockId: 'b1', itemId: 'i2', status: 'GRADED', userAnswer: 'B', gradingResult: { isCorrect: false, score: 0.4, issues: ['拼写', '语序'] } },
    ];
    const s = buildLocalRunSummary(run(), attempts);
    expect(s.gradedCount).toBe(2);
    expect(s.correctCount).toBe(1);
    expect(s.averageScore).toBe(0.7);
    expect(s.commonIssues[0]).toBe('拼写');
  });

  it('未提交完时给出继续完成建议；正确率低时给出靶向建议', () => {
    const attempts: PracticeItemAttempt[] = [
      { id: 'a1', runId: 'run_1', blockId: 'b1', itemId: 'i1', status: 'GRADED', userAnswer: 'A', gradingResult: { isCorrect: false, score: 0.2 } },
    ];
    const s = buildLocalRunSummary(run(), attempts);
    expect(s.nextPlanSuggestions.some((sg) => sg.includes('未提交'))).toBe(true);
    expect(s.nextPlanSuggestions.some((sg) => sg.includes('正确率偏低'))).toBe(true);
  });
});

describe('P5-PhaseD summarizePracticeRun（模型不可用回退、不丢草稿）', () => {
  it('run 不存在返回错误', async () => {
    const repo = {
      getPracticePlanRun: async () => ({ ok: false, error: { code: 'E_RUN_NOT_FOUND' } as never }),
      listPracticeItemAttempts: async () => ({ ok: true, value: [] as PracticeItemAttempt[] }) as never,
    } as never;
    const res = await summarizePracticeRun({ repo, userId: 'u1', runId: 'nope' });
    expect(isErr(res)).toBe(true);
  });

  it('草稿尝试不计入已批改、不伪造分数', async () => {
    const run: PracticePlanRun = {
      id: 'run_1',
      userId: 'u1',
      language: 'ja',
      blocks: [{ id: 'b1', kind: 'WRITING', count: 1, gradingMode: 'AI_BATCH' } as PracticeBlockSpec],
      status: 'IN_PROGRESS',
      startedAt: '2026-09-05T00:00:00.000Z',
      createdAt: '2026-09-05T00:00:00.000Z',
    };
    const attempts: PracticeItemAttempt[] = [
      { id: 'a1', runId: 'run_1', blockId: 'b1', itemId: 'i1', status: 'DRAFT', userAnswer: '半截草稿…' },
    ];
    const repo = {
      getPracticePlanRun: async () => ({ ok: true, value: run }) as never,
      listPracticeItemAttempts: async () => ({ ok: true, value: attempts }) as never,
    } as never;
    const res = (await summarizePracticeRun({ repo, userId: 'u1', runId: 'run_1' })) as { ok: boolean; value: RunSummaryReport };
    expect(res.ok).toBe(true);
    expect(res.value.gradedCount).toBe(0);
    expect(res.value.correctCount).toBe(0);
    expect(res.value.source).toBe('local');
  });
});

describe('P5-PhaseD 三语隔离', () => {
  it('en/ja/ko 建议草案的翻译方向 targetLanguage 与语种一致', () => {
    const langs: Array<'en' | 'ja' | 'ko'> = ['en', 'ja', 'ko'];
    for (const lang of langs) {
      const { blocks } = proposeTemplateFromSnapshot(snapshot({ targetLanguage: lang }), lang);
      const t = blocks.find((b) => b.kind === 'TRANSLATION');
      expect(t?.translationDirection?.targetLanguage).toBe(lang);
    }
  });
});
