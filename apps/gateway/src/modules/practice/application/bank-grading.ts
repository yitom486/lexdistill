import type { BankGradeSubmit, BankSubjectiveAnswerResult, ExerciseGrade } from '@lexdistill/protocol';
import { BankGradeSubmitSchema, ExerciseSnapshotSchema } from '@lexdistill/protocol';
import { BusinessError, err, isOk, ok, translateToBusinessError, type Result } from '@lexdistill/shared';
import type { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { bankReference, bankSubjectiveResult } from '../persistence/bank-submission.js';
import { validateBankWriting } from '../persistence/bank-grade.js';
import type { TextbookGrading } from './textbook-grading.js';

type GradeResult = Result<BankSubjectiveAnswerResult, BusinessError>;
/** Reuses the established native grading tool; model prose never becomes a persisted grade. */
export class BankGrading {
  private readonly running = new Map<string, { model: string; effort?: string | undefined; promise: Promise<GradeResult> }>();
  constructor(private readonly deps: { repo: DrizzleLearnerRepository; grading: TextbookGrading; adapterId: string }) {}
  async grade(userId: string, raw: BankGradeSubmit): Promise<GradeResult> {
    try {
      const input = BankGradeSubmitSchema.parse(raw);
      const context = this.deps.repo.readBankGradingContext(userId, input);
      if (context.submission.status === 'GRADED') return ok(bankSubjectiveResult(context.submission));
      const model = input.model ?? context.modelId;
      const key = JSON.stringify([userId, input.submissionId]);
      const active = this.running.get(key);
      if (active) {
        if (active.model !== model || active.effort !== input.effort) throw new BusinessError('E_GRADING_BUSY', '本次作答正在使用其他批改配置，请等待完成。', 'VALIDATION');
        return active.promise;
      }
      const promise = this.run(userId, { ...input, model }).finally(() => this.running.delete(key));
      this.running.set(key, { model, effort: input.effort, promise });
      return promise;
    } catch (cause) {
      return err(cause instanceof BusinessError ? cause : translateToBusinessError(cause, 'GRADE_BANK_SUBMISSION'));
    }
  }
  private async run(userId: string, input: BankGradeSubmit & { model: string }): Promise<GradeResult> {
    let acceptedGrade: ExerciseGrade | undefined;
    try {
      const { submission, item, paper } = this.deps.repo.readBankGradingContext(userId, input);
      const reference = bankReference(item);
      if (!reference.trim()) throw new BusinessError('E_REFERENCE_MISSING', '本题尚无有效参考答案，作答已保留。', 'VALIDATION');
      validateBankWriting(item, submission.userAnswer);
      // A validated native receipt survives a failed statistics commit; retry it without buying another model run.
      if (submission.grading && submission.model === input.model && submission.adapter === this.deps.adapterId) {
        acceptedGrade = submission.grading;
        const saved = await this.deps.repo.settleBankSubjectiveGrade(userId, input,
          { grade: acceptedGrade, model: input.model, adapter: this.deps.adapterId });
        if (!isOk(saved)) throw saved.error;
        return saved;
      }
      if (!['SHORT_ANSWER', 'TRANSLATION', 'WRITING'].includes(item.answer.type)) throw new BusinessError('E_SUBJECTIVE_ANSWER', '不是主观题。', 'VALIDATION');
      const answer = item.answer as Extract<typeof item.answer, { type: 'SHORT_ANSWER' | 'TRANSLATION' | 'WRITING' }>;
      const preview = ExerciseSnapshotSchema.parse({ documentId: 'bank', chapterId: paper.paperId, chapterTitle: paper.title,
        language: item.language, rubricVersion: 'bank-grade-v1', exercise: {
          id: item.id, type: answer.type, source: 'AI', prompt: item.prompt, answer: reference,
          difficultyTier: item.difficultyTier, difficultyReason: item.difficultyReason,
          gradingNotes: JSON.stringify({ rubric: answer.rubric, targetLevel: item.targetLevel,
            ...(answer.type === 'WRITING' ? { minWords: answer.minWords, maxWords: answer.maxWords } : {}),
            ...(answer.type === 'TRANSLATION' ? { targetLanguage: answer.targetLanguage } : {}) }),
        }, knowledge: item.material ? [{ title: 'Question material', explanation: JSON.stringify(item.material) }] : [] });
      const result = await this.deps.grading.submit(userId, { requestId: crypto.randomUUID(), preview,
        answer: submission.userAnswer, model: input.model, ...(input.effort ? { effort: input.effort } : {}), timeSpentMs: submission.timeSpentMs });
      if (!isOk(result)) throw result.error;
      if (result.value.status !== 'GRADED' || !result.value.grading) throw new BusinessError('E_GRADING_RESULT_MISSING', '模型未提交有效批改回执，作答已保留。', 'AGENT_RUNTIME', true);
      acceptedGrade = result.value.grading;
      const saved = await this.deps.repo.settleBankSubjectiveGrade(userId, input,
        { grade: result.value.grading, model: input.model, adapter: this.deps.adapterId });
      if (!isOk(saved)) throw saved.error;
      return saved;
    } catch (cause) {
      const error = cause instanceof BusinessError ? cause : translateToBusinessError(cause, 'GRADE_BANK_SUBMISSION');
      return this.deps.repo.settleBankSubjectiveGrade(userId, input, { error: error.code, model: input.model, adapter: this.deps.adapterId,
        ...(acceptedGrade ? { grade: acceptedGrade } : {}) });
    }
  }
}
