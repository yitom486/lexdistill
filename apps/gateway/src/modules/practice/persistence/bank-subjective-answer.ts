import type { BankAnswerSubmit, BankSubjectiveAnswerResult } from '@lexdistill/protocol';
import { BankAnswerSubmitSchema } from '@lexdistill/protocol';
import { BusinessError, err, isOk, ok, translateToBusinessError, type Result } from '@lexdistill/shared';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';
import { serializePracticeWrite } from './serialized-write.js';
import { bankReference, bankSubjectiveResult, checkBankSkill, gradeBankSubjective, prepareBankSubmission, type BankAnswerDeps } from './bank-submission.js';
import { settleBankSubjectiveGrade } from './bank-grade.js';

export async function submitBankSubjectiveAnswer(deps: RepoDeps & BankAnswerDeps, userId: string,
  rawInput: BankAnswerSubmit): Promise<Result<BankSubjectiveAnswerResult, BusinessError>> {
  try {
    const input = BankAnswerSubmitSchema.parse(rawInput);
    const prepared = await serializePracticeWrite(deps.sqlite, () => deps.repo.withTransaction(async () => {
      const paper = deps.bank.readTaskPaper(userId, input.taskId, input.paperId);
      const item = paper.items.find(question => question.id === input.questionId);
      if (!item) throw new BusinessError('E_QUESTION_NOT_FOUND', '题目不属于当前试卷。', 'VALIDATION');
      if (!['SHORT_ANSWER', 'TRANSLATION', 'WRITING'].includes(item.answer.type)) {
        throw new BusinessError('E_OBJECTIVE_ANSWER', '客观题请使用客观作答入口。', 'VALIDATION');
      }
      checkBankSkill(item);
      const previous = deps.bank.getBankSubmission(userId, input.submissionId);
      const submission = await prepareBankSubmission(deps, userId, input, item);
      return { item, submission, replay: previous !== null };
    }));
    if (prepared.replay || prepared.item.answer.type !== 'SHORT_ANSWER') return ok(bankSubjectiveResult(prepared.submission));
    const gradeInput = { taskId: input.taskId, paperId: input.paperId, submissionId: input.submissionId };
    try {
      const reference = bankReference(prepared.item);
      if ('pending' in gradeBankSubjective(reference, input.userAnswer, prepared.item.language)) return ok(bankSubjectiveResult(prepared.submission));
      const settled = await settleBankSubjectiveGrade(deps, userId, gradeInput,
        { grade: { score: 100, maxScore: 100, feedback: prepared.item.explanation, suggestions: [] }, model: 'exact-match', adapter: 'rule' });
      if (!isOk(settled)) throw settled.error;
      return settled;
    } catch (cause) {
      const error = cause instanceof BusinessError ? cause : translateToBusinessError(cause, 'GRADE_BANK_ANSWER');
      return await settleBankSubjectiveGrade(deps, userId, gradeInput, { error: error.code });
    }
  } catch (cause) {
    return err(cause instanceof BusinessError ? cause : translateToBusinessError(cause, 'SUBMIT_BANK_SUBJECTIVE_ANSWER'));
  }
}
