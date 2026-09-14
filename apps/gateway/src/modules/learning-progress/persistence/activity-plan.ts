import { eq, and, desc, gte, lte, inArray, like } from 'drizzle-orm';
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
import type {
  DailyTaskProgress,
  DailyStudyPlan,
  DailyPlanStepTemplate,
} from '@study-studio/learner-core';
import {
  buildDailyPlanStepTemplates,
  parseCompletedStepIds,
  parseDailyPlanStepTemplates,
  summarizeDailyStudyPlan,
  appendPracticePlanStep,
  PRACTICE_PLAN_STEP_ID,
} from '@study-studio/learner-core';
import { parsePracticeBlockSpecs } from '@study-studio/learning';
import {
  studyActivityLogs,
  learnerLanguageProfiles,
  dailyStudyPlans,
  practicePlanRuns,
  practiceItemAttempts,
} from '@study-studio/storage-sqlite';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';
import type { TrackLanguage } from '../../../infrastructure/persistence/language.js';
import { normalizeTrackLanguage } from '../../../infrastructure/persistence/language.js';
import {
  ensureLanguageProfile,
  mirrorLanguageProfileToMain,
} from './profile-internals.js';
import { getTodayString, getYesterdayString, safeJsonParse } from '../../../infrastructure/persistence/repo-utils.js';

/**
 * 足迹/计划域（由 DrizzleLearnerRepository 搬迁而来，行为不变）。
 * 跨域调用一律走 `deps.repo`（接口方法）；同域 helper 从 profile-internals / repo-utils import。
 */

/**
 * 获取指定日期的每日任务进度 (默认为今日)
 */
export async function getDailyTaskProgress(
  deps: RepoDeps,
  userId: string,
  date?: string
): Promise<Result<DailyTaskProgress, BusinessError>> {
  try {
    const targetDate = date || getTodayString();
    const profileRes = await deps.repo.getLearnerProfile(userId);
    if (!isOk(profileRes)) return profileRes;
    const profile = profileRes.value;
    const language: TrackLanguage = normalizeTrackLanguage(profile.targetLanguage) ?? 'ja';

    const rows = await deps.db
      .select()
      .from(studyActivityLogs)
      .where(
        and(
          eq(studyActivityLogs.userId, userId),
          eq(studyActivityLogs.activityDate, targetDate),
          eq(studyActivityLogs.language, language)
        )
      )
      .limit(1);

    if (rows.length === 0) {
      return ok({
        userId,
        activityDate: targetDate,
          language: language,
          quizzesCount: 0,
          dailyGoalQuizzes: profile.dailyGoalQuizzes,
          cardsReviewedCount: 0,
          dailyGoalCards: profile.dailyGoalCards,
          listeningMinutes: 0,
          mistakesResolvedCount: 0,
          readingCount: 0,
          isGoalCompleted: false,
          streakDays: profile.streakDays,
          intensityLevel: 0,
          isOvertimeBurst: false,
          completedAt: null,
      });
    }

    const log = rows[0]!;
    const isOvertime =
      log.quizzesCount >= profile.dailyGoalQuizzes * 1.5 ||
      (log.quizzesCount > profile.dailyGoalQuizzes &&
        log.cardsReviewedCount > profile.dailyGoalCards);

    return ok({
      userId: log.userId,
      activityDate: log.activityDate,
      language: language,
      quizzesCount: log.quizzesCount,
      dailyGoalQuizzes: profile.dailyGoalQuizzes,
      cardsReviewedCount: log.cardsReviewedCount,
      dailyGoalCards: profile.dailyGoalCards,
      listeningMinutes: log.listeningMinutes,
      mistakesResolvedCount: log.mistakesResolvedCount,
      readingCount: log.readingCount ?? 0,
      isGoalCompleted: Boolean(log.isGoalCompleted),
      streakDays: profile.streakDays,
      intensityLevel: log.intensityLevel,
      isOvertimeBurst: Boolean(log.isOvertimeBurst) || isOvertime,
      completedAt: log.completedAt,
    });
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'getDailyTaskProgress',
        entityId: userId,
      })
    );
  }
}

