import { and, count, eq } from 'drizzle-orm';
import {
  ok,
  err,
  isOk,
  type Result,
  BusinessError,
  translateToBusinessError,
  nowIso,
  logger,
} from '@lexdistill/shared';
import type { LearnerLevel } from '@lexdistill/protocol';
import {
  evaluateLevelTransition,
  levelProgressHint,
  type LevelQuizDay,
} from '@lexdistill/learner-core';
import { flashcards, learnerLanguageProfiles } from '@lexdistill/storage-sqlite';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';
import type { TrackLanguage } from '@lexdistill/shared';
import { getTodayString } from '@lexdistill/shared';
import {
  ensureLanguageProfile,
  mirrorLanguageProfileToMain,
  resolveActiveLanguage,
} from '@lexdistill/storage-sqlite';

/**
 * 等级状态机（网关侧）：
 * - 状态变量就是画像 learnerLevel（NOVICE/BEGINNER/INTERMEDIATE/ADVANCED，按语种隔离），不另起宇宙；
 * - 自动边：做题/字母落盘后求值一次，保留阶段资格，日常活动不再改变等级；
 * - 考试边：见 practice 域 placement.ts（跳级通道）；
 * - 求值失败只 warn，永不挡做题/字母主路径。
 */

const LEVEL_SET = new Set(['NOVICE', 'BEGINNER', 'INTERMEDIATE', 'ADVANCED']);

function narrowLevel(raw: unknown): LearnerLevel {
  return typeof raw === 'string' && LEVEL_SET.has(raw) ? (raw as LearnerLevel) : 'NOVICE';
}

export interface LevelChange {
  oldLevel: LearnerLevel;
  newLevel: LearnerLevel;
  direction: 'up' | 'down';
  reason: string;
}

/** 按轨道写档（只动该语种行；正好是活跃轨道才镜像主表，绝不顺手切轨道）。 */
export async function setTrackLevel(
  deps: RepoDeps,
  userId: string,
  track: TrackLanguage,
  level: LearnerLevel
): Promise<Result<LearnerLevel, BusinessError>> {
  try {
    await ensureLanguageProfile(deps, userId, track);
    await deps.db
      .update(learnerLanguageProfiles)
      .set({ learnerLevel: level, updatedAt: nowIso() })
      .where(
        and(
          eq(learnerLanguageProfiles.userId, userId),
          eq(learnerLanguageProfiles.language, track)
        )
      );
    const active = await resolveActiveLanguage(deps, userId);
    if (active === track) {
      const rows = await deps.db
        .select()
        .from(learnerLanguageProfiles)
        .where(
          and(eq(learnerLanguageProfiles.userId, userId), eq(learnerLanguageProfiles.language, track))
        )
        .limit(1);
      if (rows[0]) await mirrorLanguageProfileToMain(deps, userId, track, rows[0]);
    }
    return ok(level);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'setTrackLevel',
        entityId: userId,
      })
    );
  }
}

interface EvalSignals {
  currentLevel: LearnerLevel;
  alphabet: { accuracy: number; attempts: number } | null;
  collectedCount: number;
  quizDays: LevelQuizDay[];
  examPassToday: boolean;
}

