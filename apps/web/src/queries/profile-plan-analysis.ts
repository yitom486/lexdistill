import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DailyStudyPlan, DailyTaskProgress, SkillMetric } from '@study-studio/learner-core';
import type { LearningAnalysisReport } from '@study-studio/protocol';
import { logger } from '@study-studio/shared';
import { GATEWAY_BASE_URL } from '../lib/api-client.js';
import { DEFAULT_USER_ID, QUERY_KEYS } from './query-keys.js';
import { useUserProfileStore } from '../stores/useUserProfileStore.js';
import { normalizeTrackLanguage } from '../learning/learning-shell.js';

/** P1-2 拆分：画像 / 计划 / 分析组（自 useLearnerQueries.ts 逐行平移，仅改 import）。 */

/**
 * 学习者技能画像雷达指标查询 (依托 Hono RPC / Gateway，带语种作用域隔离)
 */
export function useLearnerProfileQuery(userId = DEFAULT_USER_ID, langOverride?: string) {
  const profileLang = useUserProfileStore((s) => s.profile.targetLanguage);
  const targetLanguage = normalizeTrackLanguage(langOverride || profileLang);

  return useQuery<SkillMetric[]>({
    queryKey: [...QUERY_KEYS.PROFILE, userId, targetLanguage],
    queryFn: async () => {
      try {
        const url = `${GATEWAY_BASE_URL}/api/profile/${userId}?lang=${targetLanguage}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if ('allMetrics' in data && Array.isArray(data.allMetrics)) {
            return data.allMetrics as SkillMetric[];
          }
        }
      } catch (e) {
        logger.debug('[useLearnerProfileQuery] failed to load profile', e);
      }
      return [];
    },
    staleTime: 1000 * 60 * 2,
  });
}

/**
 * 学习者每日打卡与足迹进度查询 (实时 SQLite 同步，带语种作用域)
 */
export function useDailyTaskQuery(userId = DEFAULT_USER_ID, date?: string, langOverride?: string) {
  const profileLang = useUserProfileStore((s) => s.profile.targetLanguage);
  const targetLanguage = normalizeTrackLanguage(langOverride || profileLang);

  return useQuery<DailyTaskProgress | null>({
    queryKey: [...QUERY_KEYS.DAILY_TASK, userId, date ?? 'today', targetLanguage],
    queryFn: async () => {
      try {
        const url = new URL(`${GATEWAY_BASE_URL}/api/task/progress/${userId}`);
        if (date) url.searchParams.set('date', date);
        url.searchParams.set('lang', targetLanguage);
        const res = await fetch(url.toString());
        if (res.ok) {
          return (await res.json()) as DailyTaskProgress;
        }
      } catch (e) {
        logger.debug('[useDailyTaskQuery] Failed to load daily task progress', e);
      }
      return null;
    },
    staleTime: 1000 * 30,
  });
}

export function useDailyPlanQuery(userId = DEFAULT_USER_ID, date?: string, langOverride?: string) {
  const profileLang = useUserProfileStore((s) => s.profile.targetLanguage);
  const targetLanguage = normalizeTrackLanguage(langOverride || profileLang);

  return useQuery<DailyStudyPlan | null>({
    queryKey: [...QUERY_KEYS.DAILY_PLAN, userId, date ?? 'today', targetLanguage],
    queryFn: async () => {
      try {
        const url = new URL(`${GATEWAY_BASE_URL}/api/learning/plan/${userId}`);
        url.searchParams.set('lang', targetLanguage);
        if (date) url.searchParams.set('date', date);
        const res = await fetch(url.toString());
        if (res.ok) {
          return (await res.json()) as DailyStudyPlan;
        }
      } catch (e) {
        logger.debug('[useDailyPlanQuery] Failed to load daily study plan', e);
      }
      return null;
    },
    staleTime: 1000 * 30,
  });
}

export interface CourseRouteUnit {
  unit: {
    id: string;
    track: string;
    stage: number;
    order: number;
    kind: string;
    title: string;
    summary: string;
    activity: {
      planKind: string;
      navigateTo: string;
      skillId?: string;
      skillName?: string;
      targetCount?: number;
    };
  };
  status: 'locked' | 'available' | 'mastered';
  progress: string;
  needsReview?: boolean;
}

export interface CourseRoute {
  units: CourseRouteUnit[];
  nextUpId: string | null;
}

const STAGE_NAMES: Record<number, string> = { 0: '零基础', 1: '初学者', 2: '中级', 3: '高级' };

export function courseStageName(stage: number): string {
  return STAGE_NAMES[stage] ?? `阶段${stage}`;
}

/** 课程路线（长期路线 + 解锁态；失败返回 null，调用方隐藏横幅）。 */
export function useCourseRouteQuery(userId = DEFAULT_USER_ID, langOverride?: string) {
  const profileLang = useUserProfileStore((s) => s.profile.targetLanguage);
  const targetLanguage = normalizeTrackLanguage(langOverride || profileLang);
  return useQuery<CourseRoute | null>({
    queryKey: [...QUERY_KEYS.PROFILE, userId, targetLanguage, 'course-route'],
    queryFn: async () => {
      try {
        const res = await fetch(
          `${GATEWAY_BASE_URL}/api/course-route/${encodeURIComponent(userId)}?lang=${targetLanguage}`
        );
        if (!res.ok) return null;
        const data: unknown = await res.json().catch(() => null);
        const rec = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
        if (!Array.isArray(rec.units)) return null;
        return {
          units: rec.units as CourseRouteUnit[],
          nextUpId: typeof rec.nextUpId === 'string' ? rec.nextUpId : null,
        };
      } catch (e) {
        logger.debug('[useCourseRouteQuery] Failed to load course route', e);
      }
      return null;
    },
    staleTime: 1000 * 60,
  });
}

export function useCompletePlanStepMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();
  const language = normalizeTrackLanguage(useUserProfileStore(s => s.profile.targetLanguage));

  return useMutation({
    mutationFn: async (payload: { stepId: string; date?: string }) => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/learning/plan/${userId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, language }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { userMessage?: string };
        } | null;
        throw new Error(body?.error?.userMessage ?? '暂时无法标记该步骤，请稍后重试。');
      }
      return (await res.json()) as DailyStudyPlan;
    },
    onSuccess: (plan) => {
      queryClient.setQueryData(
        [...QUERY_KEYS.DAILY_PLAN, userId, 'today', plan.language],
        plan
      );
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.DAILY_PLAN });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.DAILY_TASK });
    },
  });
}

/**
 * P4-C：AI 学习分析查询。
 * 模型不可用时 Gateway 回退上次可信分析或本地规则建议，前端始终拿到一份报告。
 * 做题/闪卡评分/错题攻克后失效该查询，触发重算。
 */
export function useLearningAnalysisQuery(userId = DEFAULT_USER_ID, langOverride?: string) {
  const profileLang = useUserProfileStore((s) => s.profile.targetLanguage);
  const targetLanguage = normalizeTrackLanguage(langOverride || profileLang);

  return useQuery<LearningAnalysisReport | null>({
    queryKey: [...QUERY_KEYS.LEARNING_ANALYSIS, userId, targetLanguage],
    queryFn: async () => {
      try {
        const res = await fetch(`${GATEWAY_BASE_URL}/api/learning/analysis/${userId}`);
        if (res.ok) {
          return (await res.json()) as LearningAnalysisReport;
        }
      } catch (e) {
        logger.debug('[useLearningAnalysisQuery] Failed to load learning analysis', e);
      }
      return null;
    },
    staleTime: 1000 * 60 * 10,
  });
}

/** 强制刷新分析（带 refresh=1 重新请求模型）。 */
export function useRefreshLearningAnalysisMutation(userId = DEFAULT_USER_ID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`${GATEWAY_BASE_URL}/api/learning/analysis/${userId}?refresh=1`);
      if (!res.ok) throw new Error('刷新分析失败，请稍后重试。');
      return (await res.json()) as LearningAnalysisReport;
    },
    onSuccess: (report) => {
      queryClient.setQueryData([...QUERY_KEYS.LEARNING_ANALYSIS, userId, report.language], report);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.LEARNING_ANALYSIS });
    },
  });
}

/**
 * 学习者历史足迹打卡热力图查询 (真实 SQLite 数据源)
 */
export function useActivityHistoryQuery(
  days = 28,
  userId = DEFAULT_USER_ID,
  targetLanguage?: string
) {
  return useQuery<DailyTaskProgress[]>({
    queryKey: [...QUERY_KEYS.ACTIVITY_HISTORY, userId, days, targetLanguage ?? 'all'],
    queryFn: async () => {
      try {
        const url = new URL(`${GATEWAY_BASE_URL}/api/task/history/${userId}`);
        url.searchParams.set('days', String(days));
        if (targetLanguage) url.searchParams.set('lang', targetLanguage);
        const res = await fetch(url.toString());
        if (res.ok) {
          const list = (await res.json()) as DailyTaskProgress[];
          if (Array.isArray(list)) return list;
        }
      } catch (e) {
        logger.debug('[useActivityHistoryQuery] Failed to load activity history', e);
      }
      return [];
    },
    staleTime: 1000 * 30,
  });
}

/** 新手带路阶段状态（与网关 trail 域同源，tab 均为合法 NavigationTab 子集）。 */
export interface TrailStageStatus {
  id: string;
  day: string;
  title: string;
  hint: string;
  tab: 'KANA' | 'HANGUL' | 'CARDS' | 'QUIZ' | 'READING';
  progress: number;
  done: boolean;
  locked: boolean;
  current: boolean;
  criterion: { kind: 'kana' | 'hangul' | 'cards' | 'quiz' | 'reading'; goal: number };
}

export interface BeginnerTrail {
  track: string;
  complete: boolean;
  stages: TrailStageStatus[];
}

/**
 * 新手带路进度查询：零基础分阶段清单，全部走完后前端隐藏带路卡。
 * 失败/空时返回 null（不挡今日计划主路径）。
 */
export function useBeginnerTrailQuery(userId = DEFAULT_USER_ID, langOverride?: string) {
  const profileLang = useUserProfileStore((s) => s.profile.targetLanguage);
  const targetLanguage = normalizeTrackLanguage(langOverride || profileLang);

  return useQuery<BeginnerTrail | null>({
    queryKey: [...QUERY_KEYS.TRAIL, userId, targetLanguage],
    queryFn: async () => {
      try {
        const url = new URL(`${GATEWAY_BASE_URL}/api/trail/${userId}`);
        url.searchParams.set('track', targetLanguage);
        const res = await fetch(url.toString());
        if (res.ok) {
          const data = (await res.json()) as BeginnerTrail;
          if (data && Array.isArray(data.stages)) return data;
        }
      } catch (e) {
        logger.debug('[useBeginnerTrailQuery] Failed to load beginner trail', e);
      }
      return null;
    },
    staleTime: 1000 * 30,
  });
}

export type LevelInfo = {
  level: 'NOVICE' | 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  hint: string;
};

/** 档位信息（当前档 + 升级提示语；做题/字母落盘后网关自动升降级）。 */
export function useLevelInfoQuery(userId = DEFAULT_USER_ID, langOverride?: string) {  const profileLang = useUserProfileStore((s) => s.profile.targetLanguage);
  const targetLanguage = normalizeTrackLanguage(langOverride || profileLang);
  return useQuery<LevelInfo | null>({
    queryKey: [...QUERY_KEYS.PROFILE, userId, targetLanguage, 'level'],
    queryFn: async () => {
      try {
        const res = await fetch(
          `${GATEWAY_BASE_URL}/api/level/${encodeURIComponent(userId)}?lang=${targetLanguage}`
        );
        if (!res.ok) return null;
        const data: unknown = await res.json().catch(() => null);
        const rec = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
        if (
          (rec.level === 'NOVICE' ||
            rec.level === 'BEGINNER' ||
            rec.level === 'INTERMEDIATE' ||
            rec.level === 'ADVANCED') &&
          typeof rec.hint === 'string'
        ) {
          return { level: rec.level, hint: rec.hint };
        }
      } catch (e) {
        logger.debug('[useLevelInfoQuery] Failed to load level info', e);
      }
      return null;
    },
    staleTime: 1000 * 30,
  });
}