/**
 * 获取最近 N 天的学习活动历史足迹 (默认为 28 天，未打卡日期自动填充真实 0 值，绝不虚构数据)
 */
export async function getActivityHistory(
  deps: RepoDeps,
  userId: string,
  days: number = 28,
  targetLanguage?: TrackLanguage | string
): Promise<Result<DailyTaskProgress[], BusinessError>> {
  try {
    const profileRes = await deps.repo.getLearnerProfile(userId);
    if (!isOk(profileRes)) return profileRes;
    const profile = profileRes.value;
    const language: TrackLanguage = normalizeTrackLanguage(targetLanguage ?? profile.targetLanguage) ?? 'ja';

    const now = new Date();
    const dateList: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      dateList.push(d.toISOString().slice(0, 10));
    }

    const earliestDate = dateList[0]!;
    const latestDate = dateList[dateList.length - 1]!;

    const rows = await deps.db
      .select()
      .from(studyActivityLogs)
      .where(
        and(
          eq(studyActivityLogs.userId, userId),
          eq(studyActivityLogs.language, language),
          gte(studyActivityLogs.activityDate, earliestDate),
          lte(studyActivityLogs.activityDate, latestDate)
        )
      );

    const logMap = new Map<string, (typeof rows)[0]>();
    for (const r of rows) {
      logMap.set(r.activityDate, r);
    }

    const result: DailyTaskProgress[] = dateList.map((dateStr) => {
      const log = logMap.get(dateStr);
      if (!log) {
        return {
          userId,
          activityDate: dateStr,
          language: language,
          quizzesCount: 0,
          dailyGoalQuizzes: profile.dailyGoalQuizzes,
          cardsReviewedCount: 0,
          dailyGoalCards: profile.dailyGoalCards,
          listeningMinutes: 0,
          mistakesResolvedCount: 0,
          readingCount: 0,
          isGoalCompleted: false,
          streakDays: profile.streakDays,
          intensityLevel: 0,
          isOvertimeBurst: false,
          completedAt: null,
        };
      }
      return {
        userId: log.userId,
        activityDate: log.activityDate,
        language: language,
        quizzesCount: log.quizzesCount,
        dailyGoalQuizzes: profile.dailyGoalQuizzes,
        cardsReviewedCount: log.cardsReviewedCount,
        dailyGoalCards: profile.dailyGoalCards,
        listeningMinutes: log.listeningMinutes,
        mistakesResolvedCount: log.mistakesResolvedCount,
        readingCount: log.readingCount ?? 0,
        isGoalCompleted: Boolean(log.isGoalCompleted),
        streakDays: profile.streakDays,
        intensityLevel: log.intensityLevel,
        isOvertimeBurst: Boolean(log.isOvertimeBurst),
        completedAt: log.completedAt,
      };
    });

    return ok(result);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'getActivityHistory',
        entityId: userId,
      })
    );
  }
}

/**
 * 记录每日学情足迹并自适应核算打卡与连续天数（按当前语种分区）
 */
