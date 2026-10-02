import { z } from 'zod';

/** 解析材料随章节输入注入，页码始终为原书 1-based 物理页。 */
export const ChapterSourceBlockSchema = z.object({
  id: z.string().min(1),
  page: z.number().int().positive(),
  kind: z.enum(['TEXT', 'TITLE', 'TABLE', 'IMAGE']),
  text: z.string(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional().describe('左上原点、0–1 归一化位置'),
  rows: z.array(z.array(z.string())).optional(),
}).strict();
export type ChapterSourceBlock = z.infer<typeof ChapterSourceBlockSchema>;
export const ChapterSourceSchema = z.object({
  parser: z.enum(['native', 'local-ocr', 'mineru-cloud', 'mineru-local']),
  blocks: z.array(ChapterSourceBlockSchema).min(1),
}).strict();
export type ChapterSource = z.infer<typeof ChapterSourceSchema>;

export const ContentSourceReferenceSchema = z.object({
  blockId: z.string().min(1),
  page: z.number().int().positive(),
  row: z.number().int().nonnegative().optional().describe('表格原始页内 0-based 行；不跨页合并词条'),
}).strict();
export type ContentSourceReference = z.infer<typeof ContentSourceReferenceSchema>;
