import { eq, and } from 'drizzle-orm';
import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
  nowIso,
} from '@study-studio/shared';
import {
  updateKanaPracticeMemory,
  type KanaPracticeMemory,
  type KanaPracticeScriptType,
} from '@study-studio/learner-core';
import type { HangulScriptType, SubmitReadingPractice } from '@study-studio/protocol';
import { kanaPracticeStates, skillMetrics } from '@study-studio/storage-sqlite';
import {
  parseKanaPracticeMemory,
  saveKanaPracticeMemory,
} from '@study-studio/storage-sqlite';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';

/**
 * 学习进度域持久化：假名/阅读练习成绩回写（熟练度 + 每日打卡）。
 * G4：由 repository/domains/curriculum-reading.ts 拆分而来；
 * 跨域写统一走 `deps.repo` 接口方法，行为不变。
 */
/**
 * 记录假名练习结果并回写学习者熟练度与每日打卡活动
 */
export async function recordKanaPractice(
  deps: RepoDeps,
  userId: string,
  kanaId: string,
  isCorrect: boolean,
  scriptType: 'HIRAGANA' | 'KATAKANA' | 'ROMAJI' = 'HIRAGANA'
): Promise<Result<{ proficiency: number }, BusinessError>> {
  try {
    const skillId = scriptType === 'KATAKANA' ? 'jp.kana.katakana' : 'jp.kana.hiragana';
    const skillName = scriptType === 'KATAKANA' ? '片假名认读与听写' : '平假名认读与听写';
    const normalizedScriptType: KanaPracticeScriptType = scriptType;

    const existingRows = await deps.db
      .select()
      .from(skillMetrics)
      .where(and(eq(skillMetrics.userId, userId), eq(skillMetrics.skillId, skillId)))
      .limit(1);

    let totalAttempts = 1;
    let correctAttempts = isCorrect ? 1 : 0;
    let consecutiveErrors = isCorrect ? 0 : 1;

    if (existingRows.length > 0) {
      const row = existingRows[0]!;
      totalAttempts = row.totalAttempts + 1;
      correctAttempts = row.correctAttempts + (isCorrect ? 1 : 0);
      consecutiveErrors = isCorrect ? 0 : row.consecutiveErrors + 1;
    }

    const proficiency = Math.min(
      1.0,
      Math.max(0.05, Number((correctAttempts / totalAttempts).toFixed(2)))
    );

    const status =
      consecutiveErrors >= 2
        ? 'WEAKNESS'
        : proficiency >= 0.85 && totalAttempts >= 5
        ? 'STRENGTH'
        : 'NORMAL';

    await deps.repo.saveSkillMetric(userId, {
      id: skillId,
      dimension: 'VOCABULARY',
      name: skillName,
      proficiency,
      totalAttempts,
      correctAttempts,
      consecutiveErrors,
      status,
      lastPracticedAt: nowIso(),
    });

    const previousStateRows = await deps.db
      .select()
      .from(kanaPracticeStates)
      .where(
        and(
          eq(kanaPracticeStates.userId, userId),
          eq(kanaPracticeStates.kanaId, kanaId),
          eq(kanaPracticeStates.scriptType, normalizedScriptType)
        )
      )
      .limit(1);
    const previousMemory = previousStateRows[0]
      ? parseKanaPracticeMemory(
          previousStateRows[0].fsrsJson,
          previousStateRows[0].consecutiveErrors
        )
      : undefined;
    const nextMemory: KanaPracticeMemory = updateKanaPracticeMemory(previousMemory, isCorrect);
    await saveKanaPracticeMemory(
      deps.db,
      userId,
      kanaId,
      normalizedScriptType,
      nextMemory,
      nowIso()
    );

    // 累计当日学习足迹（假名 drill 单独计数，不再与自适应做题混在一起；语种显式 ja，不跟 profile 默认走）
    await deps.repo.recordDailyActivity(userId, { quizzes: 1, kanaDrills: 1, language: 'ja' });

    return ok({ proficiency });
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'recordKanaPractice',
        entityId: kanaId,
      })
    );
  }
}
/**
 * 记录谚文字母练习结果并回写学习者熟练度与每日打卡活动
 * （子音 / 基本母音 / 进阶复音收音三分技能）。
 */
