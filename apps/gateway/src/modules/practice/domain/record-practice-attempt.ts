import {
  err,
  isOk,
  ok,
  type Result,
  BusinessError,
  generateId,
  nowIso,
  inferLanguageFromSkillId,
} from '@study-studio/shared';
import { recordSkillAttempt } from '@study-studio/learning';
import type { QuizGradingResult, QuizQuestionType } from '@study-studio/protocol';
import {
  createMistakeEntry,
  type LearnerRepository,
} from '@study-studio/learner-core';

export interface SubmitPracticeAttemptInput {
  attemptId?: string;
  sourceAttemptId?: string;
  questionType?: QuizQuestionType;
  userId: string;
  questionId: string;
  userAnswer: string;
  isCorrect: boolean;
  score: number;
  timeSpentMs: number;
  testedSkillId: string;
  questionContent?: string;
  correctAnswer?: string;
  explanation?: string;
  /** Validated rubric receipt; normalized attempt scores and 0-100 review scores use different scales. */
  grading?: QuizGradingResult;
}

export type PracticeSubmissionRepository = Pick<
  LearnerRepository,
  'recordQuizAttempt' | 'getProfileSnapshot' | 'saveSkillMetric' | 'saveMistake'
>;

/**
 * 持久化一次练习提交，并按原有顺序更新技能画像与错题本。
 */
export async function submitPracticeAttempt(
  repo: PracticeSubmissionRepository,
  input: SubmitPracticeAttemptInput
): Promise<Result<void, BusinessError>> {
  const attemptRes = await repo.recordQuizAttempt({
    id: input.attemptId ?? generateId('att'),
    ...(input.sourceAttemptId ? { sourceAttemptId: input.sourceAttemptId } : {}),
    userId: input.userId,
    questionId: input.questionId,
    userAnswer: input.userAnswer,
    isCorrect: input.isCorrect,
    score: input.score,
    timeSpentMs: input.timeSpentMs,
    testedSkillId: input.testedSkillId,
    createdAt: nowIso(),
  });
  if (!isOk(attemptRes)) return err(attemptRes.error);

  const snapshotRes = await repo.getProfileSnapshot(input.userId, inferLanguageFromSkillId(input.testedSkillId));
  if (!isOk(snapshotRes)) return err(snapshotRes.error);
  const previous = snapshotRes.value.allMetrics.find(
      (metric) => metric.id === input.testedSkillId
    );
  const dimension = input.testedSkillId.includes('.listening') ? 'LISTENING'
      : input.testedSkillId.includes('.reading') ? 'READING'
      : input.testedSkillId.includes('.vocab') ? 'VOCABULARY'
      : input.testedSkillId.includes('.writing') ? 'NUANCE_PRAGMATIC' : 'GRAMMAR';
  const metricRes = await repo.saveSkillMetric(
    input.userId,
    recordSkillAttempt(previous ?? {
      id: input.testedSkillId, name: input.testedSkillId, dimension,
      proficiency: 0, totalAttempts: 0, correctAttempts: 0, consecutiveErrors: 0, status: 'NORMAL',
    }, input.isCorrect)
  );
  if (!isOk(metricRes)) return err(metricRes.error);

  if (!input.isCorrect) {
    const mistake = createMistakeEntry(
      input.userId,
      {
        id: input.questionId,
        type: input.questionType ?? 'MULTIPLE_CHOICE',
        prompt: '自适应客观题',
        content: input.questionContent ?? '',
        correctAnswer: input.correctAnswer ?? '',
        explanation: input.explanation ?? '',
        testedSkillId: input.testedSkillId,
        difficultyTier: 3,
      },
      input.userAnswer,
      {
        ...input.grading,
        questionId: input.questionId,
        isCorrect: false,
        score: input.grading?.score ?? 0,
        correctAnswer: input.correctAnswer ?? '',
        userSubmission: input.userAnswer,
        explanation: input.explanation ?? '回答有误',
        mistakeRecorded: true,
      }
    );
    const mistakeRes = await repo.saveMistake(mistake);
    if (!isOk(mistakeRes)) return err(mistakeRes.error);
  }

  return ok(undefined);
}
