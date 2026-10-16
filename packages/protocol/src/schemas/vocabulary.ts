import { z } from 'zod';
import { FlashcardSchema } from './card.js';
import { VocabularyLearningContentSchema } from '@lexdistill/document-model';
import { JlptLevelSchema } from './profile.js';

export const VocabularyScopeSchema = z.object({
  documentId: z.string().min(1).optional(),
  chapterId: z.string().min(1).optional(),
}).refine(value => !value.chapterId || !!value.documentId, '指定章节时必须同时指定教材');
export type VocabularyScope = z.infer<typeof VocabularyScopeSchema>;

const ExampleSchema = z.object({ text: z.string(), translation: z.string().optional() });
export const VocabularyEntrySchema = z.object({
  id: z.string(), word: z.string(), reading: z.string(), language: z.enum(['ja', 'en', 'ko']),
  meaning: z.string(), level: z.string().nullable(), collected: z.boolean(), cardId: z.string().optional(),
  learning: VocabularyLearningContentSchema.optional(),
  sources: z.array(z.object({
    documentId: z.string(), chapterId: z.string(), bookTitle: z.string(), chapterTitle: z.string(),
    meaning: z.string(), partOfSpeech: z.string().optional(), examples: z.array(ExampleSchema),
    usage: z.string().optional(), contextNote: z.string().optional(), source: z.enum(['TEXTBOOK', 'AI']).optional(),
    textbookVocabularyId: z.string().optional(),
  })),
});
export type VocabularyEntry = z.infer<typeof VocabularyEntrySchema>;
export const VocabularyCollectionSchema = z.object({ card: FlashcardSchema, created: z.boolean() });
export type VocabularyCollection = z.infer<typeof VocabularyCollectionSchema>;

/** 每日抽词请求：bankId 必填；order 取 random（随机）或 sequential（词库编排顺序）。 */
export const DailyPickOrderSchema = z.enum(['random', 'sequential']);
export type DailyPickOrder = z.infer<typeof DailyPickOrderSchema>;
export const DailyPickRequestSchema = z.object({
  lang: z.enum(['ja', 'en', 'ko']),
  count: z.number().int().min(1).max(50),
  order: DailyPickOrderSchema,
  bankId: z.string().min(1),
  courseUnitId: z.string().min(1).optional(),
}).strict();
export type DailyPickRequest = z.infer<typeof DailyPickRequestSchema>;

/** 每日抽词响应：locked 出现即整库被门拦下（words 为空），前端展示锁定横幅，不绕过。 */
export const DailyPickWordSchema = z.object({
  entryId: z.string(),
  headword: z.string(),
  reading: z.string().optional(),
  meanings: z.array(z.string()),
  partOfSpeech: z.string().optional(),
  sourceLabel: z.string(),
  collected: z.boolean(),
  studied: z.boolean(),
  jlpt: JlptLevelSchema.optional(),
});
export const DailyPickResponseSchema = z.object({
  words: z.array(DailyPickWordSchema),
  pick: z.object({
    bankId: z.string(),
    requested: z.number().int(),
    returned: z.number().int(),
    unlockedJlptMax: JlptLevelSchema,
    skippedLocked: z.number().int(),
  }),
});
export type DailyPickResponse = z.infer<typeof DailyPickResponseSchema>;

/** 锁库响应（HTTP 409）：words 为空，data 携带解锁进度供横幅展示。 */
export const DailyPickLockedResponseSchema = DailyPickResponseSchema.extend({
  words: z.array(DailyPickWordSchema).max(0),
  locked: z.object({
    requiredJlpt: JlptLevelSchema,
    requiredMastery: z.number(),
    currentMastery: z.number(),
  }),
  error: z.object({ code: z.literal('E_BANK_LOCKED'), userMessage: z.string() }),
  data: z.object({ requiredMastery: z.number(), currentMastery: z.number() }),
});
export type DailyPickLockedResponse = z.infer<typeof DailyPickLockedResponseSchema>;
