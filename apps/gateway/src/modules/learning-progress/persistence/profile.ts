import { eq, and } from 'drizzle-orm';
import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
  nowIso,
  isOk,
} from '@lexdistill/shared';
import type {
  SkillDimension,
  SkillMetric,
  SkillStatus,
  LearnerProfileSnapshot,
  LearnerProfile,
} from '@lexdistill/learner-core';
import { JlptLevelSchema } from '@lexdistill/protocol';
import {
  learnerProfiles,
  learnerLanguageProfiles,
  skillMetrics,
} from '@lexdistill/storage-sqlite';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';
import { normalizeTrackLanguage, inferLanguageFromSkillId } from '@lexdistill/shared';
import {
  ensureLanguageProfile,
  mirrorLanguageProfileToMain,
} from '@lexdistill/storage-sqlite';

/**
 * 画像域（由 DrizzleLearnerRepository 搬迁而来，行为不变）。
 * 跨域调用一律走 `deps.repo`（接口方法）；同域 helper 从 profile-internals import。
 */

/** word_level_filter_json → JLPT 集合；坏值/空一律回 null（自动定级），读侧永不抛。 */
function parseWordLevelFilter(raw: unknown): LearnerProfile['wordLevelFilter'] {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  } else if (raw != null && !Array.isArray(raw)) {
    return null;
  }
  if (value == null) return null;
  const parsed = JlptLevelSchema.array().max(5).safeParse(value);
  return parsed.success ? [...new Set(parsed.data)] : null;
}

/**
 * 获取或初始化学习者基础档案（主表 + 当前语种档案合并）
 */

const SKILL_DIMENSIONS: readonly SkillDimension[] = [
  'VOCABULARY',
  'GRAMMAR',
  'LISTENING',
  'NUANCE_PRAGMATIC',
  'READING',
];
const SKILL_STATUSES: readonly SkillStatus[] = ['STRENGTH', 'NORMAL', 'WEAKNESS'];

/** DB TEXT 列 → 联合类型；损坏值回退中性默认（读侧永不抛，种子/正常写入不受影响）。 */
function coerceSkillDimension(value: unknown): SkillDimension {
  return (SKILL_DIMENSIONS as readonly unknown[]).includes(value)
    ? (value as SkillDimension)
    : 'VOCABULARY';
}

function coerceSkillStatus(value: unknown): SkillStatus {
  return (SKILL_STATUSES as readonly unknown[]).includes(value)
    ? (value as SkillStatus)
    : 'NORMAL';
}
export async function getLearnerProfile(
  deps: RepoDeps,
  userId: string,
  langOverride?: string
): Promise<Result<LearnerProfile, BusinessError>> {
  try {
    const rows = await deps.db
      .select()
      .from(learnerProfiles)
      .where(eq(learnerProfiles.userId, userId))
      .limit(1);

    if (rows.length > 0) {
      const row = rows[0]!;
      const language = normalizeTrackLanguage(langOverride ?? row.targetLanguage);
      const langRow = await ensureLanguageProfile(deps, userId, language, language === normalizeTrackLanguage(row.targetLanguage) ? {
        studyGoal: row.studyGoal,
        learnerLevel: row.learnerLevel,
        overallLevel: row.overallLevel,
        overallProficiency: row.overallProficiency,
        streakDays: row.streakDays,
        maxStreakDays: row.maxStreakDays,
        lastActiveDate: row.lastActiveDate,
        retentionRate: row.retentionRate,
        dailyGoalQuizzes: row.dailyGoalQuizzes,
        dailyGoalCards: row.dailyGoalCards,
        totalStudyMinutes: row.totalStudyMinutes,
        totalCardsReviewed: row.totalCardsReviewed,
        totalQuizzesAnswered: row.totalQuizzesAnswered,
      } : undefined);

      return ok({
        userId: row.userId,
        displayName: row.displayName || '学习者',
        targetLanguage: language,
        studyGoal: (langRow.studyGoal as LearnerProfile['studyGoal']) || 'CET6',
        learnerLevel: (langRow.learnerLevel as LearnerProfile['learnerLevel']) || 'BEGINNER',
        overallLevel: langRow.overallLevel,
        overallProficiency: langRow.overallProficiency,
        streakDays: langRow.streakDays,
        maxStreakDays: langRow.maxStreakDays,
        lastActiveDate: langRow.lastActiveDate,
        retentionRate: langRow.retentionRate,
        dailyGoalQuizzes: langRow.dailyGoalQuizzes,
        dailyGoalCards: langRow.dailyGoalCards,
        dailyGoalNewWords: langRow.dailyGoalNewWords ?? 10,
        wordLevelFilter: parseWordLevelFilter(langRow.wordLevelFilterJson),
        totalStudyMinutes: langRow.totalStudyMinutes,
        totalCardsReviewed: langRow.totalCardsReviewed,
        totalQuizzesAnswered: langRow.totalQuizzesAnswered,
        updatedAt: langRow.updatedAt || row.updatedAt,
      });
    }

    const defaultProfile: LearnerProfile = {
      userId,
      displayName: '学员 ' + userId.slice(-4),
      targetLanguage: 'en',
      studyGoal: 'CET6',
      learnerLevel: 'NOVICE',
      overallLevel: '待评测',
      overallProficiency: 0,
      streakDays: 0,
      maxStreakDays: 0,
      lastActiveDate: null,
      retentionRate: 1.0,
      dailyGoalQuizzes: 5,
      dailyGoalCards: 10,
      dailyGoalNewWords: 10,
      wordLevelFilter: null,
      totalStudyMinutes: 0,
      totalCardsReviewed: 0,
      totalQuizzesAnswered: 0,
      updatedAt: nowIso(),
    };

    await deps.db.insert(learnerProfiles).values({
      ...defaultProfile,
    });
    await ensureLanguageProfile(deps, userId, 'en', defaultProfile);

    return langOverride && normalizeTrackLanguage(langOverride) !== 'en'
      ? deps.repo.getLearnerProfile(userId, langOverride) : ok(defaultProfile);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'getLearnerProfile',
        entityId: userId,
      })
    );
  }
}

