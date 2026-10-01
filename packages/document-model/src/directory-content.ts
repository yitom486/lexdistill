import { z } from 'zod';
import { TextbookLearningContentSchema } from './textbook-learning-content.js';
import { LessonContentSchema } from './lesson-content.js';
import { TocLevelSchema } from './toc.js';

/** 阅读用目录投影保留实际身份；不猜标题、父节点或页码。 */
export const ContentDirectoryNodeSchema = z.object({
  id: z.string(), title: z.string(), level: TocLevelSchema,
  parentId: z.string().nullable().optional(), startPage: z.number().int().positive().optional(), endPage: z.number().int().positive().optional(), sortOrder: z.number().int().positive().optional(),
});
export type ContentDirectoryNode = z.infer<typeof ContentDirectoryNodeSchema>;
export const SavedTextbookContentSchema = z.object({
  documentId: z.string(), nodeId: z.string(), title: z.string(), readAt: z.string(), status: z.enum(['pending', 'ready', 'failed']).optional(),
  directory: z.array(ContentDirectoryNodeSchema), content: LessonContentSchema.nullable(), learningContent: TextbookLearningContentSchema.optional(),
  counts: z.object({ lines: z.number().int().nonnegative(), vocabularies: z.number().int().nonnegative(), knowledgePoints: z.number().int().nonnegative(), exercises: z.number().int().nonnegative() }).nullable(),
});
export type SavedTextbookContent = z.infer<typeof SavedTextbookContentSchema>;
