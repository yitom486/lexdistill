import { GenerationBlueprintSchema, GenerationConfigSchema,
  type BankCategory, type GenerationBlueprint, type GenerationConfig, type GenerationListeningMode } from '@study-studio/protocol';

/**
 * P3 单一快速预设“综合练习”（P4 再扩展版本化预设族）。
 * 覆盖选择/填空/排序客观与短答/翻译/写作主观，以及对话/短文/新闻三种听力，
 * 既是最小端到端流程，也是听力播放三模式的验收载体。
 */
export interface QuickPracticePresetInput {
  language: GenerationConfig['language'];
  targetLevel: GenerationConfig['targetLevel'];
  modelId: string;
  audio: NonNullable<GenerationConfig['audio']>;
}

const CATEGORY_COUNTS: Record<BankCategory, number> = {
  VOCABULARY: 1, GRAMMAR: 1, READING: 1, CLOZE: 1, LISTENING: 3, WRITING: 1,
};
const LISTENING_MODES: Record<GenerationListeningMode, number> = { DIALOGUE: 1, PASSAGE: 1, NEWS: 1 };

export function buildQuickPracticePreset(input: QuickPracticePresetInput): {
  config: GenerationConfig; blueprint: GenerationBlueprint; objective: string;
} {
  const blueprint = GenerationBlueprintSchema.parse({
    totalItems: 8, categoryCounts: { ...CATEGORY_COUNTS }, listeningModes: { ...LISTENING_MODES },
  });
  const config = GenerationConfigSchema.parse({
    language: input.language, targetLevel: input.targetLevel,
    modelId: input.modelId, promptVersion: 'quick-practice-v1',
    maxQuestions: 8, categoryLimits: { ...CATEGORY_COUNTS },
    allowedAnswerTypes: ['MULTIPLE_CHOICE', 'FILL_BLANK', 'REORDER', 'SHORT_ANSWER', 'TRANSLATION', 'WRITING'],
    maxDifficultyTier: 3, maxAudio: 3, maxAudioAttempts: 9, maxPapers: 1, maxPaperItems: 8,
    textbookScopes: [], audio: { ...input.audio },
  });
  return { config, blueprint,
    objective: '综合练习一张：语法选择、完型填空、阅读排序各一，对话/短文/新闻听力各一，词汇翻译与小写作各一。先读配置，按需用题库复用补足，不足再按额度新出；听力音频就绪后再组卷。' };
}
