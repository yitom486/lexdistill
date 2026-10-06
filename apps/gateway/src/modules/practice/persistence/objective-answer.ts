import { and, eq, or } from 'drizzle-orm';
import { quizAttempts, quizQuestions } from '@study-studio/storage-sqlite';
import type { ObjectiveAnswerInput, ObjectiveAnswerResult } from '@study-studio/protocol';
import { BusinessError, err, isOk, ok, inferLanguageFromSkillId, translateToBusinessError, type Result } from '@study-studio/shared';
import { gradeObjectiveAnswer, mapQuestionType } from '@study-studio/learning';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';
import { submitPracticeAttempt } from '../domain/record-practice-attempt.js';
import { serializePracticeWrite } from './serialized-write.js';

export async function submitObjectiveAnswer(
  deps: RepoDeps,
  userId: string,
  input: ObjectiveAnswerInput,
): Promise<Result<ObjectiveAnswerResult, BusinessError>> {
  try {
    return await serializePracticeWrite(deps.sqlite, () => deps.repo.withTransaction(async repo => {
      const [question] = await deps.db.select().from(quizQuestions).where(and(
        eq(quizQuestions.id, input.questionId),
        eq(quizQuestions.language, input.language),
        or(eq(quizQuestions.userId, userId), eq(quizQuestions.userId, 'default_user')),
      )).limit(1);
      if (!question) throw new BusinessError('E_QUESTION_NOT_FOUND', '题目不存在或不属于当前学习语种，请刷新题库。', 'VALIDATION');
      if (inferLanguageFromSkillId(question.testedSkillId) !== input.language) {
        throw new BusinessError('E_QUESTION_INVALID', '题目考点与学习语种不一致，请重新组题。', 'VALIDATION');
      }
      const type = mapQuestionType(question.type);
      if (type === 'TRANSLATION') throw new BusinessError('E_SUBJECTIVE_ANSWER', '写作与翻译请使用 AI 批改。', 'VALIDATION');

      // A submission retains its identity across retries, including a lost response after commit.
      const attemptId = `att_${userId.length}:${userId}:${input.submissionId}`;
      const [existing] = await deps.db.select().from(quizAttempts).where(eq(quizAttempts.id, attemptId)).limit(1);
      if (existing && (existing.userId !== userId || existing.questionId !== input.questionId || existing.userAnswer !== input.userAnswer || existing.language !== input.language)) {
        throw new BusinessError('E_SUBMISSION_CONFLICT', '该提交已保存；修改答案后请开始新的作答。', 'VALIDATION');
      }

      let options: unknown = question.options ? JSON.parse(question.options) : undefined;
      if (!Array.isArray(options)) options = undefined;
      const extras: unknown = question.extrasJson ? JSON.parse(question.extrasJson) : {};
      const variants = extras && typeof extras === 'object' && 'acceptableVariants' in extras && Array.isArray(extras.acceptableVariants)
        ? extras.acceptableVariants.filter((variant): variant is string => typeof variant === 'string') : undefined;
      const graded = gradeObjectiveAnswer({
        type, correctAnswer: question.correctAnswer, language: input.language,
        ...(Array.isArray(options) ? { options } : {}),
        ...(variants ? { acceptableVariants: variants } : {}),
      }, input.userAnswer);
      if (!graded.authoritative) throw new BusinessError('E_QUESTION_INVALID', '题目缺少可用的标准答案。', 'VALIDATION');
      if (!existing) {
        const saved = await submitPracticeAttempt(repo, {
          attemptId, userId, questionId: question.id, questionType: type,
          userAnswer: input.userAnswer, isCorrect: graded.isCorrect, score: graded.isCorrect ? 1 : 0,
          timeSpentMs: input.timeSpentMs, testedSkillId: question.testedSkillId,
          questionContent: question.content, correctAnswer: question.correctAnswer, explanation: question.explanation,
        });
        if (!isOk(saved)) throw saved.error;
      }
      return ok({
        submissionId: input.submissionId, questionId: question.id,
        isCorrect: existing?.isCorrect ?? graded.isCorrect, score: existing?.score ?? (graded.isCorrect ? 1 : 0),
        correctAnswer: question.correctAnswer, explanation: question.explanation, persistedToDb: true as const,
      });
    }));
  } catch (error) {
    return err(error instanceof BusinessError ? error : translateToBusinessError(error, 'SUBMIT_OBJECTIVE_ANSWER'));
  }
}