/**
 * 更新学习者档案：目标/等级/配额写入当前语种行；切换 targetLanguage 时镜像新语种行
 */
export async function updateLearnerProfile(
  deps: RepoDeps,
  userId: string,
  input: Partial<LearnerProfile>
): Promise<Result<LearnerProfile, BusinessError>> {
  try {
    const currentRes = await deps.repo.getLearnerProfile(userId);
    if (!isOk(currentRes)) return currentRes;
    const current = currentRes.value;

    const nextLanguage = input.targetLanguage
      ? normalizeTrackLanguage(input.targetLanguage)
      : normalizeTrackLanguage(current.targetLanguage);

    const switching = nextLanguage !== normalizeTrackLanguage(current.targetLanguage);

    if (input.displayName !== undefined) {
      await deps.db
        .update(learnerProfiles)
        .set({ displayName: input.displayName, updatedAt: nowIso() })
        .where(eq(learnerProfiles.userId, userId));
    }

    // 切换轨道：确保目标语种行存在，并镜像到主表
    if (switching) {
      const langRow = await ensureLanguageProfile(deps, userId, nextLanguage);
      await mirrorLanguageProfileToMain(
        deps,
        userId,
        nextLanguage,
        langRow,
        input.displayName ?? current.displayName
      );
    }

    const activeLang = nextLanguage;
    const langPatch: Record<string, unknown> = { updatedAt: nowIso() };
    if (input.studyGoal !== undefined) langPatch.studyGoal = input.studyGoal;
    if (input.learnerLevel !== undefined) langPatch.learnerLevel = input.learnerLevel;
    if (input.overallLevel !== undefined) langPatch.overallLevel = input.overallLevel;
    if (input.overallProficiency !== undefined)
      langPatch.overallProficiency = input.overallProficiency;
    if (input.dailyGoalQuizzes !== undefined) langPatch.dailyGoalQuizzes = input.dailyGoalQuizzes;
    if (input.dailyGoalCards !== undefined) langPatch.dailyGoalCards = input.dailyGoalCards;
    if (input.dailyGoalNewWords !== undefined) langPatch.dailyGoalNewWords = input.dailyGoalNewWords;
    if (input.wordLevelFilter !== undefined) {
      langPatch.wordLevelFilterJson = input.wordLevelFilter === null ? null : JSON.stringify([...new Set(input.wordLevelFilter)]);
    }
    if (input.streakDays !== undefined) langPatch.streakDays = input.streakDays;
    if (input.maxStreakDays !== undefined) langPatch.maxStreakDays = input.maxStreakDays;
    if (input.lastActiveDate !== undefined) langPatch.lastActiveDate = input.lastActiveDate;
    if (input.retentionRate !== undefined) langPatch.retentionRate = input.retentionRate;
    if (input.totalStudyMinutes !== undefined)
      langPatch.totalStudyMinutes = input.totalStudyMinutes;
    if (input.totalCardsReviewed !== undefined)
      langPatch.totalCardsReviewed = input.totalCardsReviewed;
    if (input.totalQuizzesAnswered !== undefined)
      langPatch.totalQuizzesAnswered = input.totalQuizzesAnswered;

    await ensureLanguageProfile(deps, userId, activeLang);
    if (Object.keys(langPatch).length > 1) {
      await deps.db
        .update(learnerLanguageProfiles)
        .set(langPatch)
        .where(
          and(
            eq(learnerLanguageProfiles.userId, userId),
            eq(learnerLanguageProfiles.language, activeLang)
          )
        );
    }

    const refreshed = await deps.db
      .select()
      .from(learnerLanguageProfiles)
      .where(
        and(
          eq(learnerLanguageProfiles.userId, userId),
          eq(learnerLanguageProfiles.language, activeLang)
        )
      )
      .limit(1);
    if (refreshed[0]) {
      await mirrorLanguageProfileToMain(
        deps,
        userId,
        activeLang,
        refreshed[0],
        input.displayName
      );
    } else {
      await deps.db
        .update(learnerProfiles)
        .set({ targetLanguage: activeLang, updatedAt: nowIso() })
        .where(eq(learnerProfiles.userId, userId));
    }

    return deps.repo.getLearnerProfile(userId);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'updateLearnerProfile',
        entityId: userId,
      })
    );
  }
}

