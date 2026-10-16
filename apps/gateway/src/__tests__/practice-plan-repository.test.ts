import { describe, it, expect, beforeEach } from 'bun:test';
import { isOk, isErr } from '@lexdistill/shared';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import type {
  PracticePlanTemplate,
  PracticeBlockSpec,
} from '@lexdistill/protocol';

describe('DrizzleLearnerRepository P5 practice plan', () => {
  let repo: DrizzleLearnerRepository;
  const userId = 'p5_user_01';

  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  function quizBlock(id = 'b1', count = 5): PracticeBlockSpec {
    return { id, kind: 'QUIZ', count, gradingMode: 'AUTO_IMMEDIATE' };
  }
  function translationBlock(id = 'b2', count = 3): PracticeBlockSpec {
    return {
      id,
      kind: 'TRANSLATION',
      count,
      gradingMode: 'AI_BATCH',
      translationDirection: { sourceLanguage: 'zh', targetLanguage: 'en' },
    };
  }
  function template(
    overrides: Partial<PracticePlanTemplate> & { blocks: PracticeBlockSpec[] }
  ): PracticePlanTemplate {
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

  describe('template CRUD', () => {
    it('saves and retrieves a template', async () => {
      const saveRes = await repo.savePracticePlanTemplate(template({ blocks: [quizBlock()] }));
      expect(isOk(saveRes)).toBe(true);
      if (!isOk(saveRes)) return;
      expect(saveRes.value.revision).toBe(1);

      const getRes = await repo.getPracticePlanTemplate(userId, 'tpl_1');
      expect(isOk(getRes)).toBe(true);
      if (!isOk(getRes) || !getRes.value) return;
      expect(getRes.value.name).toBe('晚间 35 分钟');
      expect(getRes.value.blocks[0]!.kind).toBe('QUIZ');
    });

    it('increments revision on update and freezes createdAt', async () => {
      const r1 = await repo.savePracticePlanTemplate(template({ blocks: [quizBlock()] }));
      const createdAt = (isOk(r1) && r1.value.createdAt) || '';
      const r2 = await repo.savePracticePlanTemplate(
        template({ name: '晚间 40 分钟', blocks: [quizBlock()] })
      );
      expect(isOk(r2)).toBe(true);
      if (!isOk(r2)) return;
      expect(r2.value.revision).toBe(2);
      expect(r2.value.name).toBe('晚间 40 分钟');
      expect(r2.value.createdAt).toBe(createdAt);
    });

    it('lists only enabled templates by default', async () => {
      await repo.savePracticePlanTemplate(template({ id: 'tpl_a', blocks: [quizBlock()] }));
      await repo.savePracticePlanTemplate(
        template({ id: 'tpl_b', enabled: false, blocks: [quizBlock()] })
      );
      const listRes = await repo.listPracticePlanTemplates(userId);
      expect(isOk(listRes)).toBe(true);
      if (!isOk(listRes)) return;
      expect(listRes.value.map((t) => t.id)).toEqual(['tpl_a']);
      const allRes = await repo.listPracticePlanTemplates(userId, { includeDisabled: true });
      if (!isOk(allRes)) return;
      expect(allRes.value.map((t) => t.id).sort()).toEqual(['tpl_a', 'tpl_b']);
    });

    it('deletes a template', async () => {
      await repo.savePracticePlanTemplate(template({ blocks: [quizBlock()] }));
      const delRes = await repo.deletePracticePlanTemplate(userId, 'tpl_1');
      expect(isOk(delRes)).toBe(true);
      const getRes = await repo.getPracticePlanTemplate(userId, 'tpl_1');
      expect(isOk(getRes)).toBe(true);
      if (!isOk(getRes)) return;
      expect(getRes.value).toBeNull();
    });

    it('rejects invalid block spec', async () => {
      const res = await repo.savePracticePlanTemplate(
        template({ blocks: [{ ...quizBlock(), count: 0 }] })
      );
      expect(isErr(res)).toBe(true);
    });
  });

  describe('template copy & enable toggle (P5-E2)', () => {
    it('copies a template: new id, reset revision, renamed, disabled, new block ids', async () => {
      const saveRes = await repo.savePracticePlanTemplate(
        template({ id: 'tpl_src', name: '晚间 35 分钟', blocks: [quizBlock('b1', 5), translationBlock('b2', 3)] })
      );
      expect(isOk(saveRes)).toBe(true);
      if (!isOk(saveRes)) return;

      const copyRes = await repo.copyPracticePlanTemplate(userId, 'tpl_src');
      expect(isOk(copyRes)).toBe(true);
      if (!isOk(copyRes)) return;
      const copy = copyRes.value;
      expect(copy.id).not.toBe('tpl_src');
      expect(copy.name).toBe('晚间 35 分钟（副本）');
      expect(copy.enabled).toBe(false);
      expect(copy.revision).toBe(1);
      expect(copy.blocks.map((b) => b.count)).toEqual([5, 3]);
      expect(copy.blocks.map((b) => b.kind)).toEqual(['QUIZ', 'TRANSLATION']);
      expect(copy.blocks.map((b) => b.id)).not.toEqual(['b1', 'b2']);

      // 源模板不被污染
      const srcGet = await repo.getPracticePlanTemplate(userId, 'tpl_src');
      expect(isOk(srcGet)).toBe(true);
      if (!isOk(srcGet) || !srcGet.value) return;
      expect(srcGet.value.enabled).toBe(true);
      expect(srcGet.value.revision).toBe(1);
      expect(srcGet.value.blocks[0]!.id).toBe('b1');

      // 副本默认停用：默认列表不含，includeDisabled 才含
      const listRes = await repo.listPracticePlanTemplates(userId);
      if (!isOk(listRes)) return;
      expect(listRes.value.map((t) => t.id)).toEqual(['tpl_src']);
      const allRes = await repo.listPracticePlanTemplates(userId, { includeDisabled: true });
      if (!isOk(allRes)) return;
      expect(allRes.value.map((t) => t.id).sort()).toEqual(['tpl_src', copy.id].sort());
    });

    it('toggles enabled without bumping revision', async () => {
      await repo.savePracticePlanTemplate(template({ id: 'tpl_t', blocks: [quizBlock()] }));

      const off = await repo.setPracticePlanTemplateEnabled(userId, 'tpl_t', false);
      expect(isOk(off)).toBe(true);
      if (!isOk(off) || !off.value) return;
      expect(off.value.enabled).toBe(false);
      expect(off.value.revision).toBe(1);
      expect(off.value.name).toBe('晚间 35 分钟');

      const on = await repo.setPracticePlanTemplateEnabled(userId, 'tpl_t', true);
      expect(isOk(on)).toBe(true);
      if (!isOk(on) || !on.value) return;
      expect(on.value.enabled).toBe(true);
      expect(on.value.revision).toBe(1);
    });

    it('copy of missing template returns friendly error; toggle of missing returns null', async () => {
      const copyRes = await repo.copyPracticePlanTemplate(userId, 'tpl_missing');
      expect(isErr(copyRes)).toBe(true);
      if (!isErr(copyRes)) return;
      expect(copyRes.error.code).toBe('E_PRACTICE_TEMPLATE_NOT_FOUND');
      expect(copyRes.error.userMessage).toContain('不存在');

      const toggleRes = await repo.setPracticePlanTemplateEnabled(userId, 'tpl_missing', true);
      expect(isOk(toggleRes)).toBe(true);
      if (!isOk(toggleRes)) return;
      expect(toggleRes.value).toBeNull();
    });

    it('copy keeps source language and stays language-isolated', async () => {
      await repo.savePracticePlanTemplate(
        template({ id: 'tpl_ja', language: 'ja', blocks: [quizBlock()] })
      );
      const copyRes = await repo.copyPracticePlanTemplate(userId, 'tpl_ja');
      expect(isOk(copyRes)).toBe(true);
      if (!isOk(copyRes)) return;
      expect(copyRes.value.language).toBe('ja');

      const jaList = await repo.listPracticePlanTemplates(userId, { language: 'ja', includeDisabled: true });
      if (!isOk(jaList)) return;
      expect(jaList.value.length).toBe(2);

      const enList = await repo.listPracticePlanTemplates(userId, { language: 'en', includeDisabled: true });
      if (!isOk(enList)) return;
      expect(enList.value.length).toBe(0);
    });
  });

  describe('template schedule persistence (P6-1B)', () => {
    it('saves and retrieves weekly schedule round-trip', async () => {
      const saveRes = await repo.savePracticePlanTemplate(
        template({
          id: 'tpl_weekly',
          blocks: [quizBlock()],
          schedule: { kind: 'weekly', weekdays: [1, 3, 5] },
        })
      );
      expect(isOk(saveRes)).toBe(true);
      if (!isOk(saveRes)) return;
      expect(saveRes.value.schedule).toEqual({ kind: 'weekly', weekdays: [1, 3, 5] });

      const getRes = await repo.getPracticePlanTemplate(userId, 'tpl_weekly');
      expect(isOk(getRes)).toBe(true);
      if (!isOk(getRes) || !getRes.value) return;
      expect(getRes.value.schedule).toEqual({ kind: 'weekly', weekdays: [1, 3, 5] });

      const listRes = await repo.listPracticePlanTemplates(userId, { includeDisabled: true });
      if (!isOk(listRes)) return;
      expect(listRes.value.find((t) => t.id === 'tpl_weekly')?.schedule).toEqual({
        kind: 'weekly',
        weekdays: [1, 3, 5],
      });
    });

    it('reads templates without schedule as daily-equivalent (backward compatible)', async () => {
      await repo.savePracticePlanTemplate(template({ id: 'tpl_legacy', blocks: [quizBlock()] }));
      const getRes = await repo.getPracticePlanTemplate(userId, 'tpl_legacy');
      expect(isOk(getRes)).toBe(true);
      if (!isOk(getRes) || !getRes.value) return;
      expect(getRes.value.schedule).toBeUndefined();
    });

    it('updates schedule on re-save and keeps it through copy', async () => {
      await repo.savePracticePlanTemplate(template({ id: 'tpl_s', blocks: [quizBlock()] }));
      const r2 = await repo.savePracticePlanTemplate(
        template({ id: 'tpl_s', blocks: [quizBlock()], schedule: { kind: 'weekly', weekdays: [6, 0] } })
      );
      expect(isOk(r2)).toBe(true);
      if (!isOk(r2)) return;
      expect(r2.value.revision).toBe(2);
      expect(r2.value.schedule).toEqual({ kind: 'weekly', weekdays: [6, 0] });

      const copyRes = await repo.copyPracticePlanTemplate(userId, 'tpl_s');
      expect(isOk(copyRes)).toBe(true);
      if (!isOk(copyRes)) return;
      expect(copyRes.value.schedule).toEqual({ kind: 'weekly', weekdays: [6, 0] });
    });

    it('rejects invalid schedule on save', async () => {
      const res = await repo.savePracticePlanTemplate(
        template({
          id: 'tpl_bad',
          blocks: [quizBlock()],
          schedule: { kind: 'weekly', weekdays: [] },
        })
      );
      expect(isErr(res)).toBe(true);
    });
  });

  describe('today plan integration (P5-E3)', () => {
    it('surfaces active run as a today-plan step and completes it after finalize', async () => {
      // 无 run 时今日计划不含练习计划步骤
      const before = await repo.getOrCreateDailyStudyPlan(userId, '2026-09-05');
      expect(isOk(before)).toBe(true);
      if (!isOk(before)) return;
      expect(before.value.steps.some((s) => s.kind === 'PRACTICE_PLAN')).toBe(false);

      // 开 run（晚于计划冻结创建）→ 幂等追加步骤，目标为冻结块总题量
      const runRes = await repo.startPracticePlanRun(userId, {
        language: 'en',
        blocks: [quizBlock('b1', 2), quizBlock('b2', 1)],
      });
      expect(isOk(runRes)).toBe(true);
      if (!isOk(runRes)) return;
      const runId = runRes.value.id;

      const plan1 = await repo.getOrCreateDailyStudyPlan(userId);
      expect(isOk(plan1)).toBe(true);
      if (!isOk(plan1)) return;
      const step1 = plan1.value.steps.find((s) => s.kind === 'PRACTICE_PLAN');
      expect(step1).toBeDefined();
      expect(step1!.targetCount).toBe(3);
      expect(step1!.done).toBe(false);
      expect(step1!.currentCount).toBe(0);

      // 逐题提交推进进度（2/3）
      await repo.submitPracticeItem(userId, runId, 'q1', 'a1', {
        isCorrect: true, score: 1, testedSkillId: 'en.vocab',
      });
      await repo.submitPracticeItem(userId, runId, 'q2', 'a2', {
        isCorrect: false, score: 0, testedSkillId: 'en.vocab',
      });
      const plan2 = await repo.getOrCreateDailyStudyPlan(userId);
      expect(isOk(plan2)).toBe(true);
      if (!isOk(plan2)) return;
      const step2 = plan2.value.steps.find((s) => s.kind === 'PRACTICE_PLAN')!;
      expect(step2.currentCount).toBe(2);
      expect(step2.done).toBe(false);

      // 全部提交 → 步骤自动完成
      await repo.submitPracticeItem(userId, runId, 'q3', 'a3', {
        isCorrect: true, score: 1, testedSkillId: 'en.vocab',
      });
      const plan3 = await repo.getOrCreateDailyStudyPlan(userId);
      if (!isOk(plan3)) return;
      const step3 = plan3.value.steps.find((s) => s.kind === 'PRACTICE_PLAN')!;
      expect(step3.done).toBe(true);

      // finalize（COMPLETED 当日）→ 步骤保持完成态
      await repo.finalizePracticePlanRun(userId, runId);
      const plan4 = await repo.getOrCreateDailyStudyPlan(userId);
      if (!isOk(plan4)) return;
      expect(plan4.value.steps.find((s) => s.kind === 'PRACTICE_PLAN')!.done).toBe(true);
    });

    it('does not leak practice step across languages', async () => {
      // en run 不应出现在 ja 计划里
      const runRes = await repo.startPracticePlanRun(userId, {
        language: 'en',
        blocks: [quizBlock('b1', 2)],
      });
      expect(isOk(runRes)).toBe(true);

      // 将档案切到 ja 再取计划：run 语言隔离使信号不存在
      const profRes = await repo.getLearnerProfile(userId);
      if (!isOk(profRes)) return;
      await repo.updateLearnerProfile(userId, { targetLanguage: 'ja' });

      const planRes = await repo.getOrCreateDailyStudyPlan(userId);
      expect(isOk(planRes)).toBe(true);
      if (!isOk(planRes)) return;
      expect(planRes.value.steps.some((s) => s.kind === 'PRACTICE_PLAN')).toBe(false);
      expect(planRes.value.language).toBe('ja');
    });
  });

  describe('run freeze isolation', () => {
    it('freezes revision and blocks; modifying template does not affect existing run', async () => {
      await repo.savePracticePlanTemplate(template({ blocks: [quizBlock('b1', 5)] }));
      const runRes = await repo.startPracticePlanRun(userId, {
        language: 'en',
        templateId: 'tpl_1',
      });
      expect(isOk(runRes)).toBe(true);
      if (!isOk(runRes)) return;
      const runId = runRes.value.id;
      expect(runRes.value.templateRevision).toBe(1);
      expect(runRes.value.blocks[0]!.count).toBe(5);

      // 改模板题量与 revision
      await repo.savePracticePlanTemplate(template({ blocks: [quizBlock('b1', 10)] }));
      // 旧 run 不变
      const reGet = await repo.getPracticePlanRun(userId, runId);
      if (!isOk(reGet) || !reGet.value) return;
      expect(reGet.value.templateRevision).toBe(1);
      expect(reGet.value.blocks[0]!.count).toBe(5);

      // 新 run 用新 revision
      const run2 = await repo.startPracticePlanRun(userId, { language: 'en', templateId: 'tpl_1' });
      if (!isOk(run2)) return;
      expect(run2.value.templateRevision).toBe(2);
      expect(run2.value.blocks[0]!.count).toBe(10);
    });

    it('supports one-off custom blocks run without template', async () => {
      const runRes = await repo.startPracticePlanRun(userId, {
        language: 'ja',
        blocks: [quizBlock('b1', 3)],
      });
      expect(isOk(runRes)).toBe(true);
      if (!isOk(runRes)) return;
      expect(runRes.value.templateId).toBeUndefined();
      expect(runRes.value.language).toBe('ja');
    });
  });

  describe('draft / submit / finalize', () => {
    it('saves draft then submits with grading', async () => {
      const runRes = await repo.startPracticePlanRun(userId, {
        language: 'en',
        blocks: [quizBlock('b1', 2)],
      });
      if (!isOk(runRes)) return;
      const runId = runRes.value.id;

      const draft = await repo.savePracticeItemDraft(userId, runId, 'q1', 'my draft');
      expect(isOk(draft)).toBe(true);
      if (!isOk(draft)) return;
      expect(draft.value.status).toBe('DRAFT');

      const submit = await repo.submitPracticeItem(userId, runId, 'q1', 'my answer', {
        isCorrect: true,
        score: 1,
        testedSkillId: 'en.vocab',
      });
      expect(isOk(submit)).toBe(true);
      if (!isOk(submit)) return;
      expect(submit.value.status).toBe('GRADED');
      expect(submit.value.gradingResult?.isCorrect).toBe(true);
    });

    it('finalize writes quiz_attempts atomically and marks run COMPLETED', async () => {
      const runRes = await repo.startPracticePlanRun(userId, {
        language: 'en',
        blocks: [quizBlock('b1', 2)],
      });
      if (!isOk(runRes)) return;
      const runId = runRes.value.id;

      await repo.submitPracticeItem(userId, runId, 'q1', 'a1', {
        isCorrect: true,
        score: 1,
        testedSkillId: 'en.vocab',
      });
      await repo.submitPracticeItem(userId, runId, 'q2', 'a2', {
        isCorrect: false,
        score: 0,
        testedSkillId: 'en.vocab',
      });

      const finRes = await repo.finalizePracticePlanRun(userId, runId);
      expect(isOk(finRes)).toBe(true);
      if (!isOk(finRes)) return;
      expect(finRes.value.status).toBe('COMPLETED');
      expect(finRes.value.completedAt).toBeTruthy();

      // 每日活动已记录（quizzes 累计 2）
      const today = new Date().toISOString().slice(0, 10);
      const progRes = await repo.getDailyTaskProgress(userId, today);
      if (!isOk(progRes)) return;
      expect(progRes.value.quizzesCount).toBeGreaterThanOrEqual(2);
    });

    it('is idempotent: repeated finalize does not double-count quiz_attempts', async () => {
      const runRes = await repo.startPracticePlanRun(userId, {
        language: 'en',
        blocks: [quizBlock('b1', 1)],
      });
      if (!isOk(runRes)) return;
      const runId = runRes.value.id;
      await repo.submitPracticeItem(userId, runId, 'q1', 'a1', {
        isCorrect: true,
        score: 1,
        testedSkillId: 'en.vocab',
      });

      await repo.finalizePracticePlanRun(userId, runId);
      const before = await repo.getDailyTaskProgress(userId, new Date().toISOString().slice(0, 10));
      const quizzesBefore = isOk(before) ? before.value.quizzesCount : 0;

      // 再次 finalize（幂等）
      await repo.finalizePracticePlanRun(userId, runId);
      const after = await repo.getDailyTaskProgress(userId, new Date().toISOString().slice(0, 10));
      expect(isOk(after)).toBe(true);
      if (!isOk(after)) return;
      expect(after.value.quizzesCount).toBe(quizzesBefore);
    });

    it('repeated submit of same item does not duplicate attempts', async () => {
      const runRes = await repo.startPracticePlanRun(userId, {
        language: 'en',
        blocks: [quizBlock('b1', 1)],
      });
      if (!isOk(runRes)) return;
      const runId = runRes.value.id;
      await repo.submitPracticeItem(userId, runId, 'q1', 'a1', {
        isCorrect: true,
        score: 1,
        testedSkillId: 'en.vocab',
      });
      await repo.submitPracticeItem(userId, runId, 'q1', 'a1', {
        isCorrect: true,
        score: 1,
        testedSkillId: 'en.vocab',
      });
      const listRes = await repo.listPracticeItemAttempts(runId);
      if (!isOk(listRes)) return;
      expect(listRes.value.filter((a) => a.itemId === 'q1').length).toBe(1);
    });
  });

  describe('three-language isolation', () => {
    it('keeps en/ja/ko templates and runs separate', async () => {
      await repo.savePracticePlanTemplate(
        template({ id: 'tpl_en', language: 'en', blocks: [quizBlock()] })
      );
      await repo.savePracticePlanTemplate(
        template({ id: 'tpl_ja', language: 'ja', blocks: [quizBlock()] })
      );
      await repo.savePracticePlanTemplate(
        template({ id: 'tpl_ko', language: 'ko', blocks: [quizBlock()] })
      );

      const enList = await repo.listPracticePlanTemplates(userId, { language: 'en' });
      const jaList = await repo.listPracticePlanTemplates(userId, { language: 'ja' });
      const koList = await repo.listPracticePlanTemplates(userId, { language: 'ko' });
      if (!isOk(enList) || !isOk(jaList) || !isOk(koList)) return;
      expect(enList.value.map((t) => t.id)).toEqual(['tpl_en']);
      expect(jaList.value.map((t) => t.id)).toEqual(['tpl_ja']);
      expect(koList.value.map((t) => t.id)).toEqual(['tpl_ko']);

      const runEn = await repo.startPracticePlanRun(userId, { language: 'en', templateId: 'tpl_en' });
      const runJa = await repo.startPracticePlanRun(userId, { language: 'ja', templateId: 'tpl_ja' });
      if (!isOk(runEn) || !isOk(runJa)) return;
      expect(runEn.value.language).toBe('en');
      expect(runJa.value.language).toBe('ja');

      // en 的 run 列表不含 ja
      const enRuns = await repo.listPracticePlanRuns(userId, { language: 'en' });
      if (!isOk(enRuns)) return;
      expect(enRuns.value.every((r) => r.language === 'en')).toBe(true);
    });
  });
});
