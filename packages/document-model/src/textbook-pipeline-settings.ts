import { z } from 'zod';
/** 可由桌面偏好覆盖的资源与重试预算；非教材内容或完成判断。 */
export const TextbookPipelineSettingsSchema = z.object({
  poolSize: z.number().int().min(1).max(16).default(3),
  parserBackend: z.enum(['mineru-cloud', 'mineru-local']).default('mineru-cloud'),
  mineruLocalUrl: z.string().default(''),
  mineruLocalTier: z.enum(['basic', 'standard', 'advanced']).default('standard'),
  parserLanguage: z.enum(['ch', 'en', 'japan', 'korean']).default('ch'),
  parseConcurrency: z.number().int().min(1).max(8).default(2),
  parsePageLimit: z.number().int().min(1).max(200).default(200),
  parsePollIntervalMs: z.number().int().min(10).max(30_000).default(2_000),
  parseTimeoutMs: z.number().int().min(100).max(3_600_000).default(600_000),
  queueCapacity: z.number().int().min(1).max(32).default(2),
  parseRetries: z.number().int().min(0).max(5).default(1),
  modelRetries: z.number().int().min(0).max(5).default(1),
  storageRetries: z.number().int().min(0).max(5).default(2),
  allowAiExercises: z.boolean().default(true),
  firstResponseTimeoutMs: z.number().int().positive().max(600_000).default(60_000),
  stallTimeoutMs: z.number().int().positive().max(600_000).default(120_000),
});
export type TextbookPipelineSettings = z.infer<typeof TextbookPipelineSettingsSchema>;
/** 只返回凭据是否存在；客户端永远不接收凭据值。 */
export const TextbookParserConfigSchema = z.object({ cloudTokenConfigured: z.boolean() }).strict();
export const DEFAULT_TEXTBOOK_PIPELINE_SETTINGS = TextbookPipelineSettingsSchema.parse({});
export const TextbookLessonStageSchema = z.enum(['parsing', 'queued', 'extracting', 'validating', 'correcting', 'model_retrying', 'saving', 'storage_retrying', 'saved', 'failed']);
export type TextbookLessonStage = z.infer<typeof TextbookLessonStageSchema>;