/** 组装求值输入（ snapshot/卡数/按天做题/今日考试通过）。 */
async function collectEvalSignals(
  deps: RepoDeps,
  userId: string,
  track: TrackLanguage
): Promise<EvalSignals> {
  const langRow = await ensureLanguageProfile(deps, userId, track);
  const snapshotRes = await deps.repo.getProfileSnapshot(userId, track);
  const metrics = isOk(snapshotRes) ? (snapshotRes.value.allMetrics ?? []) : [];
  const alphaPrefix = track === 'ko' ? 'ko.hangul.' : 'jp.kana.';
  const alphaRows = track === 'en' ? [] : metrics.filter((m) => m.id.startsWith(alphaPrefix));
  const alphaAttempts = alphaRows.reduce((s, m) => s + m.totalAttempts, 0);
  const alphaCorrect = alphaRows.reduce((s, m) => s + m.correctAttempts, 0);

  const cardRows = await deps.db
    .select({ n: count() })
    .from(flashcards)
    .where(and(eq(flashcards.userId, userId), eq(flashcards.language, track)));

  const dayRows = deps.sqlite
    .query(
      `SELECT substr(created_at, 1, 10) AS d, SUM(is_correct) AS c, COUNT(*) AS n
       FROM quiz_attempts WHERE user_id = ? AND language = ?
       GROUP BY d ORDER BY d DESC LIMIT 90`
    )
    .all(userId, track) as Array<{ d: string; c: number; n: number }>;

  const today = getTodayString();
  const passRow = deps.sqlite
    .query(
      `SELECT id AS id FROM placement_exams
       WHERE user_id = ? AND language = ? AND status = 'passed'
         AND substr(completed_at, 1, 10) = ? LIMIT 1`
    )
    .get(userId, track, today) as { id: string } | null;

  return {
    currentLevel: narrowLevel(langRow.learnerLevel),
    alphabet:
      track === 'en'
        ? null
        : {
            accuracy: alphaAttempts > 0 ? alphaCorrect / alphaAttempts : 0,
            attempts: alphaAttempts,
          },
    collectedCount: cardRows[0]?.n ?? 0,
    quizDays: dayRows.map((r) => ({ date: r.d, correct: r.c, total: r.n })),
    examPassToday: passRow !== null,
  };
}

/**
 * 求值并在变化时写档（做题/字母落盘后调用；失败只 warn，返回 null）。
 * 返回变化前后档位（供日志/撒花消费，不进 Result 主路径）。
 */
export async function maybeEvaluateLevel(
  deps: RepoDeps,
  userId: string,
  track: TrackLanguage
): Promise<LevelChange | null> {
  try {
    const signals = await collectEvalSignals(deps, userId, track);
    const res = evaluateLevelTransition({
      track,
      currentLevel: signals.currentLevel,
      alphabet: signals.alphabet,
      collectedCount: signals.collectedCount,
      quizDays: signals.quizDays,
      examPassToday: signals.examPassToday,
    });
    if (!res.changed || res.direction === 'none') return null;
    const written = await setTrackLevel(deps, userId, track, res.newLevel);
    if (!isOk(written)) {
      logger.warn('[level] setTrackLevel failed', { code: written.error.code, userId });
      return null;
    }
    logger.info('[level] transition', {
      userId,
      track,
      from: signals.currentLevel,
      to: res.newLevel,
      reason: res.reason,
    });
    return {
      oldLevel: signals.currentLevel,
      newLevel: res.newLevel,
      direction: res.direction,
      reason: res.reason,
    };
  } catch (error) {
    logger.warn('[level] evaluate failed', {
      message: error instanceof Error ? error.message : String(error),
      userId,
    });
    return null;
  }
}

/** 档位信息（画像页展示：当前档 + 升级提示语）。 */
export async function getLevelInfo(
  deps: RepoDeps,
  userId: string,
  language: string
): Promise<Result<{ level: LearnerLevel; hint: string }, BusinessError>> {
  try {
    const track: TrackLanguage = language === 'ko' ? 'ko' : language === 'en' ? 'en' : 'ja';
    const signals = await collectEvalSignals(deps, userId, track);
    const res = evaluateLevelTransition({
      track,
      currentLevel: signals.currentLevel,
      alphabet: signals.alphabet,
      collectedCount: signals.collectedCount,
      quizDays: signals.quizDays,
      examPassToday: signals.examPassToday,
    });
    return ok({
      level: signals.currentLevel,
      hint: levelProgressHint({
        track,
        currentLevel: signals.currentLevel,
        alphabet: signals.alphabet,
        collectedCount: signals.collectedCount,
        quizDays: signals.quizDays,
        examPassToday: signals.examPassToday,
      }),
    });
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'getLevelInfo',
        entityId: userId,
      })
    );
  }
}
