export type MatrixTab = 'SEION' | 'DAKUON_HANDAKUON' | 'YOON';
export type ScriptDisplayMode = 'HIRAGANA' | 'KATAKANA' | 'BOTH';
export type DrillMode = 'AUDIO_TO_KANA' | 'KANA_TO_ROMAJI' | 'HIRA_TO_KATA' | 'WORD_DICTATION' | 'WORD_MEANING' | 'MIXED';
export type RecognitionMode = 'AUDIO_TO_KANA' | 'KANA_TO_ROMAJI' | 'HIRA_TO_KATA';
export const KANA_COLUMN_CLASSES: Record<string, string> = {
    あ段: 'col-start-1', い段: 'col-start-2', う段: 'col-start-3', え段: 'col-start-4', お段: 'col-start-5',
};