export async function recordHangulPractice(
  deps: RepoDeps,
  userId: string,
  hangulId: string,
  isCorrect: boolean,
  scriptType: HangulScriptType = 'CONSONANT'
): Promise<Result<{ proficiency: number }, BusinessError>> {
  try {
    const skillId =
      scriptType === 'VOWEL'
        ? 'ko.hangul.vowel'
        : scriptType === 'CONSONANT' || scriptType === 'ROMANIZATION'
          ? 'ko.hangul.consonant'
          : 'ko.hangul.compound';
    const skillName =
      scriptType === 'VOWEL'
        ? '谚文母音认读与听写'
        : scriptType === 'CONSONANT' || scriptType === 'ROMANIZATION'
          ? '谚文子音认读与听写'
          : '谚文复音与收音认读';

    const existingRows = await deps.db
      .select()
      .from(skillMetrics)
      .where(and(eq(skillMetrics.userId, userId), eq(skillMetrics.skillId, skillId)))
      .limit(1);

    let totalAttempts = 1;
    let correctAttempts = isCorrect ? 1 : 0;
    let consecutiveErrors = isCorrect ? 0 : 1;

    if (existingRows.length > 0) {
      const row = existingRows[0]!;
      totalAttempts = row.totalAttempts + 1;
      correctAttempts = row.correctAttempts + (isCorrect ? 1 : 0);
      consecutiveErrors = isCorrect ? 0 : row.consecutiveErrors + 1;
    }

    const proficiency = Math.min(
      1.0,
      Math.max(0.05, Number((correctAttempts / totalAttempts).toFixed(2)))
    );

    const status =
      consecutiveErrors >= 2
        ? 'WEAKNESS'
        : proficiency >= 0.85 && totalAttempts >= 5
          ? 'STRENGTH'
          : 'NORMAL';

    await deps.repo.saveSkillMetric(userId, {
      id: skillId,
      dimension: 'VOCABULARY',
      name: skillName,
      proficiency,
      totalAttempts,
      correctAttempts,
      consecutiveErrors,
      status,
      lastPracticedAt: nowIso(),
    });

    // 累计当日学习足迹（谚文 drill 单独计数，不再与自适应做题混在一起；语种显式 ko）
    await deps.repo.recordDailyActivity(userId, { quizzes: 1, hangulDrills: 1, language: 'ko' });

    return ok({ proficiency });
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'recordHangulPractice',
        entityId: hangulId,
      })
    );
  }
}
/**
 * 记录阅读理解做题成绩，同步更新学情雷达与当日打卡活动
 */
export async function recordReadingPractice(
  deps: RepoDeps,
  userId: string,
  input: SubmitReadingPractice
): Promise<Result<{ proficiency: number }, BusinessError>> {
  try {
    const skillId =
      input.language === 'JA'
        ? 'jp.reading.comprehension'
        : input.language === 'KO'
          ? 'ko.reading.comprehension'
          : 'en.reading.comprehension';
    const skillName =
      input.language === 'JA'
        ? '日语长文阅读与理解'
        : input.language === 'KO'
          ? '韩语阅读理解（扩展预留）'
          : '英语篇章精读与理解';

    const existingRows = await deps.db
      .select()
      .from(skillMetrics)
      .where(and(eq(skillMetrics.userId, userId), eq(skillMetrics.skillId, skillId)))
      .limit(1);

    let totalAttempts = input.totalQuestions;
    let correctAttempts = input.score;
    const isGoodScore = input.score >= Math.ceil(input.totalQuestions * 0.6);
    let consecutiveErrors = isGoodScore ? 0 : 1;

    if (existingRows.length > 0) {
      const row = existingRows[0]!;
      totalAttempts = row.totalAttempts + input.totalQuestions;
      correctAttempts = row.correctAttempts + input.score;
      consecutiveErrors = isGoodScore ? 0 : row.consecutiveErrors + 1;
    }

    const proficiency = Math.min(
      1.0,
      Math.max(0.05, Number((correctAttempts / totalAttempts).toFixed(2)))
    );

    const status =
      consecutiveErrors >= 2
        ? 'WEAKNESS'
        : proficiency >= 0.85 && totalAttempts >= 6
        ? 'STRENGTH'
        : 'NORMAL';

    await deps.repo.saveSkillMetric(userId, {
      id: skillId,
      dimension: 'READING',
      name: skillName,
      proficiency,
      totalAttempts,
      correctAttempts,
      consecutiveErrors,
      status,
      lastPracticedAt: nowIso(),
    });

    // 阅读篇目单独计数；题量仍计入 quizzes 以兼容原有每日目标
    await deps.repo.recordDailyActivity(userId, {
      quizzes: input.totalQuestions,
      reading: 1,
    });

    return ok({ proficiency });
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'recordReadingPractice',
        entityId: input.setId,
      })
    );
  }
}
