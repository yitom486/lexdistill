import type { PracticeBlockKind, GradingMode } from '@study-studio/protocol';

export const BLOCK_KINDS: PracticeBlockKind[] = [
  'VOCAB_REVIEW',
  'VOCAB_NEW',
  'QUIZ',
  'TRANSLATION',
  'DICTATION',
  'READING',
  'CLOZE',
  'WRITING',
];
/** 块类型中文名（界面只展示中文，存库仍用枚举值） */
export const BLOCK_KIND_LABELS: Record<PracticeBlockKind, string> = {
  VOCAB_REVIEW: '到期复习',
  VOCAB_NEW: '新词学习',
  QUIZ: '综合做题',
  TRANSLATION: '翻译练习',
  DICTATION: '听写练习',
  READING: '阅读理解',
  WRITING: '写作练习',
  CLOZE: '完形填空',
};
export const GRADING_MODES: GradingMode[] = ['AUTO_IMMEDIATE', 'AI_IMMEDIATE', 'AI_BATCH'];
/** 批改方式中文名 */
export const GRADING_MODE_LABELS: Record<GradingMode, string> = {
  AUTO_IMMEDIATE: '即时判定',
  AI_IMMEDIATE: 'AI 即时批改',
  AI_BATCH: 'AI 批量批改',
};
/** 翻译方向语言选项（存库仍用 zh/en/ja/ko 代码） */
export const TRANSLATION_LANG_OPTIONS = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: '英语' },
  { value: 'ja', label: '日语' },
  { value: 'ko', label: '韩语' },
];
export const VOCAB_KINDS = new Set<PracticeBlockKind>(['VOCAB_REVIEW', 'VOCAB_NEW']);
