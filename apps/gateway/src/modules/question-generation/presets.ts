import { BusinessError } from '@lexdistill/shared';
import { GenerationBlueprintSchema, GenerationConfigSchema,
  type BankAnswerType, type BankCategory, type GenerationBlueprint, type GenerationConfig,
  type GenerationListeningMode } from '@lexdistill/protocol';
import { buildQuickPracticePreset } from './preset.js';

export interface PresetDefinition {
  id: string;
  version: string;
  promptVersion: string;
  name: string;
  description: string;
  categoryCounts: Record<BankCategory, number>;
  listeningModes?: Record<GenerationListeningMode, number> | undefined;
  allowedAnswerTypes: BankAnswerType[];
  objective: string;
}

const PRESETS: PresetDefinition[] = [
  { id: 'vocab-grammar', version: 'v1', promptVersion: 'preset-vocab-grammar-v1', name: '基础词汇语法',
    description: '词汇与语法选择填空，不含听力。',
    categoryCounts: { VOCABULARY: 3, GRAMMAR: 3, READING: 0, CLOZE: 0, LISTENING: 0, WRITING: 0 },
    allowedAnswerTypes: ['MULTIPLE_CHOICE', 'FILL_BLANK'],
    objective: '基础词汇语法六题：词汇与语法选择填空。题库复用优先，不足按额度新出后组卷。' },
  { id: 'reading-cloze', version: 'v1', promptVersion: 'preset-reading-cloze-v1', name: '阅读完型',
    description: '阅读排序、完型填空与语法巩固，不含听力。',
    categoryCounts: { VOCABULARY: 0, GRAMMAR: 1, READING: 2, CLOZE: 2, LISTENING: 0, WRITING: 0 },
    allowedAnswerTypes: ['MULTIPLE_CHOICE', 'FILL_BLANK', 'REORDER'],
    objective: '阅读完型五题：阅读排序、完型填空与语法巩固。材料问题必须能由篇章回答。' },
  { id: 'listening-focus', version: 'v1', promptVersion: 'preset-listening-focus-v1', name: '听力专项',
    description: '对话、短文、新闻听力各段，音频就绪后组卷。',
    categoryCounts: { VOCABULARY: 0, GRAMMAR: 0, READING: 0, CLOZE: 0, LISTENING: 4, WRITING: 0 },
    listeningModes: { DIALOGUE: 2, PASSAGE: 1, NEWS: 1 },
    allowedAnswerTypes: ['MULTIPLE_CHOICE', 'SHORT_ANSWER'],
    objective: '听力专项四题：对话二、短文一、新闻一，全部使用冻结双声/旁白，音频就绪后再组卷。' },
  { id: 'comprehensive', version: 'v1', promptVersion: 'quick-practice-v1', name: '综合练习',
    description: '语法、完型、阅读、三模式听力、翻译与写作全覆盖。',
    categoryCounts: { VOCABULARY: 1, GRAMMAR: 1, READING: 1, CLOZE: 1, LISTENING: 3, WRITING: 1 },
    listeningModes: { DIALOGUE: 1, PASSAGE: 1, NEWS: 1 },
    allowedAnswerTypes: ['MULTIPLE_CHOICE', 'FILL_BLANK', 'REORDER', 'SHORT_ANSWER', 'TRANSLATION', 'WRITING'],
    objective: '综合练习一张：语法选择、完型填空、阅读排序各一，对话/短文/新闻听力各一，词汇翻译与小写作各一。' },
];

export function listPresets(): PresetDefinition[] {
  return structuredClone(PRESETS);
}

export interface ResolvePresetInput {
  presetId: string;
  language: GenerationConfig['language'];
  targetLevel: GenerationConfig['targetLevel'];
  modelId: string;
  audio?: GenerationConfig['audio'] | undefined;
  categoryCounts?: Partial<Record<BankCategory, number>> | undefined;
  listeningModes?: Partial<Record<GenerationListeningMode, number>> | undefined;
}

export interface ResolvedPreset {
  presetId: string;
  presetVersion: string;
  config: GenerationConfig;
  blueprint: GenerationBlueprint;
  objective: string;
  /** 预算说明：新生成上限与最终试卷题数是两个指标。 */
  budgetNote: { newQuestionsMax: number; finalPaperItems: number };
}

/** 后端计算并验证预算：预设为基线，用户微调不得突破冻结额度，精确蓝图单独校验。 */
export function resolvePreset(input: ResolvePresetInput): ResolvedPreset {
  const preset = PRESETS.find(candidate => candidate.id === input.presetId);
  if (!preset) throw new BusinessError('E_INVALID_INPUT', `未知预设：${input.presetId}`, 'VALIDATION');
  const fullCounts = { ...preset.categoryCounts, ...input.categoryCounts } as Record<BankCategory, number>;
  const listeningCount = fullCounts.LISTENING ?? 0;
  const fullModes = listeningCount > 0 || input.listeningModes
    ? { DIALOGUE: 0, PASSAGE: 0, NEWS: 0,
      ...(listeningCount > 0 ? preset.listeningModes : {}), ...input.listeningModes } : undefined;
  const totalItems = Object.values(fullCounts).reduce((sum, count) => sum + (count ?? 0), 0);
  const blueprint = GenerationBlueprintSchema.parse({ totalItems, categoryCounts: fullCounts,
    ...(fullModes ? { listeningModes: fullModes } : {}) });
  if (fullCounts.WRITING > 0 && !preset.allowedAnswerTypes.includes('WRITING')) {
    throw new BusinessError('E_GENERATION_CONFIG', '此预设不允许写作答题格式，请使用综合练习或移除写作题。', 'VALIDATION');
  }
  const config = GenerationConfigSchema.parse({
    language: input.language, targetLevel: input.targetLevel,
    modelId: input.modelId, promptVersion: preset.promptVersion,
    maxQuestions: totalItems, categoryLimits: fullCounts,
    allowedAnswerTypes: preset.allowedAnswerTypes,
    maxDifficultyTier: 3, maxAudio: listeningCount, maxAudioAttempts: listeningCount * 3,
    maxPapers: 1, maxPaperItems: totalItems, textbookScopes: [],
    ...(listeningCount > 0 ? { audio: input.audio } : {}),
  });
  const unchanged = Object.entries(preset.categoryCounts).every(([key, value]) => fullCounts[key as BankCategory] === value)
    && Object.entries(preset.listeningModes ?? {}).every(([key, value]) => fullModes?.[key as GenerationListeningMode] === value);
  if (preset.id === 'comprehensive' && unchanged && input.audio) {
    // Only the unchanged baseline uses the quick preset; adjustments must survive resolution.
    const quick = buildQuickPracticePreset({ language: input.language, targetLevel: input.targetLevel,
      modelId: input.modelId, audio: { ...input.audio } });
    return { presetId: preset.id, presetVersion: preset.version, config: quick.config,
      blueprint: quick.blueprint, objective: preset.objective,
      budgetNote: { newQuestionsMax: quick.config.maxQuestions, finalPaperItems: quick.blueprint.totalItems } };
  }
  const objective = unchanged ? preset.objective
    : `${preset.name}：按本次精确蓝图组卷 ${totalItems} 题：${JSON.stringify(blueprint)}。题库复用优先，不足按冻结额度新出；阅读和完型题必须能由材料回答，听力音频就绪后再组卷。`;
  return { presetId: preset.id, presetVersion: preset.version, config, blueprint, objective,
    budgetNote: { newQuestionsMax: config.maxQuestions, finalPaperItems: blueprint.totalItems } };
}
