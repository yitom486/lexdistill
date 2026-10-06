import { z } from 'zod';

export const CardTypeSchema = z.enum(['VOCABULARY', 'GRAMMAR', 'CONFUSION_PAIR', 'SENTENCE']);
export type CardType = z.infer<typeof CardTypeSchema>;

export const CardReviewRatingSchema = z.enum(['AGAIN', 'HARD', 'GOOD', 'EASY']);
export type CardReviewRating = z.infer<typeof CardReviewRatingSchema>;

export const CardReviewPayloadSchema = z.object({
  cardId: z.string(),
  rating: CardReviewRatingSchema,
  timeSpentMs: z.number().nonnegative(),
});
export type CardReviewPayload = z.infer<typeof CardReviewPayloadSchema>;

export const FlashcardSchema = z.object({
  id: z.string(),
  userId: z.string(),
  type: CardTypeSchema,
  front: z.string(),
  back: z.string(),
  phonetic: z.string().optional(),
  audioUrl: z.string().optional(),
  /** 词典来源条目 id（词典收藏卡才有；卡面点词弹窗可凭此精确回查完整条目）。 */
  sourceEntryId: z.string().optional(),
  vocabularyId: z.string().optional(),
  language: z.enum(['ja', 'en', 'ko']).optional(),
  partOfSpeech: z.string().optional(),
  examples: z.array(z.object({ text: z.string(), translation: z.string().optional() })).optional(),
  tags: z.array(z.string()),
  /** 讲透时间（M2 学习门：NEW 卡须先讲透才进练习池；review 首刷不强制）。 */
  studiedAt: z.string().optional(),
  fsrs: z.object({
    stability: z.number(),
    difficulty: z.number(),
    reps: z.number(),
    lapses: z.number(),
    lastReviewedAt: z.string().optional(),
    dueAt: z.string(),
    state: z.enum(['NEW', 'LEARNING', 'REVIEW', 'RELEARNING']),
  }),
});
export type Flashcard = z.infer<typeof FlashcardSchema>;
