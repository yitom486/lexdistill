/**
 * 目标语种轨道 UI 壳层核心配置 (LearningShell SSOT)
 * 决定导航入口可见性、Tab 允许集、特性开关、文案偏置与默认阅读语言。
 */
import type { NavigationTab } from '../stores/useStudySessionStore.js';

export type TrackLanguage = 'ja' | 'en' | 'ko';

export interface LearningShellComingSoonModule {
  tab: NavigationTab;
  label: string;
  hint: string;
  icon: 'PenLine' | 'Headphones' | 'BookOpen';
}

export interface LearningShellConfig {
  track: TrackLanguage;
  trackName: string;
  /** 侧栏导航与路由允许挂载的 Tab 集合 */
  allowedTabs: NavigationTab[];
  /** 语种特性与扩展开关 */
  featureFlags: {
    kanaStudio: boolean;
    hangulStudio: boolean;
    pitchAccent: boolean;
    furiganaToggle: boolean;
    englishNewsMultiSource: boolean;
    koreanInterim: boolean;
  };
  /** 学习域文案偏置（保持 zh-CN Chrome 界面母语，仅调整学习术语与提示） */
  copy: {
    levelSchemeLabel: string; // 例如「CEFR / 考研分段」或「JLPT 能力考」
    emptySkillsHint: string;
    targetWeaknessLabel: string;
    readingEmptyHint: string;
    quizEmptyHint: string;
    /** Wave G4：轨道 interim 顶栏提示；缺省不展示 */
    interimBanner?: string;
  };
  /**
   * 当前轨道暂未开放、侧栏灰显的模块（如韩语写作/听力）
   * 点击仅 toast 说明，不切换 Tab
   */
  comingSoonModules: LearningShellComingSoonModule[];
  /** 双源阅读默认语言 */
  defaultReadingLang: 'JA' | 'EN' | 'KO';
  /** 非法 Tab 自动跳回的降级兜底 Tab */
  fallbackTab: NavigationTab;
}

export const LEARNING_SHELL_CONFIGS: Record<TrackLanguage, LearningShellConfig> = {
  en: {
    track: 'en',
    trackName: '英语',
    allowedTabs: ['TODAY', 'PRACTICE_PLAN', 'QUIZ', 'CARDS', 'READING', 'WRITING', 'MISTAKES', 'RADAR'],
    featureFlags: {
      kanaStudio: false,
      hangulStudio: false,
      pitchAccent: false,
      furiganaToggle: false,
      englishNewsMultiSource: true,
      koreanInterim: false,
    },
    copy: {
      levelSchemeLabel: 'CEFR / 考研分段',
      emptySkillsHint: '暂无英语技能评测记录 · 开始自适应做题后系统将自动构建真实能力画像',
      targetWeaknessLabel: '考研/六级核心难点',
      readingEmptyHint: '暂无英语篇目，点击右上角生成或拉取最新外媒新闻',
      quizEmptyHint: '暂无英语示范题 · 可点「AI 针对弱项出题」组卷',
    },
    comingSoonModules: [],
    defaultReadingLang: 'EN',
    fallbackTab: 'TODAY',
  },
  ja: {
    track: 'ja',
    trackName: '日语',
    allowedTabs: [
      'TODAY',
      'PRACTICE_PLAN',
      'QUIZ',
      'CARDS',
      'READING',
      'WRITING',
      'TEXTBOOK',
      'SHADOWING',
      'PITCH',
      'KANA',
      'MISTAKES',
      'RADAR',
    ],
    featureFlags: {
      kanaStudio: true,
      hangulStudio: false,
      pitchAccent: true,
      furiganaToggle: true,
      englishNewsMultiSource: false,
      koreanInterim: false,
    },
    copy: {
      levelSchemeLabel: 'JLPT 能力考',
      emptySkillsHint: '暂无日语技能评测记录 · 开始自适应做题后系统将自动构建真实能力画像',
      targetWeaknessLabel: 'JLPT 核心语法与助词',
      readingEmptyHint: '暂无日语篇目，点击右上角生成或拉取 NHK 新闻',
      quizEmptyHint: '暂无日语示范题 · 可点「AI 针对弱项出题」组卷',
    },
    comingSoonModules: [],
    defaultReadingLang: 'JA',
    fallbackTab: 'TODAY',
  },
  ko: {
    track: 'ko',
    trackName: '韩语',
    allowedTabs: ['TODAY', 'PRACTICE_PLAN', 'QUIZ', 'CARDS', 'READING', 'HANGUL', 'MISTAKES', 'RADAR'],
    featureFlags: {
      kanaStudio: false,
      hangulStudio: true,
      pitchAccent: false,
      furiganaToggle: false,
      englishNewsMultiSource: false,
      koreanInterim: true,
    },
    copy: {
      levelSchemeLabel: 'TOPIK (interim 预研)',
      emptySkillsHint: '暂无韩语技能评测记录 · 做题后将按 TOPIK 考点构建画像',
      targetWeaknessLabel: 'TOPIK 核心词汇与句式',
      readingEmptyHint: '韩语篇目骨架已接入 · 空列表时可点生成；完整 TOPIK 题库仍在筹备',
      quizEmptyHint: '暂无韩语示范题 · 可点「AI 针对弱项出题」从内容模板组卷',
      interimBanner:
        '韩语轨道为 TOPIK interim：写作/听力仍在筹备；阅读新闻已接联合新闻等公开韩语源（原文摘录失败则回退摘要）。',
    },
    comingSoonModules: [
      {
        tab: 'WRITING',
        label: '写作翻译',
        hint: 'TOPIK 写作批改筹备中，敬请期待',
        icon: 'PenLine',
      },
      {
        tab: 'SHADOWING',
        label: '听力跟读',
        hint: '韩语听力材料接入前暂不可用',
        icon: 'Headphones',
      },
    ],
    defaultReadingLang: 'KO',
    fallbackTab: 'TODAY',
  },
};

export function normalizeTrackLanguage(lang: string | undefined | null): TrackLanguage {
  if (lang === 'ja' || lang === 'jp') return 'ja';
  if (lang === 'ko' || lang === 'kr') return 'ko';
  // 产品初期默认英语轨道
  return 'en';
}

export function getLearningShellConfig(track: string | undefined | null): LearningShellConfig {
  const normalized = normalizeTrackLanguage(track);
  return LEARNING_SHELL_CONFIGS[normalized];
}

/**
 * 语境化 Tab 守卫：非法 Tab 不一律跳 fallbackTab，而是按模块语义跳最近的合法工作台。
 * - JA/KO 专属页（KANA/PITCH/TEXTBOOK/SHADOWING/HANGUL）在异轨道 → 跳回做题；
 * - KO 未开放的写作/跟读 → 跳回阅读；
 * - 其余非法 Tab → 轨道 fallbackTab。
 */
export function resolveGuardTab(track: TrackLanguage, activeTab: NavigationTab): NavigationTab {
  if (activeTab === 'SETTINGS') return activeTab;
  const config = LEARNING_SHELL_CONFIGS[track];
  if (config.allowedTabs.includes(activeTab)) return activeTab;
  if (activeTab === 'KANA' || activeTab === 'HANGUL' || activeTab === 'PITCH' || activeTab === 'TEXTBOOK' || activeTab === 'SHADOWING') {
    return 'QUIZ';
  }
  if (activeTab === 'WRITING') {
    return 'READING';
  }
  return config.fallbackTab;
}
