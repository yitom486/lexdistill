import { z } from 'zod';
/** 可由桌面偏好覆盖的资源与重试预算；非教材内容或完成判断。 */
export const TextbookPipelineSettingsSchema = z.object({
  poolSize: z.number().int().min(1).max(16).default(3),
  ocrConcurrency: z.number().int().min(1).max(8).default(2),
  queueCapacity: z.number().int().min(1).max(32).default(2),
  ocrRetries: z.number().int().min(0).max(5).default(1),
  modelRetries: z.number().int().min(0).max(5).default(1),
  storageRetries: z.number().int().min(0).max(5).default(2),
  allowAiExercises: z.boolean().default(true),
});
export type TextbookPipelineSettings = z.infer<typeof TextbookPipelineSettingsSchema>;
export const DEFAULT_TEXTBOOK_PIPELINE_SETTINGS = TextbookPipelineSettingsSchema.parse({});
