import { z } from 'zod';

/** Validate the read boundary; null alone means no saved structure. */
export const SavedStructureSchema = z.object({
  documentId: z.string(),
  headings: z.array(z.object({ page: z.number().finite(), text: z.string() }).passthrough()),
  classes: z.array(z.object({
    text: z.string(), page: z.number().finite(),
    kind: z.enum(['lesson', 'section', 'toc', 'noise']),
    lessonNo: z.string().nullable(), skillId: z.string().nullable(),
  })),
  model: z.string(), effort: z.string(), dropped: z.number().int().nonnegative(), createdAt: z.string(),
});
