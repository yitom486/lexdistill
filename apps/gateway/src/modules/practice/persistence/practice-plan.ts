import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
  generateId,
  nowIso,
  isOk,
} from '@study-studio/shared';
import type { PracticePlanRun } from '@study-studio/protocol';
import { eq, and } from 'drizzle-orm';
import { quizAttempts, practicePlanRuns } from '@study-studio/storage-sqlite';
import {
  getPracticePlanRun,
  listPracticeItemAttempts,
} from '@study-studio/storage-sqlite';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';

/**
 * 练习计划收尾编排（D3 留守件）。
 *
 * 本文件仅保留 finalizePracticePlanRun：它是唯一需要完整 RepoDeps 的函数
 *（SAVEPOINT 异步 UoW＋跨 run/attempts/quiz/打卡扇出写回，见内联注释）。
 * 其余 13 纯函数已迁 `@study-studio/storage-sqlite` adapters/practice/practice-plan.ts；
 * 本函数签名保持 `RepoDeps` 不变，调用方（门面/placement/测试）零改动。
 */
export async function finalizePracticePlanRun(
  deps: RepoDeps,
  userId: string,
  runId: string
): Promise<Result<PracticePlanRun, BusinessError>> {
  try {
    return await deps.repo.withTransaction(async (repo) => {
      const runRes = await repo.getPracticePlanRun(userId, runId);
      if (!isOk(runRes) || !runRes.value) {
        return err(new BusinessError('E_RUN_NOT_FOUND', '练习运行未找到', 'DATABASE'));
      }
      const run = runRes.value;
      if (run.status === 'COMPLETED') {
        return ok(run);
      }
      const attemptsRes = await repo.listPracticeItemAttempts(runId);
      if (!isOk(attemptsRes)) return err(attemptsRes.error);
      const graded = attemptsRes.value.filter((a) => a.status === 'GRADED' && a.gradingResult);
      // 原子写入既有 quiz_attempts/错题/打卡（SSOT）。
      // 每个 GRADED 尝试按其 gradingResult 写一次 quiz_attempt；幂等：同 itemId 已写则跳过。
      for (const a of graded) {
        const already = await deps.db
          .select({ id: quizAttempts.id })
          .from(quizAttempts)
          .where(and(eq(quizAttempts.userId, userId), eq(quizAttempts.questionId, a.itemId)))
          .limit(1);
        if (already.length > 0) continue;
        const g = a.gradingResult as {
          isCorrect?: boolean;
          score?: number;
          testedSkillId?: string;
          explanation?: string;
          correctAnswer?: string;
        };
        const isCorrect = g.isCorrect ?? false;
        const score = typeof g.score === 'number' ? g.score : isCorrect ? 1 : 0;
        await deps.db.insert(quizAttempts).values({
          id: generateId('qatt'),
          userId,
          language: run.language,
          questionId: a.itemId,
          userAnswer: a.userAnswer ?? '',
          isCorrect,
          score,
          timeSpentMs: a.timeSpentMs ?? 0,
          testedSkillId: g.testedSkillId ?? 'review',
          createdAt: a.gradedAt ?? nowIso(),
        });
        // 记录每日活动（打卡 SSOT）；按 GRADED 题数累加 quizzes。
        await repo.recordDailyActivity(userId, { quizzes: 1, date: (a.gradedAt ?? nowIso()).slice(0, 10) });
      }
      const now = nowIso();
      await deps.db
        .update(practicePlanRuns)
        .set({ status: 'COMPLETED', completedAt: now })
        .where(eq(practicePlanRuns.id, runId));
      return ok({ ...run, status: 'COMPLETED', completedAt: now });
    });
  } catch (error) {
    return err(translateToBusinessError(error, { category: 'DATABASE', action: 'finalizePracticePlanRun', entityId: runId }));
  }
}
