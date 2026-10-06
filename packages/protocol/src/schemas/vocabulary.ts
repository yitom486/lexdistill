import { z } from 'zod';
import { FlashcardSchema } from './card.js';
import { VocabularyLearningContentSchema } from '@study-studio/document-model';

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
  })),
});
export type VocabularyEntry = z.infer<typeof VocabularyEntrySchema>;
export const VocabularyCollectionSchema = z.object({ card: FlashcardSchema, created: z.boolean() });
export type VocabularyCollection = z.infer<typeof VocabularyCollectionSchema>;
