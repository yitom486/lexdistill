import type { PracticeBlockSpec } from '@study-studio/protocol';

export function buildBalancedPracticeBlocks(language: 'en' | 'ja' | 'ko'): PracticeBlockSpec[] {
  const prefix = language === 'ja' ? 'jp' : language;
  return [
    { id: 'balanced_vocab', kind: 'VOCAB_REVIEW', title: '词汇巩固', count: 5, gradingMode: 'AUTO_IMMEDIATE', vocabularySource: 'DUE_CARDS' },
    { id: 'balanced_grammar', kind: 'QUIZ', title: '语法理解', count: 5, gradingMode: 'AUTO_IMMEDIATE' },
    { id: 'balanced_reading', kind: 'READING', title: '阅读理解', count: 3, gradingMode: 'AUTO_IMMEDIATE' },
    { id: 'balanced_cloze', kind: 'CLOZE', title: '完形填空', count: 3, gradingMode: 'AUTO_IMMEDIATE', skillIds: [`${prefix}.reading.cloze`] },
    { id: 'balanced_listening', kind: 'DICTATION', title: '精听听写', count: 3, gradingMode: 'AUTO_IMMEDIATE' },
    { id: 'balanced_writing', kind: 'WRITING', title: '短文写作', count: 1, gradingMode: 'AI_IMMEDIATE' },
  ];
}
