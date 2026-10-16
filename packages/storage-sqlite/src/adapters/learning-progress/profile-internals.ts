import { eq, and } from 'drizzle-orm';
import { nowIso } from '@lexdistill/shared';
import { learnerProfiles, learnerLanguageProfiles } from '../../schema.js';
import type { DrizzleDb } from '../../connection.js';
import type { TrackLanguage } from '@lexdistill/shared';
import { normalizeTrackLanguage } from '@lexdistill/shared';
import { defaultLanguageProfileSeed } from '@lexdistill/shared';

/**
 * 画像域内部 helpers（由 DrizzleLearnerRepository 私有方法搬迁而来，行为不变）。
 * 跨域复用时从这里 import；外观类保留同名 thin  wrapper 供尚未搬迁的方法调用。
 *
 * D3 起家在 storage-sqlite（前身 gateway modules/learning-progress/persistence/profile-internals.ts，
 * 逻辑不变）。参数收窄为 `{ db }`。
 */

export async function resolveActiveLanguage(
  deps: { db: DrizzleDb },
  userId: string
): Promise<TrackLanguage> {
  const rows = await deps.db
    .select({ targetLanguage: learnerProfiles.targetLanguage })
    .from(learnerProfiles)
    .where(eq(learnerProfiles.userId, userId))
    .limit(1);
  return normalizeTrackLanguage(rows[0]?.targetLanguage);
}

export async function ensureLanguageProfile(
  deps: { db: DrizzleDb },
  userId: string,
  language: TrackLanguage,
  seed?: Partial<{
    studyGoal: string;
    learnerLevel: string;
    overallLevel: string;
    overallProficiency: number;
    streakDays: number;
    maxStreakDays: number;
    lastActiveDate: string | null;
    retentionRate: number;
    dailyGoalQuizzes: number;
    dailyGoalCards: number;
    totalStudyMinutes: number;
    totalCardsReviewed: number;
    totalQuizzesAnswered: number;
  }>
): Promise<typeof learnerLanguageProfiles.$inferSelect> {
  const existing = await deps.db
    .select()
    .from(learnerLanguageProfiles)
    .where(
      and(
        eq(learnerLanguageProfiles.userId, userId),
        eq(learnerLanguageProfiles.language, language)
      )
    )
    .limit(1);
  if (existing[0]) return existing[0];

  const defaults = defaultLanguageProfileSeed(language);
  const row = {
    userId,
    language,
    studyGoal: seed?.studyGoal ?? defaults.studyGoal,
    learnerLevel: seed?.learnerLevel ?? defaults.learnerLevel,
    overallLevel: seed?.overallLevel ?? defaults.overallLevel,
    overallProficiency: seed?.overallProficiency ?? 0,
    streakDays: seed?.streakDays ?? 0,
    maxStreakDays: seed?.maxStreakDays ?? 0,
    lastActiveDate: seed?.lastActiveDate ?? null,
    retentionRate: seed?.retentionRate ?? 0.85,
    dailyGoalQuizzes: seed?.dailyGoalQuizzes ?? 5,
    dailyGoalCards: seed?.dailyGoalCards ?? 10,
    totalStudyMinutes: seed?.totalStudyMinutes ?? 0,
    totalCardsReviewed: seed?.totalCardsReviewed ?? 0,
    totalQuizzesAnswered: seed?.totalQuizzesAnswered ?? 0,
    updatedAt: nowIso(),
  };
  await deps.db.insert(learnerLanguageProfiles).values(row);
  return row as typeof learnerLanguageProfiles.$inferSelect;
}

export async function mirrorLanguageProfileToMain(
  deps: { db: DrizzleDb },
  userId: string,
  language: TrackLanguage,
  langRow: typeof learnerLanguageProfiles.$inferSelect,
  displayName?: string
): Promise<void> {
  const patch: Record<string, unknown> = {
    targetLanguage: language,
    studyGoal: langRow.studyGoal,
    learnerLevel: langRow.learnerLevel,
    overallLevel: langRow.overallLevel,
    overallProficiency: langRow.overallProficiency,
    streakDays: langRow.streakDays,
    maxStreakDays: langRow.maxStreakDays,
    lastActiveDate: langRow.lastActiveDate,
    retentionRate: langRow.retentionRate,
    dailyGoalQuizzes: langRow.dailyGoalQuizzes,
    dailyGoalCards: langRow.dailyGoalCards,
    dailyGoalNewWords: langRow.dailyGoalNewWords,
    wordLevelFilterJson: langRow.wordLevelFilterJson,
    totalStudyMinutes: langRow.totalStudyMinutes,
    totalCardsReviewed: langRow.totalCardsReviewed,
    totalQuizzesAnswered: langRow.totalQuizzesAnswered,
    updatedAt: nowIso(),
  };
  if (displayName !== undefined) patch.displayName = displayName;
  await deps.db.update(learnerProfiles).set(patch).where(eq(learnerProfiles.userId, userId));
}
