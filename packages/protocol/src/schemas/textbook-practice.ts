import { z } from 'zod';
import { TextbookLearningContentSchema } from '@study-studio/document-model';

export const ExerciseGradeSchema = z.object({
  score: z.number().min(0).max(100), maxScore: z.literal(100),
  feedback: z.string().trim().min(1), suggestions: z.array(z.string().trim().min(1)),
  revisedAnswer: z.string().trim().min(1).optional(),
}).strict();
/** Only content goes to the native model tool; scale and identities are system owned. */
export const SubmitExerciseGradeSchema = ExerciseGradeSchema.omit({ maxScore: true });
export const ExerciseAnswerSchema = z.union([
  z.string().trim().min(1).max(20_000), z.array(z.string().trim().min(1)).min(1),
  z.array(z.object({ left: z.string().min(1), right: z.string().min(1) }).strict()).min(1),
]);
export const ExerciseSnapshotSchema = z.object({
  documentId: z.string(), chapterId: z.string(), chapterTitle: z.string(), language: z.enum(['ja','en','ko']),
  exercise: TextbookLearningContentSchema.shape.exercises.element,
  knowledge: z.array(z.object({ title: z.string(), explanation: z.string() })),
  rubricVersion: z.string(),
}).strict();
export const SubmitTextbookExerciseSchema = z.object({
  requestId: z.string().uuid(), documentId: z.string().min(1).optional(), chapterId: z.string().min(1).optional(), exerciseId: z.string().min(1).optional(),
  preview: ExerciseSnapshotSchema.optional(), answer: ExerciseAnswerSchema,
  previousAttemptId: z.string().min(1).optional(), retryAttemptId: z.string().min(1).optional(),
  model: z.string().trim().min(1).max(128).optional(), effort: z.string().max(32).optional(), timeSpentMs: z.number().int().nonnegative().optional(),
  runtimeId: z.string().trim().min(1).max(60).optional(),
}).strict();
export const TextbookExerciseAttemptSchema = z.object({
  id: z.string(), itemId: z.string(), attemptNo: z.number().int().positive(), previousAttemptId: z.string().nullable(),
  submissionKind: z.enum(['INDEPENDENT','REVISION']), status: z.enum(['SUBMITTED','GRADING','GRADED','GRADING_FAILED']),
  answer: ExerciseAnswerSchema, snapshot: ExerciseSnapshotSchema,
  grading: ExerciseGradeSchema.nullable(), gradingErrorCode: z.string().nullable(),
  model: z.string().nullable(), adapter: z.string().nullable(), rubricVersion: z.string(),
  submittedAt: z.string(), gradedAt: z.string().nullable(), timeSpentMs: z.number().nullable(), temporary: z.boolean(),
});
export const TextbookExerciseHistorySchema = z.array(TextbookExerciseAttemptSchema);
export const TextbookGrowthGroupSchema = z.object({
  chapterId: z.string(), chapterTitle: z.string(), type: ExerciseSnapshotSchema.shape.exercise.shape.type,
  difficultyTier: z.number().int().min(1).max(5).nullable(), submissionKind: z.enum(['INDEPENDENT','REVISION']),
  model: z.string().nullable(), adapter: z.string().nullable(), rubricVersion: z.string(),
  samples: z.number().int().positive(), averageScore: z.number().min(0).max(100), fullMarkRate: z.number().min(0).max(1),
  averageTimeSpentMs: z.number().nonnegative().nullable(),
  timeline: z.array(z.object({ date: z.string(), samples: z.number().int().positive(), averageScore: z.number().min(0).max(100) })),
});
export const TextbookGrowthSchema = z.object({
  independentAttempts: z.number().int().nonnegative(), revisionAttempts: z.number().int().nonnegative(), ungradedAttempts: z.number().int().nonnegative(),
  groups: z.array(TextbookGrowthGroupSchema),
});
export const TextbookGrowthResponseSchema = z.object({ history: TextbookExerciseHistorySchema, summary: TextbookGrowthSchema });
export type ExerciseGrade = z.infer<typeof ExerciseGradeSchema>;
export type ExerciseAnswer = z.infer<typeof ExerciseAnswerSchema>;
export type ExerciseSnapshot = z.infer<typeof ExerciseSnapshotSchema>;
export type SubmitTextbookExercise = z.infer<typeof SubmitTextbookExerciseSchema>;
export type TextbookExerciseAttempt = z.infer<typeof TextbookExerciseAttemptSchema>;
export type TextbookGrowth = z.infer<typeof TextbookGrowthSchema>;
