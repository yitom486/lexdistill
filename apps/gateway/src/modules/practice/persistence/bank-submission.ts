import { eq } from 'drizzle-orm';
import { quizAttempts } from '@lexdistill/storage-sqlite';
import type { QuestionGenerationRepository } from '@lexdistill/learner-core';
import type { BankAnswerSubmit, BankQuestionRecord, BankSubmissionRecord, BankSubjectiveAnswerResult } from '@lexdistill/protocol';
import { BankSubjectiveAnswerResultSchema } from '@lexdistill/protocol';
import { BusinessError, inferLanguageFromSkillId } from '@lexdistill/shared';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';

export interface BankAnswerDeps { bank: QuestionGenerationRepository }
export const bankAttemptId = (userId: string, submissionId: string) => `att_${userId.length}:${userId}:${submissionId}`;
export function checkBankSkill(item: BankQuestionRecord): string {
  const skill = item.skillIds[0]!;
  if (inferLanguageFromSkillId(skill) !== item.language) throw new BusinessError('E_QUESTION_INVALID', '题目考点与学习语种不一致。', 'VALIDATION');
  return skill;
}
export function bankReference(item: BankQuestionRecord): string {
  switch (item.answer.type) {
    case 'SHORT_ANSWER': case 'TRANSLATION': return item.answer.referenceAnswer;
    case 'WRITING': return item.answer.sampleAnswer;
    default: throw new BusinessError('E_OBJECTIVE_ANSWER', '客观题请使用客观作答入口。', 'VALIDATION');
  }
}
/** Exact recognition is only a shortcut for short answers, never a translation or writing rubric. */
export function gradeBankSubjective(reference: string, userAnswer: string, language?: string): { isCorrect: true } | { pending: true } {
  if (!reference.trim()) throw new BusinessError('E_REFERENCE_MISSING', '本题尚无有效参考答案', 'VALIDATION');
  const normalize = (text: string) => {
    const value = text.normalize('NFKC').trim().replace(/\s+/g, ' ');
    return language === 'en' ? value.toLowerCase() : value;
  };
  return normalize(userAnswer) === normalize(reference) ? { isCorrect: true } : { pending: true };
}
/** Both answer routes reserve the same identity, including paper context and elapsed time. */
export async function prepareBankSubmission(deps: RepoDeps & BankAnswerDeps, userId: string, input: BankAnswerSubmit, item: BankQuestionRecord) {
  const previous = deps.bank.getBankSubmission(userId, input.submissionId);
  if (previous) {
    if (previous.taskId !== input.taskId || previous.paperId !== input.paperId || previous.questionId !== input.questionId
      || previous.answerType !== item.answer.type || previous.userAnswer !== input.userAnswer
      || (previous.attemptId !== null && previous.timeSpentMs !== input.timeSpentMs)) {
      throw new BusinessError('E_SUBMISSION_CONFLICT', '该提交已保存；修改内容后请开始新的作答。', 'VALIDATION');
    }
    // v47 收据缺新元数据时回填（确定性派生），否则复盘连接无法成立。
    if (previous.attemptId === null) {
      return deps.bank.healBankSubmission(userId, input.submissionId, { timeSpentMs: input.timeSpentMs });
    }
    return previous;
  }
  const [attempt] = await deps.db.select().from(quizAttempts).where(eq(quizAttempts.id, bankAttemptId(userId, input.submissionId))).limit(1);
  if (attempt) throw new BusinessError('E_SUBMISSION_CONFLICT', '该提交身份已用于其他作答，请使用新的提交身份。', 'VALIDATION');
  return deps.bank.insertBankSubmission({ userId, ...input, answerType: item.answer.type });
}
export function bankSubjectiveResult(submission: BankSubmissionRecord): BankSubjectiveAnswerResult {
  return BankSubjectiveAnswerResultSchema.parse({ submissionId: submission.submissionId, questionId: submission.questionId,
    status: submission.status, ...(submission.isCorrect === null ? {} : { isCorrect: submission.isCorrect }),
    ...(submission.score === null ? {} : { score: submission.score }),
    ...(submission.gradingError ? { gradingError: submission.gradingError } : {}),
    ...(submission.status === 'GRADED' && submission.grading ? { grading: submission.grading } : {}), persistedToDb: true });
}
