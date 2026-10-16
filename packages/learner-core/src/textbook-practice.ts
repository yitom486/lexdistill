import type { BusinessError, Result } from '@lexdistill/shared';
import type { ExerciseGrade, SubmitTextbookExercise, TextbookExerciseAttempt } from '@lexdistill/protocol';

export interface TextbookGradeAudit { id: string; adapter: string; model: string; inputSnapshot: string }
/** Commands are reusable outside the textbook UI. No UI state or provider protocol here. */
export interface TextbookPracticeRepository {
  prepareTextbookAttempt(userId: string, input: SubmitTextbookExercise): Promise<Result<TextbookExerciseAttempt, BusinessError>>;
  getTextbookAttempt(userId: string, id: string): Promise<Result<TextbookExerciseAttempt, BusinessError>>;
  claimTextbookGrade(userId: string, id: string, gradingRunId: string): Promise<Result<boolean, BusinessError>>;
  settleTextbookGrade(userId: string, id: string, audit: TextbookGradeAudit | undefined, grade: ExerciseGrade | undefined, errorCode?: string): Promise<Result<TextbookExerciseAttempt, BusinessError>>;
  textbookExerciseHistory(userId: string, documentId: string, chapterId: string): Promise<Result<TextbookExerciseAttempt[], BusinessError>>;
}
