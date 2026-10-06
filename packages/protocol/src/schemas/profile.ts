import { z } from 'zod';

export const StudyGoalSchema = z.enum([
  'JLPT_N5',
  'JLPT_N4',
  'JLPT_N3',
  'JLPT_N2',
  'JLPT_N1',
  'KAOYAN_EN',
  'CET4',
  'CET6',
  'DAILY_CONVERSATION',
  'INTEREST_BASIC',
  'TOPIK_I',
  'TOPIK_II',
]);
export type StudyGoal = z.infer<typeof StudyGoalSchema>;

export const LearnerLevelSchema = z.enum([
  'NOVICE',
  'BEGINNER',
  'INTERMEDIATE',
  'ADVANCED',
]);
export type LearnerLevel = z.infer<typeof LearnerLevelSchema>;

export const TargetLanguageSchema = z.enum(['ja', 'en', 'ko']);
export type TargetLanguageCode = z.infer<typeof TargetLanguageSchema>;

/** JLPT 等级集合（契约唯一定义；排序/门逻辑见 learner-core vocab-gate）。 */
export const JlptLevelSchema = z.enum(['N5', 'N4', 'N3', 'N2', 'N1']);
export type JlptLevel = z.infer<typeof JlptLevelSchema>;

/** 按目标语种隔离的学情档案 */
export const LearnerLanguageProfileSchema = z.object({
  userId: z.string(),
  language: TargetLanguageSchema,
  studyGoal: StudyGoalSchema,
  learnerLevel: LearnerLevelSchema,
  overallLevel: z.string(),
  overallProficiency: z.number().min(0).max(1),
  streakDays: z.number().int().min(0),
  maxStreakDays: z.number().int().min(0),
  lastActiveDate: z.string().nullable(),
  retentionRate: z.number().min(0).max(1),
  dailyGoalQuizzes: z.number().int().min(1),
  dailyGoalCards: z.number().int().min(1),
  dailyGoalNewWords: z.number().int().min(0).max(50),
  /** null = 按词汇门自动定级；非空 = 用户限定的等级集合 */
  wordLevelFilter: z.array(JlptLevelSchema).max(5).nullable(),
  totalStudyMinutes: z.number().int().min(0),
  totalCardsReviewed: z.number().int().min(0),
  totalQuizzesAnswered: z.number().int().min(0),
  updatedAt: z.string(),
});
export type LearnerLanguageProfile = z.infer<typeof LearnerLanguageProfileSchema>;

export const LearnerProfileSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  targetLanguage: TargetLanguageSchema,
  studyGoal: StudyGoalSchema,
  learnerLevel: LearnerLevelSchema,
  overallLevel: z.string(),
  overallProficiency: z.number().min(0).max(1),
  streakDays: z.number().int().min(0),
  maxStreakDays: z.number().int().min(0),
  lastActiveDate: z.string().nullable(),
  retentionRate: z.number().min(0).max(1),
  dailyGoalQuizzes: z.number().int().min(1),
  dailyGoalCards: z.number().int().min(1),
  dailyGoalNewWords: z.number().int().min(0).max(50),
  wordLevelFilter: z.array(JlptLevelSchema).max(5).nullable(),
  totalStudyMinutes: z.number().int().min(0),
  totalCardsReviewed: z.number().int().min(0),
  totalQuizzesAnswered: z.number().int().min(0),
  updatedAt: z.string(),
});
export type LearnerProfile = z.infer<typeof LearnerProfileSchema>;

export const UpdateLearnerProfileSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  targetLanguage: TargetLanguageSchema.optional(),
  studyGoal: StudyGoalSchema.optional(),
  learnerLevel: LearnerLevelSchema.optional(),
  dailyGoalQuizzes: z.number().int().min(1).max(100).optional(),
  dailyGoalCards: z.number().int().min(1).max(200).optional(),
  dailyGoalNewWords: z.number().int().min(0).max(50).optional(),
  wordLevelFilter: z.array(JlptLevelSchema).max(5).nullable().optional(),
});
export type UpdateLearnerProfileInput = z.infer<typeof UpdateLearnerProfileSchema>;

export const DailyTaskProgressSchema = z.object({
  userId: z.string(),
  activityDate: z.string(), // YYYY-MM-DD
  language: TargetLanguageSchema.default('en'),
  quizzesCount: z.number().int().min(0),
  dailyGoalQuizzes: z.number().int().min(1),
  cardsReviewedCount: z.number().int().min(0),
  dailyGoalCards: z.number().int().min(1),
  listeningMinutes: z.number().int().min(0),
  mistakesResolvedCount: z.number().int().min(0),
  readingCount: z.number().int().min(0).default(0),
  isGoalCompleted: z.boolean(),
  streakDays: z.number().int().min(0),
  intensityLevel: z.number().int().min(0).max(4),
  isOvertimeBurst: z.boolean(),
  completedAt: z.string().nullable(),
});
export type DailyTaskProgress = z.infer<typeof DailyTaskProgressSchema>;

export const RecordDailyActivitySchema = z.object({
  userId: z.string(),
  quizzes: z.number().int().min(0).optional(),
  cards: z.number().int().min(0).optional(),
  listeningMinutes: z.number().int().min(0).optional(),
  mistakesResolved: z.number().int().min(0).optional(),
  reading: z.number().int().min(0).optional(),
  date: z.string().optional(),
  language: TargetLanguageSchema.optional(),
});
export type RecordDailyActivityInput = z.infer<typeof RecordDailyActivitySchema>;
