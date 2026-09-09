import { z } from 'zod';

/**
 * 整本 enrich 后台任务状态契约（HTTP 轮询 + WS 推送同源）。
 *
 * 状态机：running → done | failed | cancelled。
 * - 逐课落库：每课成功即 saveDocument + shred，结果不怕丢；
 * - 续跑：新任务自动跳过已有生词的课（enrichBookLessons 只抽空课）；
 * - 取消：课间即停；在途的一课会正常收尾（关闭其临时会话），不伤及其他会话。
 */
export const EnrichJobStatusSchema = z.enum(['running', 'done', 'failed', 'cancelled']);
export type EnrichJobStatus = z.infer<typeof EnrichJobStatusSchema>;

export const EnrichJobFailedLessonSchema = z.object({
  lessonId: z.string(),
  lessonTitle: z.string(),
  /** 面向用户的失败原因（BusinessError.userMessage 口径） */
  error: z.string(),
});
export type EnrichJobFailedLesson = z.infer<typeof EnrichJobFailedLessonSchema>;

export const EnrichJobSnapshotSchema = z.object({
  jobId: z.string(),
  userId: z.string(),
  documentId: z.string(),
  status: EnrichJobStatusSchema,
  totalLessons: z.number().int().nonnegative(),
  doneLessons: z.number().int().nonnegative(),
  /** 当前在途的课（无在途时缺席；exactOptionalPropertyTypes 下用条件 spread 组装） */
  currentLessonId: z.string().optional(),
  currentLessonTitle: z.string().optional(),
  vocabularies: z.number().int().nonnegative(),
  grammarPoints: z.number().int().nonnegative(),
  dropped: z.number().int().nonnegative(),
  failed: z.array(EnrichJobFailedLessonSchema),
  /** 终态失败时的顶层原因（running/done 时缺席） */
  error: z.string().optional(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
});
export type EnrichJobSnapshot = z.infer<typeof EnrichJobSnapshotSchema>;

/** WS import.enrich.progress / completed / failed 的 payload（与快照同形，progress 必然 running） */
export type ImportEnrichEventPayload = EnrichJobSnapshot;
