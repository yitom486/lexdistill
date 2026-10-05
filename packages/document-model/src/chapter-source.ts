import { z } from 'zod';

export const ContentSourceReferenceSchema = z.object({
  blockId: z.string().min(1),
  page: z.number().int().positive(),
  row: z.number().int().nonnegative().optional().describe('表格原始页内 0-based 行；不跨页合并词条'),
}).strict();
export type ContentSourceReference = z.infer<typeof ContentSourceReferenceSchema>;
