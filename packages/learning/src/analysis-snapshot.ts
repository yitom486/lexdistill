import { ok, isOk, type Result, type BusinessError } from '@lexdistill/shared';
import {
  summarizeLearningEvidence,
  type LearnerProfileSnapshot,
  type TargetLanguage,
} from '@lexdistill/learner-core';

/**
 * M7-10 自 Gateway `learning-progress/application/learning-analysis.ts` 与
 * ai-content 迁入快照组装用例（映射逻辑字节一致）。
 *
 * AnalysisSnapshot 正典归属本包（学习域快照）；ai-content 只重出类型、
 * 消费快照做内容规则，不反向依赖（禁循环）。
 * `assembledAt` 由调用方传入，本包不读时钟；底层异常翻译留给 Gateway。
 */

export interface AnalysisSnapshot {
  practiceEvidence?: ReturnType<typeof summarizeLearningEvidence>;
  userId: string;
  targetLanguage: string;
  overallLevel: string;
  learnerLevel?: string | undefined;
  studyGoal?: string | undefined;
  streakDays?: number | undefined;
  dailyGoalQuizzes?: number | undefined;
  dailyGoalCards?: number | undefined;
  strengths: { skillId: string; name: string; proficiency: number }[];
  weaknesses: {
    skillId: string;
    name: string;
    proficiency: number;
    consecutiveErrors: number;
  }[];
  dailyTask?:
    | {
        quizzesCount: number;
        cardsReviewedCount: number;
        readingCount: number;
        mistakesResolvedCount: number;
      }
    | undefined;
  dueCardsCount: number;
  unresolvedMistakesCount: number;
  assembledAt: string;
}

/** 快照组装所需的最小读取能力（Gateway 用 Repository 实现）。 */
export interface AnalysisSnapshotPorts {
  /** 学习者画像快照（失败原样返回，不回退）。 */
  getProfileSnapshot(): Promise<Result<LearnerProfileSnapshot, BusinessError>>;
  /** 到期卡计数（失败回退 0）。 */
  getDueCardsCount(language: TargetLanguage): Promise<Result<number, BusinessError>>;
  /** 未解决错题计数（失败回退 0）。 */
  getUnresolvedMistakesCount(language: TargetLanguage): Promise<Result<number, BusinessError>>;
}

export interface AssembleSnapshotInput {
  userId: string;
  /** 组装时间（调用方时钟）。 */
  assembledAt: string;
}

/**
 * 组装不可变学习快照（供分析与本地规则回退共用）。
 * 容错语义：profile 失败原样返回；到期卡/错题失败计数为 0。
 */
export async function buildAnalysisSnapshot(
  ports: AnalysisSnapshotPorts,
  input: AssembleSnapshotInput
): Promise<Result<AnalysisSnapshot, BusinessError>> {
  const profileRes = await ports.getProfileSnapshot();
  if (!isOk(profileRes)) return profileRes;
  const profile = profileRes.value;

  const [dueRes, mistakesRes] = await Promise.all([
    ports.getDueCardsCount(profile.targetLanguage),
    ports.getUnresolvedMistakesCount(profile.targetLanguage),
  ]);
  const dueCardsCount = isOk(dueRes) ? dueRes.value : 0;
  const unresolvedMistakesCount = isOk(mistakesRes) ? mistakesRes.value : 0;

  return ok({
    userId: input.userId,
    targetLanguage: profile.targetLanguage,
    overallLevel: '未进行标准化能力评测',
    practiceEvidence: summarizeLearningEvidence(profile.allMetrics, profile.targetLanguage),
    learnerLevel: profile.profile?.learnerLevel,
    studyGoal: profile.profile?.studyGoal,
    streakDays: profile.profile?.streakDays,
    dailyGoalQuizzes: profile.profile?.dailyGoalQuizzes,
    dailyGoalCards: profile.profile?.dailyGoalCards,
    strengths: profile.strengths.map((m) => ({ skillId: m.id, name: m.name, proficiency: m.proficiency })),
    weaknesses: profile.weaknesses.map((m) => ({
      skillId: m.id,
      name: m.name,
      proficiency: m.proficiency,
      consecutiveErrors: m.consecutiveErrors,
    })),
    dailyTask: profile.dailyTask
      ? {
          quizzesCount: profile.dailyTask.quizzesCount,
          cardsReviewedCount: profile.dailyTask.cardsReviewedCount,
          readingCount: profile.dailyTask.readingCount,
          mistakesResolvedCount: profile.dailyTask.mistakesResolvedCount,
        }
      : undefined,
    dueCardsCount,
    unresolvedMistakesCount,
    assembledAt: input.assembledAt,
  });
}