export async function recordDailyActivity(
  deps: RepoDeps,
  userId: string,
  delta: {
    quizzes?: number;
    cards?: number;
    listeningMinutes?: number;
    mistakesResolved?: number;
    reading?: number;
    /** v4：字母 drill 当日计数（kana/hangul 与 quizzes 分离统计） */
    kanaDrills?: number;
    hangulDrills?: number;
    date?: string;
    language?: TrackLanguage | string;
  }
): Promise<Result<DailyTaskProgress, BusinessError>> {
  try {
    const today = delta.date || getTodayString();
    const profileRes = await deps.repo.getLearnerProfile(userId);
    if (!isOk(profileRes)) return profileRes;
    let profile = profileRes.value;
    const language: TrackLanguage = normalizeTrackLanguage(delta.language ?? profile.targetLanguage) ?? 'ja';

    const existingLogs = await deps.db
      .select()
      .from(studyActivityLogs)
      .where(
        and(
          eq(studyActivityLogs.userId, userId),
          eq(studyActivityLogs.activityDate, today),
          eq(studyActivityLogs.language, language)
        )
      )
      .limit(1);

    const existing = existingLogs[0];
    const newQuizzes = (existing?.quizzesCount ?? 0) + (delta.quizzes ?? 0);
    const newCards = (existing?.cardsReviewedCount ?? 0) + (delta.cards ?? 0);
    const newListening = (existing?.listeningMinutes ?? 0) + (delta.listeningMinutes ?? 0);
    const newMistakes = (existing?.mistakesResolvedCount ?? 0) + (delta.mistakesResolved ?? 0);
    const newReading = (existing?.readingCount ?? 0) + (delta.reading ?? 0);
    const newKana = (existing?.kanaCount ?? 0) + (delta.kanaDrills ?? 0);
    const newHangul = (existing?.hangulCount ?? 0) + (delta.hangulDrills ?? 0);

    const wasCompleted = Boolean(existing?.isGoalCompleted);
    const isCompleted =
      newQuizzes >= profile.dailyGoalQuizzes && newCards >= profile.dailyGoalCards;

    const quizRatio = newQuizzes / Math.max(profile.dailyGoalQuizzes, 1);
    const cardRatio = newCards / Math.max(profile.dailyGoalCards, 1);
    const avgRatio = (quizRatio + cardRatio) / 2;

    let intensity = 0;
    if (avgRatio >= 1.5) intensity = 4;
    else if (avgRatio >= 1.0) intensity = 3;
    else if (avgRatio >= 0.5) intensity = 2;
    else if (avgRatio > 0) intensity = 1;

    const isBurst = avgRatio >= 1.5 || (quizRatio >= 2.0 && cardRatio >= 1.0);

    let completedAt = existing?.completedAt ?? null;
    let updatedStreak = profile.streakDays;
    let updatedMaxStreak = profile.maxStreakDays;

    const langRow = await ensureLanguageProfile(deps, userId, language, profile);
    const nextTotals = {
      totalQuizzesAnswered: langRow.totalQuizzesAnswered + (delta.quizzes ?? 0),
      totalCardsReviewed: langRow.totalCardsReviewed + (delta.cards ?? 0),
      totalStudyMinutes: langRow.totalStudyMinutes + (delta.listeningMinutes ?? 0),
    };

    if (!wasCompleted && isCompleted) {
      completedAt = nowIso();
      const yesterday = getYesterdayString(today);

      if (langRow.lastActiveDate === yesterday) {
        updatedStreak += 1;
      } else if (langRow.lastActiveDate !== today) {
        updatedStreak = 1;
      }
      updatedMaxStreak = Math.max(updatedMaxStreak, updatedStreak);

      await deps.db
        .update(learnerLanguageProfiles)
        .set({
          streakDays: updatedStreak,
          maxStreakDays: updatedMaxStreak,
          lastActiveDate: today,
          ...nextTotals,
          updatedAt: nowIso(),
        })
        .where(
          and(
            eq(learnerLanguageProfiles.userId, userId),
            eq(learnerLanguageProfiles.language, language)
          )
        );
    } else {
      await deps.db
        .update(learnerLanguageProfiles)
        .set({
          ...nextTotals,
          updatedAt: nowIso(),
        })
        .where(
          and(
            eq(learnerLanguageProfiles.userId, userId),
            eq(learnerLanguageProfiles.language, language)
          )
        );
    }

    const refreshedLang = await deps.db
      .select()
      .from(learnerLanguageProfiles)
      .where(
        and(
          eq(learnerLanguageProfiles.userId, userId),
          eq(learnerLanguageProfiles.language, language)
        )
      )
      .limit(1);
    if (refreshedLang[0] && normalizeTrackLanguage(profile.targetLanguage) === language) {
      await mirrorLanguageProfileToMain(deps, userId, language, refreshedLang[0]);
    }

    const logId = existing?.id ?? generateId('act');
    if (existing) {
      await deps.db
        .update(studyActivityLogs)
        .set({
          quizzesCount: newQuizzes,
          cardsReviewedCount: newCards,
          listeningMinutes: newListening,
          mistakesResolvedCount: newMistakes,
          readingCount: newReading,
          kanaCount: newKana,
          hangulCount: newHangul,
          isGoalCompleted: isCompleted,
          intensityLevel: intensity,
          isOvertimeBurst: isBurst,
          completedAt,
        })
        .where(eq(studyActivityLogs.id, existing.id));
    } else {
      await deps.db.insert(studyActivityLogs).values({
        id: logId,
        userId,
        activityDate: today,
        language,
        quizzesCount: newQuizzes,
        cardsReviewedCount: newCards,
        listeningMinutes: newListening,
        mistakesResolvedCount: newMistakes,
        readingCount: newReading,
        kanaCount: newKana,
        hangulCount: newHangul,
        isGoalCompleted: isCompleted,
        intensityLevel: intensity,
        isOvertimeBurst: isBurst,
        completedAt,
      });
    }

    return ok({
      userId,
      activityDate: today,
      language: language,
      quizzesCount: newQuizzes,
      dailyGoalQuizzes: profile.dailyGoalQuizzes,
      cardsReviewedCount: newCards,
      dailyGoalCards: profile.dailyGoalCards,
      listeningMinutes: newListening,
      mistakesResolvedCount: newMistakes,
      readingCount: newReading,
      isGoalCompleted: isCompleted,
      streakDays: updatedStreak,
      intensityLevel: intensity,
      isOvertimeBurst: isBurst,
      completedAt,
    });
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'recordDailyActivity',
        entityId: userId,
      })
    );
  }
}

