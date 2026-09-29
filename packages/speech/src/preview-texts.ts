/**
 * TTS 内置试音文案（领域 SSOT）。
 *
 * 由网关 `/api/tts-studio/defaults` 原样下发，前端只负责运行时拉取与展示，
 * 不得在前端复刻第二份拷贝。文案按 TTS 轨道（`TtsTrackLanguage`）索引。
 */
import type { TtsTrackLanguage } from './types.js';

export const TTS_PREVIEW_TEXTS: Record<TtsTrackLanguage, string> = {
  ja: 'こんにちは、はじめまして。今日も楽しく学びましょう。',
  en: 'Hello, nice to meet you! Listen to how natural this voice sounds.',
  ko: '안녕하세요, 만나서 반갑습니다. 오늘도 즐겁게 배워요.',
};

export function previewTextForTrack(track: TtsTrackLanguage): string {
  return TTS_PREVIEW_TEXTS[track];
}
