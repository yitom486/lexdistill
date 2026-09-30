import { z } from 'zod';

/**
 * 整书 AI 流水线并发提炼后台任务状态契约（HTTP 轮询 + SSE 流式推送同源）。
 *
 * 状态机：idle → running → done | failed | cancelled。
 */
export const TextbookPipelineJobStatusSchema = z.enum([
  'idle',
  'running',
  'done',
  'failed',
  'cancelled',
]);
export type TextbookPipelineJobStatus = z.infer<typeof TextbookPipelineJobStatusSchema>;

export const TextbookPipelineFailedLessonSchema = z.object({
  lessonId: z.string(),
  title: z.string(),
  error: z.string(),
});
export type TextbookPipelineFailedLesson = z.infer<typeof TextbookPipelineFailedLessonSchema>;

export const TextbookPipelineJobSnapshotSchema = z.object({
  jobId: z.string(),
  userId: z.string(),
  documentId: z.string(),
  title: z.string(),
  status: TextbookPipelineJobStatusSchema,
  totalLessons: z.number().int().nonnegative(),
  doneLessons: z.number().int().nonnegative(),
  currentLessonId: z.string().optional(),
  currentLessonTitle: z.string().optional(),
  currentStage: z.enum(['ocr', 'queued', 'extracting', 'validating', 'saving', 'saved', 'failed']).optional(),
  lessonStages: z.record(z.string(), z.enum(['ocr', 'queued', 'extracting', 'validating', 'saving', 'saved', 'failed'])).optional(),
  successfulLessons: z.number().int().nonnegative(),
  failedLessons: z.array(TextbookPipelineFailedLessonSchema),
  concurrency: z.number().int().positive().optional(),
  model: z.string().optional(),
  error: z.string().optional(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
});
export type TextbookPipelineJobSnapshot = z.infer<typeof TextbookPipelineJobSnapshotSchema>;
