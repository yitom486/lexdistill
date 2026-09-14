import { eq, and } from 'drizzle-orm';
import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
  nowIso,
} from '@study-studio/shared';
import type { MistakeEntry } from '@study-studio/learner-core';
import type { GeneratedQuestion } from '@study-studio/protocol';
import { mistakes } from '@study-studio/storage-sqlite';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';
import { normalizeTrackLanguage, inferLanguageFromSkillId } from '@study-studio/shared';
import { resolveActiveLanguage } from './profile-internals.js';

/**
 * 错题域（由 DrizzleLearnerRepository 搬迁而来，行为不变）。
 * 跨域调用一律走 `deps.repo`（接口方法）；同域互调直接调模块函数。
 */

export async function saveMistake(
  deps: RepoDeps,
  mistake: MistakeEntry
): Promise<Result<void, BusinessError>> {
  try {
    // question 为持久化 JSON；testedSkill 为历史字段，testedSkillId 为准。
    const question = (mistake.question ?? {}) as Partial<GeneratedQuestion> & {
      testedSkill?: unknown;
    };
    const skillId =
      (typeof question.testedSkillId === 'string' ? question.testedSkillId : '') ||
      (typeof question.testedSkill === 'string' ? question.testedSkill : '') ||
      '';
    // MistakeEntry 领域类型无 language 列；兼容历史写入中可能携带的透传字段。
    const storedLanguage = (mistake as { language?: unknown }).language;
    const language = normalizeTrackLanguage(
      (typeof storedLanguage === 'string' ? storedLanguage : undefined) ??
        (await resolveActiveLanguage(deps, mistake.userId)) ??
        inferLanguageFromSkillId(String(skillId))
    );
    const existing = await deps.db
      .select()
      .from(mistakes)
      .where(eq(mistakes.id, mistake.id))
      .limit(1);

    if (existing.length > 0) {
      await deps.db
        .update(mistakes)
        .set({
          language,
          questionId: mistake.questionId,
          question: JSON.stringify(mistake.question),
          lastUserSubmission: mistake.lastUserSubmission,
          lastGrading: JSON.stringify(mistake.lastGrading),
          recordedAt: mistake.recordedAt,
          lastRetriedAt: mistake.lastRetriedAt ?? null,
          retryCount: mistake.retryCount,
          consecutiveCorrect: mistake.consecutiveCorrect,
          isResolved: mistake.isResolved,
        })
        .where(eq(mistakes.id, mistake.id));
    } else {
      await deps.db.insert(mistakes).values({
        id: mistake.id,
        userId: mistake.userId,
        language,
        questionId: mistake.questionId,
        question: JSON.stringify(mistake.question),
        lastUserSubmission: mistake.lastUserSubmission,
        lastGrading: JSON.stringify(mistake.lastGrading),
        recordedAt: mistake.recordedAt,
        lastRetriedAt: mistake.lastRetriedAt ?? null,
        retryCount: mistake.retryCount,
        consecutiveCorrect: mistake.consecutiveCorrect,
        isResolved: mistake.isResolved,
      });
    }

    return ok(undefined);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'saveMistake',
        entityId: mistake.id,
      })
    );
  }
}

export async function getMistakes(
  deps: RepoDeps,
  userId: string,
  filter?: { resolved?: boolean; language?: string }
): Promise<Result<MistakeEntry[], BusinessError>> {
  try {
    const language = filter?.language
      ? normalizeTrackLanguage(filter.language)
      : await resolveActiveLanguage(deps, userId);
    let rows = await deps.db
      .select()
      .from(mistakes)
      .where(and(eq(mistakes.userId, userId), eq(mistakes.language, language)));

    const filteredRows = filter?.resolved !== undefined
      ? rows.filter((r) => Boolean(r.isResolved) === filter.resolved)
      : rows;

    const results: MistakeEntry[] = filteredRows.map((r) => ({
      id: r.id,
      userId: r.userId,
      questionId: r.questionId,
      question: JSON.parse(r.question),
      lastUserSubmission: r.lastUserSubmission,
      lastGrading: JSON.parse(r.lastGrading),
      recordedAt: r.recordedAt,
      lastRetriedAt: r.lastRetriedAt ?? undefined,
      retryCount: r.retryCount,
      consecutiveCorrect: r.consecutiveCorrect,
      isResolved: Boolean(r.isResolved),
    }));

    return ok(results);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'getMistakes',
        entityId: userId,
      })
    );
  }
}

export async function resolveMistake(
  deps: RepoDeps,
  mistakeId: string
): Promise<Result<void, BusinessError>> {
  try {
    const rows = await deps.db
      .select()
      .from(mistakes)
      .where(eq(mistakes.id, mistakeId))
      .limit(1);

    if (rows.length === 0) {
      return err(new BusinessError('E_NOT_FOUND', '错题记录未找到', 'DATABASE'));
    }

    const mistake = rows[0]!;
    await deps.db
      .update(mistakes)
      .set({
        isResolved: true,
        consecutiveCorrect: Math.max(2, mistake.consecutiveCorrect + 1),
        lastRetriedAt: nowIso(),
      })
      .where(eq(mistakes.id, mistakeId));

    // 自动记录错题消除足迹
    await deps.repo.recordDailyActivity(mistake.userId, { mistakesResolved: 1 });

    return ok(undefined);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'resolveMistake',
        entityId: mistakeId,
      })
    );
  }
}

/**
 * 记录一次错题重做结果；是否出库完全由 SQLite 中的连续正确次数决定。
 */
export async function retryMistake(
  deps: RepoDeps,
  userId: string,
  mistakeId: string,
  isCorrect: boolean
): Promise<Result<Pick<MistakeEntry, 'consecutiveCorrect' | 'isResolved' | 'retryCount'>, BusinessError>> {
  try {
    const rows = await deps.db
      .select()
      .from(mistakes)
      .where(and(eq(mistakes.id, mistakeId), eq(mistakes.userId, userId)))
      .limit(1);

    if (rows.length === 0) {
      return err(new BusinessError('E_NOT_FOUND', '错题记录未找到', 'DATABASE'));
    }

    const mistake = rows[0]!;
    const consecutiveCorrect = isCorrect ? mistake.consecutiveCorrect + 1 : 0;
    const isResolved = consecutiveCorrect >= 2;
    const retryCount = mistake.retryCount + 1;

    await deps.db
      .update(mistakes)
      .set({
        retryCount,
        consecutiveCorrect,
        isResolved,
        lastRetriedAt: nowIso(),
      })
      .where(eq(mistakes.id, mistakeId));

    // 仅在本次由未攻克转为攻克时计入每日完成量。
    if (isResolved && !mistake.isResolved) {
      await deps.repo.recordDailyActivity(userId, { mistakesResolved: 1 });
    }

    return ok({ consecutiveCorrect, isResolved, retryCount });
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'retryMistake',
        entityId: mistakeId,
      })
    );
  }
}