export async function getOrCreateDailyStudyPlan(
  deps: RepoDeps,
  userId: string,
  date?: string
): Promise<Result<DailyStudyPlan, BusinessError>> {
  try {
    return await hydrateDailyStudyPlan(deps, userId, date);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'getOrCreateDailyStudyPlan',
        entityId: userId,
      })
    );
  }
}

export async function completeDailyPlanStep(
  deps: RepoDeps,
  userId: string,
  stepId: string,
  date?: string
): Promise<Result<DailyStudyPlan, BusinessError>> {
  try {
    const planRes = await hydrateDailyStudyPlan(deps, userId, date);
    if (!isOk(planRes)) return planRes;
    const plan = planRes.value;
    if (!plan.steps.some((step) => step.id === stepId)) {
      return err(
        new BusinessError('E_INVALID_INPUT', '当日计划中没有这一步，请刷新后重试。', 'VALIDATION')
      );
    }

    const rows = await deps.db
      .select()
      .from(dailyStudyPlans)
      .where(eq(dailyStudyPlans.id, plan.id))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return err(
        new BusinessError('E_NOT_FOUND', '找不到今日学习计划，请刷新后重试。', 'LEARNER_STATE')
      );
    }

    let completedIds = parseCompletedStepIds(safeJsonParse(row.completedStepIdsJson));
    if (!completedIds.includes(stepId)) {
      completedIds = [...completedIds, stepId];
      await deps.db
        .update(dailyStudyPlans)
        .set({ completedStepIdsJson: JSON.stringify(completedIds) })
        .where(eq(dailyStudyPlans.id, plan.id));
    }

    return hydrateDailyStudyPlan(deps, userId, plan.planDate);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'completeDailyPlanStep',
        entityId: stepId,
      })
    );
  }
}

/**
 * P5-E3：聚合练习计划 run 进度信号。
 * - 存在活跃 run（IN_PROGRESS/GRADING）：返回冻结块总题量与已提交题数，今日计划显示可点击步骤；
 * - 无活跃 run 但当日有已完成 run：返回 1/1 使步骤呈现完成态；
 * - 其余情况返回 undefined（不出步骤）。信号失败静默降级，不影响计划主路径。
 */
