import type { LearnerLevel } from '@lexdistill/protocol';

export const LEVEL_ORDER: LearnerLevel[] = ['NOVICE', 'BEGINNER', 'INTERMEDIATE', 'ADVANCED'];

export const LEVEL_LABELS: Record<LearnerLevel, string> = {
  NOVICE: '入门',
  BEGINNER: '初级',
  INTERMEDIATE: '中级',
  ADVANCED: '高级',
};

/** 现有测评初始规则；不是标准化语言能力认证。 */
export const LEVEL_THRESHOLDS = { examPass: 0.8, examAlphabetQuestions: 15, examVocabQuestions: 20 } as const;

export interface LevelQuizDay {
  date: string;
  correct: number;
  total: number;
}

export interface LevelEvalInput {
  track: 'ja' | 'en' | 'ko';
  currentLevel: LearnerLevel;
  /** 字母练习证据（ja/ko；en 传 null），不用于自动升级。 */
  alphabet: { accuracy: number; attempts: number } | null;
  /** 收藏总数仅作活动信息，不作掌握证据。 */
  collectedCount: number;
  /** 按天做题（90 天内即可，取最近活跃日）。 */
  quizDays: LevelQuizDay[];
  /** 兼容旧调用方的考试信息；日常活动始终不改变等级。 */
  examPassToday: boolean;
}

export interface LevelEvalResult {
  newLevel: LearnerLevel;
  changed: boolean;
  direction: 'up' | 'down' | 'none';
  reason: string;
}

function levelIndex(level: LearnerLevel): number {
  const i = LEVEL_ORDER.indexOf(level);
  return i < 0 ? 0 : i;
}

/** 活动量不是晋级证据；阶段变更由 Gateway 测评交卷命令持久化。 */
export function evaluateLevelTransition(input: LevelEvalInput): LevelEvalResult {
  return { newLevel: input.currentLevel, changed: false, direction: 'none', reason: '阶段资格保留；通过阶段测评后升级' };
}
export function levelProgressHint(input: LevelEvalInput): string {
  if (input.currentLevel === 'ADVANCED') return '高级阶段 · 按薄弱能力继续学习与复习';
  const next = LEVEL_ORDER[levelIndex(input.currentLevel) + 1]!;
  return '通过' + LEVEL_LABELS[next] + '阶段测评后升级；收藏与练习次数不代表掌握';
}
