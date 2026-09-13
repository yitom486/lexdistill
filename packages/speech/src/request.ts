/**
 * 分语言朗读请求规约器：把（文本、轨道、用途、偏好）收敛为引擎可直接执行的请求。
 * 含分语言 BCP47、用途语速、性别基调、人设名线索与神经引擎风格提示。
 */
import { voiceNameHints } from './voice-match.js';
import type {
  TtsGender,
  TtsPurpose,
  TtsSpeakInput,
  TtsSpeakRequest,
  TtsTrackLanguage,
} from './types.js';

/** 轨道归一化（大小写/常见变体均可，未知回退 en）。 */
export function normalizeTtsTrackLanguage(raw: unknown): TtsTrackLanguage {
  const t = String(typeof raw === 'string' ? raw : '').toLowerCase();
  if (t === 'ja' || t === 'jp' || t === 'jpn' || t === 'japanese') return 'ja';
  if (t === 'ko' || t === 'kr' || t === 'kor' || t === 'korean') return 'ko';
  return 'en';
}

export function bcp47ForTrack(trackLanguage: TtsTrackLanguage): string {
  if (trackLanguage === 'ja') return 'ja-JP';
  if (trackLanguage === 'ko') return 'ko-KR';
  return 'en-US';
}

/** 用途默认语速（听写更慢、预览稍快；调用方显式 rate 优先）。 */
const PURPOSE_DEFAULT_RATE: Record<TtsPurpose, number> = {
  preview: 0.95,
  reading: 0.9,
  dictation: 0.75,
  tutor: 0.9,
  flashcard: 0.9,
  general: 0.9,
};

/** 分语言神经朗读风格提示（调用方可覆盖；Web Speech 引擎忽略本字段）。 */
export const TTS_STYLE_PROMPTS: Record<TtsTrackLanguage, string> = {
  en: 'Read in clear academic English with natural rhythm, in a friendly tutor tone.',
  ja: '明るく聞き取りやすい日本語で、文節を意識してはっきりと読んでください。',
  ko: '또박또박 밝은 목소리로 자연스럽게 읽어 주세요.',
};

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return PURPOSE_DEFAULT_RATE.general;
  return Math.min(1.5, Math.max(0.5, rate));
}

export function resolveTtsSpeakRequest(input: TtsSpeakInput): TtsSpeakRequest {
  const trackLanguage = normalizeTtsTrackLanguage(input.trackLanguage);
  const purpose = input.purpose ?? 'general';
  const gender: TtsGender = input.prefs?.gender ?? 'FEMALE';
  const personaName =
    typeof input.prefs?.personaName === 'string' && input.prefs.personaName
      ? input.prefs.personaName
      : undefined;
  const voiceMatchNames = [
    ...(personaName ? [personaName.toLowerCase()] : []),
    ...voiceNameHints(trackLanguage, gender),
  ];
  return {
    utteranceText: input.text,
    bcp47: bcp47ForTrack(trackLanguage),
    trackLanguage,
    rate: clampRate(input.prefs?.rate ?? PURPOSE_DEFAULT_RATE[purpose]),
    pitch: input.prefs?.pitch ?? (gender === 'FEMALE' ? 1.08 : 0.88),
    voiceMatchNames,
    ...(input.prefs?.preferredVoiceURI ? { preferredVoiceURI: input.prefs.preferredVoiceURI } : {}),
    ...(personaName ? { personaName } : {}),
    neural: {
      ...(input.neural?.voiceId ? { voiceId: input.neural.voiceId } : {}),
      stylePrompt: input.neural?.stylePrompt ?? TTS_STYLE_PROMPTS[trackLanguage],
    },
    context: { trackLanguage, purpose, gender },
  };
}
