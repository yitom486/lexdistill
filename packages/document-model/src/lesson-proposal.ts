import { z } from 'zod';
import { LessonContentSchema } from './lesson-content.js';

const fields = LessonContentSchema.shape;
const example = fields.knowledgePoints.element.shape.examples.element.omit({ id: true });
const option = z.object({ text: z.string().trim().min(1) }).strict();
const index = z.number().int().nonnegative();
/** 模型只声明内容与数组内引用；持久化身份由 Gateway 分配。 */
export const LessonProposalContentSchema = LessonContentSchema.extend({
  blocks: z.array(fields.blocks.element.omit({ id: true })),
  vocabularies: z.array(fields.vocabularies.element.omit({ id: true }).extend({ examples: z.array(example) })),
  knowledgePoints: z.array(fields.knowledgePoints.element.omit({ id: true }).extend({ examples: z.array(example) })),
  exercises: z.array(fields.exercises.element.omit({ id: true, knowledgePointIds: true, options: true, left: true, right: true, answer: true }).extend({
    knowledgePointIndexes: z.array(index).describe('本次 knowledgePoints 数组中从 0 起的下标，由系统转换为持久化关联'),
    options: z.array(option).optional(), left: z.array(option).optional(), right: z.array(option).optional(),
    answer: z.object({
      text: z.string().trim().min(1).optional(),
      optionIndexes: z.array(index).optional().describe('本题 options 中从 0 起的下标；单选一个、多选多个、排序为完整有序下标'),
      pairs: z.array(z.object({ leftIndex: index, rightIndex: index }).strict()).optional().describe('本题左右数组从 0 起的匹配下标'),
    }).strict(),
  })),
});
export const LessonProposalSchema = z.object({ content: LessonProposalContentSchema }).strict();
export type LessonProposal = z.infer<typeof LessonProposalSchema>;
