import { eq } from 'drizzle-orm';
import { quizAttempts } from '@lexdistill/storage-sqlite';
import type { BankAnswerSubmit, BankObjectiveAnswerResult, BankQuestionRecord,
  GenerationPaperDetail, QuizQuestionType } from '@lexdistill/protocol';
import { BankAnswerSubmitSchema, BankObjectiveAnswerResultSchema } from '@lexdistill/protocol';
import { BusinessError, err, isOk, ok, translateToBusinessError, type Result } from '@lexdistill/shared';
import { gradeObjectiveAnswer, mapQuestionType } from '@lexdistill/learning';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';
import { submitPracticeAttempt } from '../domain/record-practice-attempt.js';
import { serializePracticeWrite } from './serialized-write.js';
import { bankAttemptId, checkBankSkill, prepareBankSubmission,
  type BankAnswerDeps } from './bank-submission.js';
export { gradeBankSubjective } from './bank-submission.js';
export { submitBankSubjectiveAnswer } from './bank-subjective-answer.js';

const OBJECTIVE_TYPES = ['MULTIPLE_CHOICE', 'FILL_BLANK', 'REORDER'] as const;

function findPaperItem(paper: GenerationPaperDetail, questionId: string): GenerationPaperDetail['items'][number] {
  const item = paper.items.find(candidate => candidate.id === questionId);
  if (!item) throw new BusinessError('E_QUESTION_NOT_FOUND', '题目不属于当前试卷。', 'VALIDATION');
  return item;
}

/**
 * 新题库客观题归一化：与既有 `gradeObjectiveAnswer` 同一判分所有者，不扩展相似答案判对。
 * - 选择：标准答案为正确选项 key（文本等价同样接受，由判分函数处理）；
 * - 填空：首个可接受答案为标准答案，其余为等价变体；
 * - 排序：按正确顺序连接分块，沿用既有空格连接口径。
 */
export function normalizeBankObjective(item: BankQuestionRecord): {
  type: QuizQuestionType; correctAnswer: string; acceptableVariants?: string[]; options?: unknown[];
} {
  switch (item.answer.type) {
    case 'MULTIPLE_CHOICE':
      return { type: 'MULTIPLE_CHOICE', correctAnswer: item.answer.correctKey, options: item.answer.options };
    case 'FILL_BLANK': {
      const [first, ...rest] = item.answer.acceptedAnswers;
      return { type: 'FILL_IN_BLANK', correctAnswer: first!, ...(rest.length ? { acceptableVariants: rest } : {}) };
    }
    case 'REORDER': {
      const reorder = item.answer;
      return { type: 'SENTENCE_REORDER',
        correctAnswer: reorder.correctOrder.map(index => reorder.chunks[index] ?? '').join(' ') };
    }
    default:
      throw new BusinessError('E_SUBJECTIVE_ANSWER', '短答、翻译与写作请使用主观题作答入口。', 'VALIDATION');
  }
}

export async function submitBankObjectiveAnswer(
  deps: RepoDeps & BankAnswerDeps,
  userId: string,
  rawInput: BankAnswerSubmit,
): Promise<Result<BankObjectiveAnswerResult, BusinessError>> {
  try {
    const input = BankAnswerSubmitSchema.parse(rawInput);
    if (!input.userAnswer.trim() || input.userAnswer.length > 10000) {
      throw new BusinessError('E_INVALID_INPUT', '请提交有效答案和作答时长。', 'VALIDATION');
    }
    return await serializePracticeWrite(deps.sqlite, () => deps.repo.withTransaction(async repo => {
      const paper = deps.bank.readTaskPaper(userId, input.taskId, input.paperId);
      const item = findPaperItem(paper, input.questionId);
      if (!((OBJECTIVE_TYPES as readonly string[]).includes(item.answer.type))) {
        throw new BusinessError('E_SUBJECTIVE_ANSWER', '短答、翻译与写作请使用主观题作答入口。', 'VALIDATION');
      }
      const testedSkillId = checkBankSkill(item);
      const normalized = normalizeBankObjective(item);

      // 提交身份跨重试保留（含响应丢失后的重放），换内容复用原键视为冲突。
      const attemptId = bankAttemptId(userId, input.submissionId);
      const [existing] = await deps.db.select().from(quizAttempts).where(eq(quizAttempts.id, attemptId)).limit(1);
      if (existing && (existing.userId !== userId || existing.questionId !== input.questionId || existing.userAnswer !== input.userAnswer)) {
        throw new BusinessError('E_SUBMISSION_CONFLICT', '该提交已保存；修改答案后请开始新的作答。', 'VALIDATION');
      }
      // 收据先行：新题判分记录必须有宿主已结算的收据背书（同一提交身份、同一内容）。
      await prepareBankSubmission(deps, userId, input, item);

      const graded = gradeObjectiveAnswer({ type: mapQuestionType(normalized.type),
        correctAnswer: normalized.correctAnswer, language: item.language,
        ...(normalized.options ? { options: normalized.options } : {}),
        ...(normalized.acceptableVariants ? { acceptableVariants: normalized.acceptableVariants } : {}) }, input.userAnswer);
      if (!graded.authoritative) throw new BusinessError('E_QUESTION_INVALID', '题目缺少可用的标准答案。', 'VALIDATION');
      if (!existing) {
        deps.bank.settleBankSubmission(userId, input.submissionId,
          { status: 'GRADED', isCorrect: graded.isCorrect, score: graded.isCorrect ? 1 : 0 });
        const saved = await submitPracticeAttempt(repo, {
          attemptId, userId, questionId: item.id, questionType: mapQuestionType(item.answer.type),
          userAnswer: input.userAnswer, isCorrect: graded.isCorrect, score: graded.isCorrect ? 1 : 0,
          timeSpentMs: input.timeSpentMs, testedSkillId,
          questionContent: item.prompt, correctAnswer: normalized.correctAnswer, explanation: item.explanation,
        });
        if (!isOk(saved)) throw saved.error;
      }
      return ok(BankObjectiveAnswerResultSchema.parse({
        submissionId: input.submissionId, questionId: item.id,
        isCorrect: existing ? existing.isCorrect : graded.isCorrect,
        score: existing ? existing.score : (graded.isCorrect ? 1 : 0),
        correctAnswer: normalized.correctAnswer, explanation: item.explanation, persistedToDb: true as const,
      }));
    }));
  } catch (error) {
    return err(error instanceof BusinessError ? error : translateToBusinessError(error, 'SUBMIT_BANK_OBJECTIVE_ANSWER'));
  }
}

