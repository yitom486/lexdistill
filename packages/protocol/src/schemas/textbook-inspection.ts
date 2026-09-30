import { z } from 'zod';

/**
 * 教材预检就绪状态契约（服务端权威诊断结果）。
 *
 * - ready: 已登记目录内的课次均已就绪；各类内容是否存在须逐课核对，不能推断原书完整覆盖；
 * - partial: 本地数据库已包含部分课次或骨架，可断点恢复或直接精读已有课次；
 * - not_imported: 当前文件指纹没有匹配的导入记录。
 */
export const TextbookInspectionStatusSchema = z.enum([
  'ready',
  'partial',
  'not_imported',
]);
export type TextbookInspectionStatus = z.infer<typeof TextbookInspectionStatusSchema>;

export const TextbookInspectionDocSummarySchema = z.object({
  documentId: z.string(),
  title: z.string(),
  displayTitle: z.string(),
  sourceKind: z.string(),
  lessonCount: z.number().int().nonnegative(),
  readyLessonCount: z.number().int().nonnegative(),
  lineCount: z.number().int().nonnegative(),
  vocabCount: z.number().int().nonnegative(),
  grammarCount: z.number().int().nonnegative(),
  exerciseCount: z.number().int().nonnegative(),
  updatedAt: z.string(),
  hasShreddedAssets: z.boolean(),
  matchKind: z.literal('file'),
  outlineConfirmed: z.boolean(),
  passageLessonCount: z.number().int().nonnegative(),
  lessonDetails: z.array(z.object({
    lessonId: z.string(),
    title: z.string(),
    status: z.enum(['pending', 'ready', 'failed']),
    hasPassage: z.boolean(),
    lineCount: z.number().int().nonnegative(),
    vocabCount: z.number().int().nonnegative(),
    grammarCount: z.number().int().nonnegative(),
    exerciseCount: z.number().int().nonnegative(),
    hasPreview: z.boolean(),
    hasSummary: z.boolean(),
  })),
});
export type TextbookInspectionDocSummary = z.infer<typeof TextbookInspectionDocSummarySchema>;

export const TextbookInspectionResultSchema = z.object({
  status: TextbookInspectionStatusSchema,
  canDirectlyUse: z.boolean(),
  matchedDocument: TextbookInspectionDocSummarySchema.optional(),
  summary: z.string(),
});
export type TextbookInspectionResult = z.infer<typeof TextbookInspectionResultSchema>;