/**
 * 获取学习者全景画像快照 (融合雷达技能、基础档案与每日任务进度)
 */
export async function getProfileSnapshot(
  deps: RepoDeps,
  userId: string,
  langOverride?: string
): Promise<Result<LearnerProfileSnapshot, BusinessError>> {
  try {
    const profileRes = await deps.repo.getLearnerProfile(userId, langOverride);
    const profile = isOk(profileRes) ? profileRes.value : undefined;

    const dailyTaskRes = await deps.repo.getDailyTaskProgress(userId, undefined, langOverride);
    const dailyTask = isOk(dailyTaskRes) ? dailyTaskRes.value : undefined;

    const language = langOverride
      ? normalizeTrackLanguage(langOverride)
      : normalizeTrackLanguage(profile?.targetLanguage);

    let rows = await deps.db
      .select()
      .from(skillMetrics)
      .where(and(eq(skillMetrics.userId, userId), eq(skillMetrics.language, language)));

    // 严禁跨语种回退：英语轨道空雷达应显示空态，不得混入日语 jp.* 指标

    const allMetrics: SkillMetric[] = rows.map((r) => ({
      id: r.skillId,
      dimension: coerceSkillDimension(r.dimension),
      name: r.name,
      proficiency: r.proficiency,
      totalAttempts: r.totalAttempts,
      correctAttempts: r.correctAttempts,
      consecutiveErrors: r.consecutiveErrors,
      status: coerceSkillStatus(r.status),
      lastPracticedAt: r.lastPracticedAt ?? undefined,
    }));

    const strengths = allMetrics.filter((m) => m.proficiency >= 0.8 && m.consecutiveErrors === 0);
    const weaknesses = allMetrics.filter(
      (m) => m.proficiency < 0.6 || m.consecutiveErrors >= 2 || m.status === 'WEAKNESS'
    );

    return ok({
      userId,
      profile,
      targetLanguage: profile?.targetLanguage ?? 'en',
      overallLevel: profile?.overallLevel ?? 'B1',
      strengths,
      weaknesses,
      allMetrics,
      dailyTask,
      updatedAt: nowIso(),
    });
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'getProfileSnapshot',
        entityId: userId,
      })
    );
  }
}

export async function saveSkillMetric(
  deps: RepoDeps,
  userId: string,
  metric: SkillMetric
): Promise<Result<void, BusinessError>> {
  try {
    const existing = await deps.db
      .select()
      .from(skillMetrics)
      .where(
        and(
          eq(skillMetrics.userId, userId),
          eq(skillMetrics.skillId, metric.id)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await deps.db
        .update(skillMetrics)
        .set({
          language: inferLanguageFromSkillId(metric.id),
          dimension: metric.dimension,
          name: metric.name,
          proficiency: metric.proficiency,
          totalAttempts: metric.totalAttempts,
          correctAttempts: metric.correctAttempts,
          consecutiveErrors: metric.consecutiveErrors,
          status: metric.status,
          lastPracticedAt: metric.lastPracticedAt ?? null,
        })
        .where(
          and(
            eq(skillMetrics.userId, userId),
            eq(skillMetrics.skillId, metric.id)
          )
        );
    } else {
      await deps.db.insert(skillMetrics).values({
        userId,
        skillId: metric.id,
        language: inferLanguageFromSkillId(metric.id),
        dimension: metric.dimension,
        name: metric.name,
        proficiency: metric.proficiency,
        totalAttempts: metric.totalAttempts,
        correctAttempts: metric.correctAttempts,
        consecutiveErrors: metric.consecutiveErrors,
        status: metric.status,
        lastPracticedAt: metric.lastPracticedAt ?? null,
      });
    }

    return ok(undefined);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'saveSkillMetric',
        entityId: metric.id,
      })
    );
  }
}
