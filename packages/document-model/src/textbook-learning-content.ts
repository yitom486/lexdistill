import { z } from 'zod';
import { validateExercise } from './exercise-validation.js';
import { TocEntrySchema } from './toc.js';

export const JlptLevelSchema = z.enum(['N5', 'N4', 'N3', 'N2', 'N1']);
/** 每次调用返回全新实例：同一实例复用会被 JSON Schema 转换器收成内部 $ref，模型侧无法解析。结构与校验完全一致。 */
const text = () => z.string().trim().min(1);
export const TextbookExampleSchema = z.object({ text: text(), translation: text().optional() }).strict();
const origin = z.enum(['TEXTBOOK', 'AI']);
export const GrammarItemSchema = z.object({
  title: text(), kind: z.enum(['GRAMMAR', 'PRONUNCIATION', 'USAGE']).default('GRAMMAR'),
  explanation: text(), connection: text().optional(), aiExplanation: text().optional(), examples: z.array(TextbookExampleSchema).default([]),
}).strict();
export const VocabularyItemSchema = z.object({
  word: text(), reading: text().optional(), meaning: text(), level: JlptLevelSchema,
  partOfSpeech: text().optional(), pitch: text().optional(), explanation: text().optional(), examples: z.array(TextbookExampleSchema).default([]),
  usage: text().optional().describe('本课用法：常见搭配、句型与适用场合'),
  contextNote: text().optional().describe('本课取义说明：该词在本课语境中的具体含义与使用方式'),
}).strict();
export const ArticleItemSchema = z.object({ title: text().optional(), text: text(), translation: text().optional() }).strict();
export const SentenceItemSchema = z.object({ text: text(), translation: text().optional(), explanation: text().optional(), speaker: text().optional() }).strict();
export const LearningExerciseItemSchema = z.object({
  type: z.enum(['CHOICE', 'MULTI_CHOICE', 'FILL_BLANK', 'TRANSLATION', 'ORDERING', 'MATCHING', 'SHORT_ANSWER', 'WRITING']),
  prompt: text(), options: z.array(text()).optional(), left: z.array(text()).optional(), right: z.array(text()).optional(),
  answer: z.union([text(), z.array(text()).min(1), z.array(z.object({ left: text(), right: text() }).strict()).min(1)]).optional(),
  difficultyTier: z.number().int().min(1).max(5).describe('目标语种下的题目复杂度估计 1–5，不是 JLPT 或用户掌握度'),
  difficultyReason: text().describe('简述词汇、语法、阅读或表达要求的难度依据'),
  explanation: text().optional(), gradingNotes: text().optional(),
}).strict();
export const TextbookWriteSchemas = {
  grammar: z.object({ items: z.array(GrammarItemSchema).min(1), source: origin.default('TEXTBOOK') }).strict(),
  vocabulary: z.object({ items: z.array(VocabularyItemSchema).min(1) }).strict(),
  articles: z.object({ items: z.array(ArticleItemSchema).min(1), source: origin.default('TEXTBOOK') }).strict(),
  sentences: z.object({ items: z.array(SentenceItemSchema).min(1), source: origin.default('TEXTBOOK') }).strict(),
  exercises: z.object({ items: z.array(LearningExerciseItemSchema.superRefine(validateExercise)).min(1), source: origin.default('TEXTBOOK') }).strict(),
  material: z.object({ text: text() }).strict(),
} as const;
export type TextbookContentKind = keyof typeof TextbookWriteSchemas;
export type GrammarItem = z.infer<typeof GrammarItemSchema>;
export type VocabularyItem = z.infer<typeof VocabularyItemSchema>;
export type ArticleItem = z.infer<typeof ArticleItemSchema>;
export type SentenceItem = z.infer<typeof SentenceItemSchema>;
export type LearningExerciseItem = z.infer<typeof LearningExerciseItemSchema>;

/** Read contract: storage identity is added by the system, never requested from the model. */
export const TextbookLearningContentSchema = z.object({
  grammar: z.array(GrammarItemSchema.extend({ id: text(), source: origin, explanation: z.string() })),
  vocabulary: z.array(VocabularyItemSchema.omit({ level: true }).extend({ id: text(), vocabularyId: text(), meaning: z.string(), level: JlptLevelSchema.nullable(), source: origin })),
  articles: z.array(ArticleItemSchema.extend({ id: text(), source: origin })),
  sentences: z.array(SentenceItemSchema.extend({ id: text(), source: origin })),
  exercises: z.array(LearningExerciseItemSchema.extend({ id: text(), source: origin, difficultyTier: LearningExerciseItemSchema.shape.difficultyTier.nullable(), difficultyReason: text().nullable() })),
  material: z.string().nullable(),
});
export type TextbookLearningContent = z.infer<typeof TextbookLearningContentSchema>;
export const StringListSchema = z.array(z.string());
export const ChapterManifestSchema = z.array(z.object({
  id: z.string().min(1), title: z.string().min(1), order: z.number().int().positive(),
  kind: z.enum(['lesson','section']).default('lesson'),
  startPage: z.number().int().positive().nullable(), endPage: z.number().int().positive().nullable(),
  status: z.enum(['pending','ready','failed']),
  tocEntries: z.array(TocEntrySchema).min(1).optional(),
}).strict());
export type ChapterManifest = z.infer<typeof ChapterManifestSchema>;
