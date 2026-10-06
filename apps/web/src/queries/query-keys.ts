import type { useQueryClient } from '@tanstack/react-query';

/** P1-2 拆分：查询键与默认用户集中于此，useLearnerQueries.ts 改为 barrel 转出。 */

export const DEFAULT_USER_ID = 'student_web_01';

export const QUERY_KEYS = {
  TEXTBOOKS: ['learner', 'textbooks'] as const,
  DOCUMENTS: ['learner', 'documents'] as const,
  ANNOTATIONS: ['learner', 'annotations'] as const,
  KANA: ['curriculum', 'kana'] as const,
  KANA_ADAPTIVE: ['curriculum', 'kana', 'adaptive'] as const,
  HANGUL: ['curriculum', 'hangul'] as const,
  TRAIL: ['learner', 'trail'] as const,
  READING: ['learner', 'reading'] as const,
  NEWS_TOPICS: ['learner', 'newsTopics'] as const,
  PITCH: ['curriculum', 'pitch'] as const,
  DICTIONARY: ['learner', 'dictionary'] as const,
  PROFILE: ['learner', 'profile'] as const,
  MISTAKES: ['learner', 'mistakes'] as const,
  QUESTIONS: ['learner', 'questions'] as const,
  CARDS: ['learner', 'cards'] as const,
  VOCABULARY: ['learner', 'vocabulary'] as const,
  DRAFTS: ['learner', 'drafts'] as const,
  PRACTICE_COLLECTIONS: ['learner', 'practiceCollections'] as const,
  PRACTICE_ITEMS: ['learner', 'practiceItems'] as const,
  DAILY_TASK: ['learner', 'dailyTask'] as const,
  DAILY_PLAN: ['learner', 'dailyPlan'] as const,
  LEARNING_ANALYSIS: ['learner', 'analysis'] as const,
  ACTIVITY_HISTORY: ['learner', 'activityHistory'] as const,
  PRACTICE_TEMPLATES: ['learner', 'practiceTemplates'] as const,
  PRACTICE_RUN: ['learner', 'practiceRun'] as const,
  LESSONS: ['curriculum', 'lessons'] as const,
  WORDLISTS: ['learner', 'wordlists'] as const,
};

/**
 * 集中失效全部学习域 Query（在切换轨道或批量更新后使用）
 */
export async function invalidateAllLearningQueries(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.PROFILE }),
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.QUESTIONS }),
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.CARDS }),
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.MISTAKES }),
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.READING }),
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.KANA_ADAPTIVE }),
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ACTIVITY_HISTORY }),
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.DAILY_TASK }),
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.DAILY_PLAN }),
  ]);
}