export async function getPracticePlanRunSignal(
  deps: RepoDeps,
  userId: string,
  language: TrackLanguage,
  targetDate: string
): Promise<{ submittedItems: number; totalItems: number } | undefined> {
  try {
    const activeRows = await deps.db
      .select()
      .from(practicePlanRuns)
      .where(
        and(
          eq(practicePlanRuns.userId, userId),
          eq(practicePlanRuns.language, language),
          inArray(practicePlanRuns.status, ['IN_PROGRESS', 'GRADING'])
        )
      )
      .orderBy(desc(practicePlanRuns.startedAt))
      .limit(1);
    const active = activeRows[0];
    if (active) {
      const blocks = parsePracticeBlockSpecs(safeJsonParse(active.blocksJson));
      const totalItems = (blocks ?? []).reduce((sum, b) => sum + b.count, 0);
      const submittedRows = await deps.db
        .select({ itemId: practiceItemAttempts.itemId })
        .from(practiceItemAttempts)
        .where(
          and(
            eq(practiceItemAttempts.runId, active.id),
            inArray(practiceItemAttempts.status, ['SUBMITTED', 'GRADED'])
          )
        );
      const submittedItems = new Set(submittedRows.map((r) => r.itemId)).size;
      return { totalItems: Math.max(1, totalItems), submittedItems };
    }
    const completedRows = await deps.db
      .select({ id: practicePlanRuns.id })
      .from(practicePlanRuns)
      .where(
        and(
          eq(practicePlanRuns.userId, userId),
          eq(practicePlanRuns.language, language),
          eq(practicePlanRuns.status, 'COMPLETED'),
          like(practicePlanRuns.completedAt, `${targetDate}%`)
        )
      )
      .limit(1);
    if (completedRows.length > 0) return { submittedItems: 1, totalItems: 1 };
    return undefined;
  } catch {
    // 信号为辅助路径：聚合失败时退回「不显示练习计划步骤」，不打断今日计划
    return undefined;
  }
}

