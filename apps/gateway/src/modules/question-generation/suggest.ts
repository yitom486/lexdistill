import type { GenerationConfig } from '@study-studio/protocol';

export type SuggestionBasis = 'user-selection' | 'user-profile' | 'authorized-textbooks' | 'recent-mistakes' | 'visible-default';

export interface PresetSuggestion {
  language: GenerationConfig['language'];
  languageBasis: SuggestionBasis;
  /** 轨道默认值，非能力推断；用户确认后生效。 */
  targetLevel: string;
  targetLevelBasis: SuggestionBasis;
  presetId: string;
  presetBasis: SuggestionBasis;
  textbookCount: number;
  reasons: string[];
}

export interface SuggestionSources {
  requestedLanguage?: GenerationConfig['language'] | undefined;
  profileLanguage: string | null;
  unresolvedMistakeSkillIds: string[];
  textbookCount: number;
}

const DEFAULT_LEVEL: Record<GenerationConfig['language'], string> = { ja: 'N5', en: 'A1', ko: 'TOPIK_1' };

/**
 * P4 智能建议：只读本次可验证事实，不做复杂画像，不虚构能力水平。
 * - 语言：当前学习轨道优先，其次画像目标语种，最后显式英语默认值；
 * - 等级：一律轨道默认值并明确标注非推断；
 * - 预设：未解决的听力错题存在则听力专项，否则综合练习。
 */
export function suggestPreset(sources: SuggestionSources): PresetSuggestion {
  const profileLanguage = sources.profileLanguage === 'ja' || sources.profileLanguage === 'ko' || sources.profileLanguage === 'en'
    ? sources.profileLanguage : null;
  const language = sources.requestedLanguage ?? profileLanguage ?? 'en';
  const languageBasis: SuggestionBasis = sources.requestedLanguage ? 'user-selection' : profileLanguage ? 'user-profile' : 'visible-default';
  const listeningMistakes = sources.unresolvedMistakeSkillIds.filter(skill => skill === `${language}.listening` || skill.startsWith(`${language}.listening.`));
  const hasListeningMistakes = listeningMistakes.length > 0;
  const reasons = [
    `语言 ${language}（${languageBasis === 'user-selection' ? '当前学习轨道' : languageBasis === 'user-profile' ? '画像目标语种' : '画像缺失，用可见默认值'}）`,
    `等级 ${DEFAULT_LEVEL[language]}（轨道默认值，非能力推断，需你确认）`,
    hasListeningMistakes
      ? `预设听力专项（有未解决的听力错题 ${listeningMistakes.length} 项）`
      : '预设综合练习（无定向弱项信号，用可见默认值）',
    `授权教材 ${sources.textbookCount} 本（本语种用户文档数）`,
  ];
  return { language, languageBasis, targetLevel: DEFAULT_LEVEL[language], targetLevelBasis: 'visible-default',
    presetId: hasListeningMistakes ? 'listening-focus' : 'comprehensive', presetBasis: hasListeningMistakes ? 'recent-mistakes' : 'visible-default',
    textbookCount: sources.textbookCount, reasons };
}
