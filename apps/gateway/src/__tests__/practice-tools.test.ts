import { describe, it, expect, beforeEach } from 'bun:test';
import { isOk, isErr } from '@lexdistill/shared';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { LearningPracticeTool } from '../modules/practice/tools/learning-practice-tool.js';
import { LearningAssessTool } from '../modules/practice/tools/learning-assess-tool.js';
import { LearningPlanTool } from '../transport/tools/learning-plan-tool.js';
import type { PracticeBlockSpec, PracticePlanTemplate } from '@lexdistill/protocol';

describe('P5 PhaseB practice tools', () => {
  let repo: DrizzleLearnerRepository;
  let practice: LearningPracticeTool;
  let assess: LearningAssessTool;
  let plan: LearningPlanTool;
  const userId = 'p5b_user_01';

  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
    practice = new LearningPracticeTool(repo);
    assess = new LearningAssessTool(repo);
    plan = new LearningPlanTool(repo);
  });

  function quizBlock(): PracticeBlockSpec {
    return { id: 'b1', kind: 'QUIZ', count: 2, gradingMode: 'AUTO_IMMEDIATE' };
  }
  function translationBlock(): PracticeBlockSpec {
    return {
      id: 'b2',
      kind: 'TRANSLATION',
      count: 2,
      gradingMode: 'AI_BATCH',
      translationDirection: { sourceLanguage: 'zh', targetLanguage: 'en' },
    };
  }
  function tpl(overrides: Partial<PracticePlanTemplate> & { blocks: PracticeBlockSpec[] }): PracticePlanTemplate {
    return {
      id: 'tpl_1',
      userId,
      language: 'en',
      name: '晚间 35 分钟',
      enabled: true,
      revision: 0,
      createdAt: '2026-09-05T00:00:00.000Z',
      updatedAt: '2026-09-05T00:00:00.000Z',
      ...overrides,
    };
  }

  describe('learning.plan P5 read-only actions', () => {
    it('list_templates / get_template / preview_template / get_today_run', async () => {
      await repo.savePracticePlanTemplate(tpl({ blocks: [quizBlock()] }));
      const listRes = await plan.execute(
        { action: 'list_templates', language: 'en' },
        { userId, sessionId: 's1' }
      );
      expect(isOk(listRes)).toBe(true);
      if (!isOk(listRes)) return;
      expect((listRes.value as PracticePlanTemplate[]).length).toBe(1);

      const getRes = await plan.execute(
        { action: 'get_template', templateId: 'tpl_1' },
        { userId, sessionId: 's1' }
      );
      expect(isOk(getRes)).toBe(true);

      const previewRes = await plan.execute(
        { action: 'preview_template', blocks: [quizBlock(), translationBlock()] },
        { userId, sessionId: 's1' }
      );
      expect(isOk(previewRes)).toBe(true);
      if (!isOk(previewRes)) return;
      const preview = previewRes.value as { totalQuestions: number; aiGradingCount: number; estimatedMinutes: number };
      expect(preview.totalQuestions).toBe(4);
      expect(preview.aiGradingCount).toBe(2);
      expect(preview.estimatedMinutes).toBeGreaterThan(0);
    });
  });

  describe('learning.assess grade_batch', () => {
    it('returns per-item aligned results + summary', async () => {
      const res = await assess.execute(
        {
          action: 'grade_batch',
          items: [
            { itemId: 'q1', prompt: '翻译', standardAnswer: 'I am a student.', userSubmission: 'I am a student.' },
            { itemId: 'q2', prompt: '翻译', standardAnswer: 'She likes tea.', userSubmission: 'She like tea' },
          ],
        },
        { userId, sessionId: 's1' }
      );
      expect(isOk(res)).toBe(true);
      if (!isOk(res)) return;
      const out = res.value as { results: Array<{ itemId: string; grading: { isCorrect: boolean } }>; summary: { total: number; correct: number; averageScore: number; commonIssues: string[] } };
      expect(out.results.length).toBe(2);
      expect(out.results[0]!.itemId).toBe('q1');
      expect(out.results[0]!.grading.isCorrect).toBe(true);
      expect(out.summary.total).toBe(2);
      expect(out.summary.correct).toBe(1);
    });
  });

  describe('learning.practice two submit paths', () => {
    it('per-item objective path: submit_objective then finalize records once', async () => {
      const startRes = await practice.execute(
        { action: 'start_run', language: 'en', blocks: [{ ...quizBlock(), count: 1 }] },
        { userId, sessionId: 's1' }
      );
      expect(isOk(startRes)).toBe(true);
      if (!isOk(startRes)) return;
      const runId = (startRes.value as { run?: { id: string } }).run!.id;

      const collected = await repo.collectPracticeQuestions({ userId, title: 'Objective test', intent: 'GENERATE_QUIZ', planRunId: runId,
        blockId: 'b1', gradingMode: 'AUTO_IMMEDIATE', questions: [{ id: 'q1', type: 'MULTIPLE_CHOICE', prompt: 'Choose', content: 'Past tense',
          options: ['went', 'go'], correctAnswer: 'went', explanation: 'Past tense.', testedSkillId: 'en.grammar.past', difficultyTier: 2 }] });
      if (!isOk(collected)) throw collected.error;

      const subRes = await practice.execute(
        {
          action: 'submit_objective',
          runId,
          itemId: collected.value.items[0]!.id,
          userAnswer: 'A',
          isCorrect: true,
          testedSkillId: 'en.vocab',
        },
        { userId, sessionId: 's1' }
      );
      expect(isOk(subRes)).toBe(true);

      const finRes = await practice.execute(
        { action: 'finalize_run', runId },
        { userId, sessionId: 's1' }
      );
      expect(isOk(finRes)).toBe(true);
      if (!isOk(finRes)) return;
      expect((finRes.value as { finalized?: boolean }).finalized).toBe(true);

      // 学习活动已记录
      const today = new Date().toISOString().slice(0, 10);
      const progRes = await repo.getDailyTaskProgress(userId, today);
      if (!isOk(progRes)) return;
      expect(progRes.value.quizzesCount).toBeGreaterThanOrEqual(1);
    });

    it('batch path: grade_batch then submit_batch records each item once', async () => {
      const startRes = await practice.execute(
        { action: 'start_run', language: 'en', blocks: [translationBlock()] },
        { userId, sessionId: 's1' }
      );
      if (!isOk(startRes)) return;
      const runId = (startRes.value as { run?: { id: string } }).run!.id;

      // 1. 批量评测（learning.assess.grade_batch）
      const gradeRes = await assess.execute(
        {
          action: 'grade_batch',
          items: [
            { itemId: 'q1', prompt: '翻译', standardAnswer: 'I am a student.', userSubmission: 'I am a student.' },
            { itemId: 'q2', prompt: '翻译', standardAnswer: 'She likes tea.', userSubmission: 'She like tea' },
          ],
        },
        { userId, sessionId: 's1' }
      );
      if (!isOk(gradeRes)) return;
      const batch = gradeRes.value as unknown as {
        results: Array<{ itemId: string; grading: Record<string, unknown> }>;
        summary: { total: number; correct: number };
      };

      // 2. 批量提交（learning.practice.submit_batch），用评测结果作为 gradingResult
      const submitRes = await practice.execute(
        {
          action: 'submit_batch',
          runId,
          items: batch.results.map((r) => ({
            itemId: r.itemId,
            userAnswer: 'ans',
            gradingResult: r.grading,
          })),
        },
        { userId, sessionId: 's1' }
      );
      expect(isOk(submitRes)).toBe(true);
      if (!isOk(submitRes)) return;
      const out = submitRes.value as { batchSummary: { total: number; graded: number; correct: number } };
      expect(out.batchSummary.total).toBe(2);
      expect(out.batchSummary.graded).toBe(2);

      // 3. finalize
      const finRes = await practice.execute({ action: 'finalize_run', runId }, { userId, sessionId: 's1' });
      expect(isOk(finRes)).toBe(true);

      const today = new Date().toISOString().slice(0, 10);
      const progRes = await repo.getDailyTaskProgress(userId, today);
      if (!isOk(progRes)) return;
      expect(progRes.value.quizzesCount).toBeGreaterThanOrEqual(2);
    });

    it('is idempotent: repeated submit_batch + finalize does not double-count', async () => {
      const startRes = await practice.execute(
        { action: 'start_run', language: 'en', blocks: [quizBlock()] },
        { userId, sessionId: 's1' }
      );
      if (!isOk(startRes)) return;
      const runId = (startRes.value as { run?: { id: string } }).run!.id;

      await practice.execute(
        {
          action: 'submit_batch',
          runId,
          items: [{ itemId: 'q1', userAnswer: 'A', gradingResult: { isCorrect: true, score: 1, testedSkillId: 'en.vocab' } }],
        },
        { userId, sessionId: 's1' }
      );
      await practice.execute({ action: 'finalize_run', runId }, { userId, sessionId: 's1' });
      const before = await repo.getDailyTaskProgress(userId, new Date().toISOString().slice(0, 10));
      const quizzesBefore = isOk(before) ? before.value.quizzesCount : 0;

      // 重复提交同一题 + 再次 finalize
      await practice.execute(
        {
          action: 'submit_batch',
          runId,
          items: [{ itemId: 'q1', userAnswer: 'A', gradingResult: { isCorrect: true, score: 1, testedSkillId: 'en.vocab' } }],
        },
        { userId, sessionId: 's1' }
      );
      await practice.execute({ action: 'finalize_run', runId }, { userId, sessionId: 's1' });
      const after = await repo.getDailyTaskProgress(userId, new Date().toISOString().slice(0, 10));
      expect(isOk(after)).toBe(true);
      if (!isOk(after)) return;
      expect(after.value.quizzesCount).toBe(quizzesBefore);
    });

    it('save_draft persists draft without submitting', async () => {
      const startRes = await practice.execute(
        { action: 'start_run', language: 'en', blocks: [translationBlock()] },
        { userId, sessionId: 's1' }
      );
      if (!isOk(startRes)) return;
      const runId = (startRes.value as { run?: { id: string } }).run!.id;

      const draftRes = await practice.execute(
        { action: 'save_draft', runId, itemId: 'q1', userAnswer: 'half answer' },
        { userId, sessionId: 's1' }
      );
      expect(isOk(draftRes)).toBe(true);
      if (!isOk(draftRes)) return;
      expect((draftRes.value as { attempt?: { status: string } }).attempt!.status).toBe('DRAFT');

      // 草稿不产生 quiz_attempt
      const today = new Date().toISOString().slice(0, 10);
      const progRes = await repo.getDailyTaskProgress(userId, today);
      if (!isOk(progRes)) return;
      expect(progRes.value.quizzesCount).toBe(0);
    });

    it('rejects invalid inputs with BusinessError', async () => {
      const res = await practice.execute(
        { action: 'start_run' },
        { userId, sessionId: 's1' }
      );
      expect(isErr(res)).toBe(true);
    });
  });
});