export async function hydrateDailyStudyPlan(
  deps: RepoDeps,
  userId: string,
  date?: string
): Promise<Result<DailyStudyPlan, BusinessError>> {
  const targetDate = date || getTodayString();
  const profileRes = await deps.repo.getLearnerProfile(userId);
  if (!isOk(profileRes)) return profileRes;
  const profile = profileRes.value;
  const language = normalizeTrackLanguage(profile.targetLanguage);

  const [dueRes, mistakesRes, snapshotRes, progressRes] = await Promise.all([
    deps.repo.getDueCards(userId, 200, { dueOnly: true, language }),
    deps.repo.getMistakes(userId, { resolved: false, language }),
    deps.repo.getProfileSnapshot(userId, language),
    deps.repo.getDailyTaskProgress(userId, targetDate),
  ]);
  if (!isOk(dueRes)) return dueRes;
  if (!isOk(mistakesRes)) return mistakesRes;
  if (!isOk(snapshotRes)) return snapshotRes;
  if (!isOk(progressRes)) return progressRes;

  const topWeakness = snapshotRes.value.weaknesses[0];
  // 教材焦点：最近读到的教材课次（计划 READING 步点名跟读；失败/无记录不挡计划）。
  // 经 repo 外观调用（跨域走接口，不直引 library 域实现；接口缺实现时保持通用精读）。
  let textbookFocus: { bookTitle: string; lessonTitle: string; lessonNumber: number; displayTitle: string | null } | undefined;
  try {
    const focusRes = await deps.repo.getTextbookFocus?.(userId, language);
    if (focusRes && isOk(focusRes) && focusRes.value) {
      const f = focusRes.value;
      textbookFocus = { bookTitle: f.bookTitle, lessonTitle: f.lessonTitle, lessonNumber: f.lessonNumber, displayTitle: f.displayTitle };
    }
  } catch {
    textbookFocus = undefined;
  }
  // 课程路线：取前 3 个可学单元置顶为计划步（长期路线不随每日重置；
  // 路由失败/无可用单元时回退纯通用计划，不挡主路径）。
  let unitSteps: DailyPlanStepTemplate[] | undefined;
  try {
    const routeRes = await deps.repo.getCourseRoute?.(userId, language);
    if (routeRes && isOk(routeRes)) {
      const avail = routeRes.value.units.filter((u) => u.status === 'available').slice(0, 3);
      if (avail.length > 0) {
        unitSteps = avail.map((u) => ({
          id: `step_unit_${u.unit.id}`,
          kind: u.unit.activity.planKind,
          title: u.unit.title,
          summary: `${u.unit.summary}（进度 ${u.progress}）`,
          navigateTo: u.unit.activity.navigateTo,
          ...(u.unit.activity.skillId ? { skillId: u.unit.activity.skillId } : {}),
          ...(u.unit.activity.skillName ? { skillName: u.unit.activity.skillName } : {}),
          ...(typeof u.unit.activity.targetCount === 'number'
            ? { targetCount: u.unit.activity.targetCount }
            : {}),
        }));
      }
    }
  } catch {
    unitSteps = undefined;
  }
  const signals = {
    track: language,
    learnerLevel: profile.learnerLevel,
    dailyGoalQuizzes: profile.dailyGoalQuizzes,
    dailyGoalCards: profile.dailyGoalCards,
    dueCardsCount: dueRes.value.length,
    unresolvedMistakesCount: mistakesRes.value.length,
    // 基础阶段由画像阶段决定，练习总次数不能证明字母覆盖或掌握。
    alphabetReady: profile.learnerLevel !== 'NOVICE',
    ...(topWeakness ? { topWeakness: { skillId: topWeakness.id, name: topWeakness.name } } : {}),
    ...(textbookFocus ? { textbookFocus } : {}),
    ...(unitSteps ? { unitSteps } : {}),
  };

  // P5-E3：练习计划 run 进度信号（活跃 run 或当日完成 run 才存在）
  const practiceSignal = await getPracticePlanRunSignal(deps, userId, language, targetDate);

  const existingRows = await deps.db
    .select()
    .from(dailyStudyPlans)
    .where(
      and(
        eq(dailyStudyPlans.userId, userId),
        eq(dailyStudyPlans.language, language),
        eq(dailyStudyPlans.planDate, targetDate)
      )
    )
    .limit(1);

  let planId: string;
  let createdAt: string;
  let templates: DailyPlanStepTemplate[];
  let completedStepIds: string[];

  const existing = existingRows[0];
  const parsedTemplates = existing
    ? parseDailyPlanStepTemplates(safeJsonParse(existing.stepsJson))
    : null;

  if (existing && parsedTemplates && !parsedTemplates.some((s) => s.trailStageId) &&
      !(profile.learnerLevel === 'NOVICE' && parsedTemplates.some((s) => s.kind === 'READING' || s.kind === 'QUIZ' || s.kind === 'GRAMMAR'))) {
    planId = existing.id;
    createdAt = existing.createdAt;
    templates = parsedTemplates;
    completedStepIds = parseCompletedStepIds(safeJsonParse(existing.completedStepIdsJson));
    // P5-E3：run 晚于冻结模板创建时，幂等追加练习计划步骤并持久化（只追加、不改序）
    if (practiceSignal && !templates.some((s) => s.id === PRACTICE_PLAN_STEP_ID)) {
      templates = appendPracticePlanStep(templates, practiceSignal.totalItems);
      await deps.db
        .update(dailyStudyPlans)
        .set({ stepsJson: JSON.stringify(templates) })
        .where(eq(dailyStudyPlans.id, existing.id));
    }
  } else {
    templates = buildDailyPlanStepTemplates(signals);
    if (practiceSignal) templates = appendPracticePlanStep(templates, practiceSignal.totalItems);
    planId = existing?.id ?? generateId('plan');
    createdAt = existing?.createdAt ?? nowIso();
    completedStepIds = existing
      ? parseCompletedStepIds(safeJsonParse(existing.completedStepIdsJson))
      : [];
    const payload = {
      id: planId,
      userId,
      language,
      planDate: targetDate,
      stepsJson: JSON.stringify(templates),
      completedStepIdsJson: JSON.stringify(completedStepIds),
      createdAt,
    };
    if (existing) {
      await deps.db
        .update(dailyStudyPlans)
        .set({
          stepsJson: payload.stepsJson,
          completedStepIdsJson: payload.completedStepIdsJson,
        })
        .where(eq(dailyStudyPlans.id, existing.id));
    } else {
      await deps.db.insert(dailyStudyPlans).values(payload);
    }
  }

  return ok(
    summarizeDailyStudyPlan(planId, userId, language, targetDate, createdAt, templates, {
      quizzesCount: progressRes.value.quizzesCount,
      cardsReviewedCount: progressRes.value.cardsReviewedCount,
      readingCount: progressRes.value.readingCount,
      mistakesResolvedCount: progressRes.value.mistakesResolvedCount,
      unresolvedMistakesCount: mistakesRes.value.length,
      completedStepIds,
      practicePlan: practiceSignal,
    })
  );
}
