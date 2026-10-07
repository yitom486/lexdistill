import type { BankGradeSubmit, ExerciseGrade } from '@study-studio/protocol';
import { BankGradeSubmitSchema, ExerciseGradeSchema } from '@study-studio/protocol';
import { BusinessError, err, isOk, ok, translateToBusinessError } from '@study-studio/shared';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';
import { submitPracticeAttempt } from '../domain/record-practice-attempt.js';
import { serializePracticeWrite } from './serialized-write.js';
import { bankAttemptId, bankReference, bankSubjectiveResult, checkBankSkill, type BankAnswerDeps } from './bank-submission.js';

export function readBankGradingContext(deps: RepoDeps & BankAnswerDeps, userId: string, raw: BankGradeSubmit) {
  const input = BankGradeSubmitSchema.parse(raw);
  const paper = deps.bank.readTaskPaper(userId, input.taskId, input.paperId);
  const submission = deps.bank.getBankSubmission(userId, input.submissionId);
  if (!submission || submission.taskId !== input.taskId || submission.paperId !== input.paperId) {
    throw new BusinessError('E_SUBMISSION_NOT_FOUND', '作答不存在或不属于当前试卷。', 'VALIDATION');
  }
  const item = paper.items.find(question => question.id === submission.questionId);
  if (!item || !['SHORT_ANSWER', 'TRANSLATION', 'WRITING'].includes(item.answer.type)) {
    throw new BusinessError('E_SUBJECTIVE_ANSWER', '只能批改本试卷中已保存的主观作答。', 'VALIDATION');
  }
  checkBankSkill(item);
  return { submission, item, paper, modelId: deps.bank.describeTask(userId, input.taskId).config.modelId };
}

export function validateBankWriting(item: ReturnType<typeof readBankGradingContext>['item'], answer: string) {
  if (item.answer.type !== 'WRITING') return;
  const words = [...new Intl.Segmenter(item.language, { granularity: 'word' }).segment(answer)].filter(part => part.isWordLike).length;
  if ((item.answer.minWords !== undefined && words < item.answer.minWords)
    || (item.answer.maxWords !== undefined && words > item.answer.maxWords)) {
    throw new BusinessError('E_WRITING_LENGTH', '作答未满足本题字数要求，答案已保留；修改后请作为新的作答提交。', 'VALIDATION');
  }
}

/** Submission retention is committed before grading; only the grade + practice facts share this transaction. */
export async function settleBankSubjectiveGrade(deps: RepoDeps & BankAnswerDeps, userId: string, input: BankGradeSubmit,
  outcome: { grade: ExerciseGrade; model: string; adapter: string } | { error: string; grade?: ExerciseGrade; model?: string; adapter?: string }) {
  try {
    return await serializePracticeWrite(deps.sqlite, () => deps.repo.withTransaction(async repo => {
      const { submission, item } = readBankGradingContext(deps, userId, input);
      if (submission.status === 'GRADED') return ok(bankSubjectiveResult(submission));
      if ('error' in outcome) return ok(bankSubjectiveResult(deps.bank.settleBankSubmission(userId, input.submissionId,
        { status: 'GRADING_FAILED', gradingError: outcome.error, ...(outcome.model ? { model: outcome.model } : {}),
          ...(outcome.adapter ? { adapter: outcome.adapter } : {}),
          ...(outcome.grade ? { grading: ExerciseGradeSchema.parse(outcome.grade) } : {}) })));
      const grade = ExerciseGradeSchema.parse(outcome.grade);
      validateBankWriting(item, submission.userAnswer);
      const isCorrect = grade.score >= 80;
      const score = grade.score / grade.maxScore;
      const settled = deps.bank.settleBankSubmission(userId, input.submissionId,
        { status: 'GRADED', isCorrect, score, grading: grade, model: outcome.model, adapter: outcome.adapter });
      const saved = await submitPracticeAttempt(repo, {
        attemptId: bankAttemptId(userId, input.submissionId), userId, questionId: item.id, questionType: 'TRANSLATION',
        userAnswer: submission.userAnswer, isCorrect, score, timeSpentMs: submission.timeSpentMs, testedSkillId: checkBankSkill(item),
        questionContent: item.prompt, correctAnswer: bankReference(item), explanation: grade.feedback,
        grading: { questionId: item.id, isCorrect, score: grade.score, correctAnswer: bankReference(item),
          userSubmission: submission.userAnswer, explanation: grade.feedback, mistakeRecorded: !isCorrect,
          ...(grade.revisedAnswer ? { refinementSuggestion: grade.revisedAnswer } : {}) },
      });
      if (!isOk(saved)) throw saved.error;
      return ok(bankSubjectiveResult(settled));
    }));
  } catch (cause) {
    return err(cause instanceof BusinessError ? cause : translateToBusinessError(cause, 'SETTLE_BANK_GRADE'));
  }
}
