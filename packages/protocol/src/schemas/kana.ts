import { z } from 'zod';

export const KanaTypeSchema = z.enum([
  'SEION',       // 清音 (46)
  'DAKUON',      // 浊音 (20)
  'HANDAKUON',   // 半浊音 (5)
  'YOON',        // 拗音 (36)
  'SPECIAL',     // 拨音/促音
]);
export type KanaType = z.infer<typeof KanaTypeSchema>;

export const KanaExampleWordSchema = z.object({
  word: z.string().min(1),
  reading: z.string().min(1),
  meaning: z.string().min(1),
});
export type KanaExampleWord = z.infer<typeof KanaExampleWordSchema>;

export const KanaScriptLearningGuideSchema = z.object({
  shapeFeatures: z.array(z.string().min(1)).min(2).max(4),
  memoryTip: z.string().min(1),
  recognitionCue: z.string().min(1),
  contrasts: z.array(z.object({
    kana: z.string().min(1),
    romaji: z.string().min(1),
    difference: z.string().min(1),
  })).min(1).max(3),
  recallQuestion: z.string().min(1),
  recallAnswer: z.string().min(1),
  exampleWords: z.array(KanaExampleWordSchema).max(3),
});
export type KanaScriptLearningGuide = z.infer<typeof KanaScriptLearningGuideSchema>;

/**
 * 假名点击后的基础小讲义。
 * 这些是稳定的课程事实与可替换的记忆联想；个性化追问仍交给 AI 导师。
 */
export const KanaLearningGuideSchema = z.object({
  soundDescription: z.string().min(1),
  memoryTip: z.string().min(1),
  pronunciationTip: z.string().min(1),
  confusionNotes: z.string().min(1).optional(),
  exampleWords: z.array(KanaExampleWordSchema).max(3).optional(),
  scripts: z.object({
    hiragana: KanaScriptLearningGuideSchema,
    katakana: KanaScriptLearningGuideSchema,
  }).optional(),
});
export type KanaLearningGuide = z.infer<typeof KanaLearningGuideSchema>;

export const KanaItemSchema = z.object({
  id: z.string(),
  type: KanaTypeSchema,
  hiragana: z.string(),
  katakana: z.string(),
  romaji: z.string(),
  row: z.string(), // あ行, か行...
  col: z.string(), // あ段, い段...
  mnemonic: z.string().optional(), // 兼容旧版字源/简短助记
  learningGuide: KanaLearningGuideSchema.optional(),
  audioText: z.string(),
  sortOrder: z.number().int(),
});
export type KanaItem = z.infer<typeof KanaItemSchema>;

export const KanaPracticeInputSchema = z.object({
  kanaId: z.string(),
  isCorrect: z.boolean(),
  scriptType: z.enum(['HIRAGANA', 'KATAKANA', 'ROMAJI']).default('HIRAGANA'),
  timeSpentMs: z.number().nonnegative().default(0),
});
export type KanaPracticeInput = z.infer<typeof KanaPracticeInputSchema>;
