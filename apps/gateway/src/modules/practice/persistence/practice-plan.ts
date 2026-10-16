import { ok, err, type Result, BusinessError, translateToBusinessError, nowIso, isOk } from '@lexdistill/shared';
import type { PracticePlanRun } from '@lexdistill/protocol';
import { eq } from 'drizzle-orm';
import { quizAttempts, practicePlanRuns } from '@lexdistill/storage-sqlite';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';
import { submitPracticeAttempt } from '../domain/record-practice-attempt.js';
import { serializePracticeWrite } from './serialized-write.js';

export async function finalizePracticePlanRun(
  deps: RepoDeps, userId: string, runId: string,
): Promise<Result<PracticePlanRun, BusinessError>> {
  try {
    return await serializePracticeWrite(deps.sqlite, () => deps.repo.withTransaction(async repo => {
      const runRes = await repo.getPracticePlanRun(userId, runId);
      if (!isOk(runRes)) throw runRes.error;
      if (!runRes.value) throw new BusinessError('E_RUN_NOT_FOUND', '练习运行未找到', 'DATABASE');
      const run = runRes.value;
      if (run.status === 'COMPLETED') return ok(run);
      if (run.status !== 'IN_PROGRESS') throw new BusinessError('E_RUN_CLOSED', '该练习已关闭。', 'VALIDATION');
      const attemptsRes = await repo.listPracticeItemAttempts(runId);
      if (!isOk(attemptsRes)) throw attemptsRes.error;
      const itemsRes = await repo.getPracticeRunItems(userId, runId);
      if (!isOk(itemsRes)) throw itemsRes.error;
      const graded = attemptsRes.value.filter(attempt => attempt.status === 'GRADED' && attempt.gradingResult);
      const byItem = new Map(graded.map(attempt => [attempt.itemId, attempt]));
      const items = new Map(itemsRes.value.map(item => [item.itemId, item.question]));
      const complete = items.size > 0 ? [...items.keys()].every(id => byItem.has(id))
        : graded.length >= run.blocks.reduce((sum, block) => sum + block.count, 0);
      if (!complete) throw new BusinessError('E_RUN_INCOMPLETE', '仍有题目未完成批改，请完成后再结束练习。', 'VALIDATION');

      for (const attempt of graded) {
        const [existing] = await deps.db.select({ id: quizAttempts.id }).from(quizAttempts)
          .where(eq(quizAttempts.sourceAttemptId, attempt.id)).limit(1);
        if (existing) continue;
        const question = items.get(attempt.itemId);
        if (items.size > 0 && !question) continue;
        const grading = attempt.gradingResult!;
        const isCorrect = grading.isCorrect === true;
        const score = typeof grading.score === 'number' ? grading.score : Number(isCorrect);
        const saved = await submitPracticeAttempt(repo, {
          sourceAttemptId: attempt.id, userId, questionId: question?.id ?? attempt.itemId,
          ...(question ? { questionType: question.type } : {}),
          userAnswer: attempt.userAnswer ?? '', isCorrect, score, timeSpentMs: attempt.timeSpentMs ?? 0,
          testedSkillId: question?.testedSkillId ?? (typeof grading.testedSkillId === 'string' ? grading.testedSkillId : `${run.language}.review`),
          questionContent: question?.content ?? '', correctAnswer: question?.correctAnswer ?? '',
          explanation: typeof grading.explanation === 'string' ? grading.explanation : question?.explanation ?? '',
        });
        // withTransaction rolls back on exceptions, not on Result.err.
        if (!isOk(saved)) throw saved.error;
      }
      const completedAt = nowIso();
      await deps.db.update(practicePlanRuns).set({ status: 'COMPLETED', completedAt })
        .where(eq(practicePlanRuns.id, runId));
      return ok({ ...run, status: 'COMPLETED', completedAt });
    }));
  } catch (error) {
    return err(error instanceof BusinessError ? error : translateToBusinessError(error, {
      category: 'DATABASE', action: 'finalizePracticePlanRun', entityId: runId,
    }));
  }
}
