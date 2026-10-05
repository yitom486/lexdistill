import { z } from 'zod';
/** 可由桌面偏好覆盖的资源与重试预算；非教材内容或完成判断。 */
export const TextbookPipelineSettingsSchema = z.object({
  poolSize: z.number().int().min(1).max(16).default(6),
  queueCapacity: z.number().int().min(1).max(32).default(2),
  modelRetries: z.number().int().min(0).max(5).default(1),
  toolRepairRetries: z.number().int().min(0).max(10).default(3).describe('每个原生轮次首次提交被拒绝后最多修正次数；与重新发起模型轮次分别计数'),
  storageRetries: z.number().int().min(0).max(5).default(2),
  allowAiExercises: z.boolean().default(true),
  firstResponseTimeoutMs: z.number().int().positive().max(600_000).default(60_000),
  stallTimeoutMs: z.number().int().positive().max(600_000).default(120_000),
  wallTimeoutMs: z.number().int().positive().max(3_600_000).default(600_000).describe('单轮问答的绝对墙钟上限；活动再多也会中断，防止空转拖住整批'),
});
export type TextbookPipelineSettings = z.infer<typeof TextbookPipelineSettingsSchema>;
export const DEFAULT_TEXTBOOK_PIPELINE_SETTINGS = TextbookPipelineSettingsSchema.parse({});
export const TextbookLessonStageSchema = z.enum(['preparing', 'queued', 'extracting', 'validating', 'correcting', 'model_retrying', 'saving', 'storage_retrying', 'saved', 'failed']);
export type TextbookLessonStage = z.infer<typeof TextbookLessonStageSchema>;

/** 进度取实际模型活动，不用定时器伪造处理进展。 */
export const TextbookModelActivitySchema = z.object({
  attempt: z.number().int().positive(),
  lastActivityAt: z.string(),
  event: z.string(),
  nativeTurnId: z.string().optional(),
  engineRetryCount: z.number().int().nonnegative(),
  correctionCount: z.number().int().nonnegative(),
  message: z.string().optional(),
}).strict();
export type TextbookModelActivity = z.infer<typeof TextbookModelActivitySchema>;
