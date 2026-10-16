import { z } from 'zod';
import { VocabularyLearningContentSchema } from '@lexdistill/document-model';

const text = () => z.string().trim().min(1);

/** 读取词汇依据并建立任务绑定：返回词、教材信息、已有讲解与本次任务。 */
export const VocabularyLearningContextInputSchema = z.object({
  vocabularyId: text().describe('全局词汇 ID（词汇库条目 id）'),
  language: z.enum(['ja', 'en', 'ko']).describe('词条语种'),
  textbookVocabularyId: text().optional().describe('教材词汇行 ID；从教材入口学习时填写，绑定到该课行'),
}).strict();
export type VocabularyLearningContextInput = z.infer<typeof VocabularyLearningContextInputSchema>;

/** 提交教学内容：必须携带 context 返回的 taskId；同一词重复提交只覆盖，版本+1。 */
export const VocabularyLearningSubmitInputSchema = z.object({
  taskId: text().describe('context 返回的任务 ID；无任务或任务过期会被拒绝，先调 context'),
  content: VocabularyLearningContentSchema.describe('教学内容：讲解/情景/易错/小测，可选模块缺省；来源固定标记 AI'),
}).strict();
export type VocabularyLearningSubmitInput = z.infer<typeof VocabularyLearningSubmitInputSchema>;

export const VocabularyLearningSubmitOutputSchema = z.object({
  version: z.number().int(),
  updatedAt: z.string(),
  vocabularyId: z.string(),
});
export type VocabularyLearningSubmitOutput = z.infer<typeof VocabularyLearningSubmitOutputSchema>;
