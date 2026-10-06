export type TargetLanguage = 'ja' | 'en' | 'ko';

import type { JlptLevel } from '@study-studio/protocol';
export type { JlptLevel };

export type StudyGoal =
  | 'JLPT_N5'
  | 'JLPT_N4'
  | 'JLPT_N3'
  | 'JLPT_N2'
  | 'JLPT_N1'
  | 'KAOYAN_EN'
  | 'CET4'
  | 'CET6'
  | 'DAILY_CONVERSATION'
  | 'INTEREST_BASIC'
  | 'TOPIK_I'
  | 'TOPIK_II';

export type LearnerLevel = 'NOVICE' | 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';

export type SkillDimension =
  | 'VOCABULARY'
  | 'GRAMMAR'
  | 'LISTENING'
  | 'NUANCE_PRAGMATIC'
  | 'READING';

export type SkillStatus = 'STRENGTH' | 'NORMAL' | 'WEAKNESS';

export interface SkillMetric {
  id: string;                      // 如 'jp.particle.ni_vs_de'
  dimension: SkillDimension;
  name: string;                    // 如 '助词「に」与「对」的场所功能区分'
  proficiency: number;             // 0.00 ~ 1.00
  totalAttempts: number;
  correctAttempts: number;
  consecutiveErrors: number;
  status: SkillStatus;
  lastPracticedAt?: string | undefined;
}

export interface LearnerProfile {
  userId: string;
  displayName: string;
  targetLanguage: TargetLanguage;
  studyGoal: StudyGoal;
  learnerLevel: LearnerLevel;
  overallLevel: string;
  overallProficiency: number;
  streakDays: number;
  maxStreakDays: number;
  lastActiveDate: string | null;
  retentionRate: number;
  dailyGoalQuizzes: number;
  dailyGoalCards: number;
  /** 每日新词数（与 protocol LearnerProfileSchema 同步扩展） */
  dailyGoalNewWords: number;
  /** 用户限定的 JLPT 集合；null = 按词汇门自动定级（与 protocol 同步扩展） */
  wordLevelFilter: JlptLevel[] | null;
  totalStudyMinutes: number;
  totalCardsReviewed: number;
  totalQuizzesAnswered: number;
  updatedAt: string;
}

export interface DailyTaskProgress {
  userId: string;
  activityDate: string;            // 'YYYY-MM-DD'
  /** 当前打卡所属目标语种轨道 */
  language: TargetLanguage;
  quizzesCount: number;
  dailyGoalQuizzes: number;
  cardsReviewedCount: number;
  dailyGoalCards: number;
  listeningMinutes: number;
  mistakesResolvedCount: number;
  /** 当日完成的阅读篇目数（与 quizzesCount 分离，避免精读把自适应做题步骤一并勾掉） */
  readingCount: number;
  isGoalCompleted: boolean;
  streakDays: number;
  intensityLevel: number;          // 0~4
  isOvertimeBurst: boolean;        // 用户状态极佳超额连刷
  completedAt: string | null;
}

export interface LearnerProfileSnapshot {
  userId: string;
  profile?: LearnerProfile | undefined;
  targetLanguage: TargetLanguage;
  overallLevel: string;
  strengths: SkillMetric[];
  weaknesses: SkillMetric[];
  allMetrics: SkillMetric[];
  dailyTask?: DailyTaskProgress | undefined;
  updatedAt: string;
}
