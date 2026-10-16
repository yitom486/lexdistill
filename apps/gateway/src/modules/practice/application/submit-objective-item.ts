import { BusinessError, err, isOk, type Result } from '@lexdistill/shared';
import type { LearnerRepository } from '@lexdistill/learner-core';
import type { PracticeItemAttempt } from '@lexdistill/protocol';
import { gradeObjectiveAnswer } from './practice-grading.js';

type Repository = Pick<LearnerRepository, 'getPracticeRunItems' | 'getPracticePlanRun' | 'submitPracticeItem'>;
export async function submitObjectiveItem(repo: Repository, input: {
  userId: string; runId: string; itemId: string; userAnswer: string; timeSpentMs?: number | undefined;
}): Promise<Result<PracticeItemAttempt, BusinessError>> {
  if (!input.userAnswer?.trim() || input.userAnswer.length > 10000 ||
    (input.timeSpentMs !== undefined && (!Number.isFinite(input.timeSpentMs) || input.timeSpentMs < 0))) {
    return err(new BusinessError('E_INVALID_INPUT', '请提交有效答案和作答时长。', 'VALIDATION'));
  }
  const run = await repo.getPracticePlanRun(input.userId, input.runId);
  if (!isOk(run)) return err(run.error);
  if (!run.value || run.value.status !== 'IN_PROGRESS') return err(new BusinessError('E_RUN_CLOSED', '练习不存在或已关闭。', 'VALIDATION'));
  const items = await repo.getPracticeRunItems(input.userId, input.runId);
  if (!isOk(items)) return err(items.error);
  const item = items.value.find(candidate => candidate.itemId === input.itemId);
  if (!item) return err(new BusinessError('E_QUESTION_NOT_FOUND', '题目不属于当前练习。', 'VALIDATION'));
  const question = item.question;
  if (question.type === 'TRANSLATION') return err(new BusinessError('E_SUBJECTIVE_ANSWER', '请使用主观题批改入口。', 'VALIDATION'));
  const graded = gradeObjectiveAnswer({ ...question, language: run.value.language }, input.userAnswer);
  if (!graded.authoritative) return err(new BusinessError('E_QUESTION_INVALID', '题目缺少标准答案，请重新组题。', 'VALIDATION'));
  return repo.submitPracticeItem(input.userId, input.runId, input.itemId, input.userAnswer, {
    isCorrect: graded.isCorrect, score: Number(graded.isCorrect), testedSkillId: question.testedSkillId,
    correctAnswer: question.correctAnswer, explanation: question.explanation, source: 'AUTO_IMMEDIATE', gradedBy: 'gateway',
  }, input.timeSpentMs);
}
