/**
 * 分语言音色名线索与纯打分器（自 Web 端 `SpeechStudioEngine` 迁移而来，行为不变）。
 * 输入为平台无关的 `TtsVoiceDescriptor`，可在单测中直接断言。
 */
import type { TtsGender, TtsTrackLanguage, TtsVoiceDescriptor } from './types.js';

/** 各语种具名音色线索（小写子串匹配）。 */
const FEMALE_HINTS: Record<TtsTrackLanguage, string[]> = {
  en: ['jenny', 'zira', 'susan', 'samantha', 'aria', 'michelle', 'sara', 'hazel', 'catherine', 'sonia'],
  ja: ['nanami', 'kyoko'],
  ko: ['sunhi', 'yuna', 'heami'],
};

const MALE_HINTS: Record<TtsTrackLanguage, string[]> = {
  en: ['guy', 'david', 'mark', 'daniel', 'james', 'george', 'ryan', 'christopher', 'eric', 'andrew', 'thomas', 'steffan', 'brian', 'ravi'],
  ja: ['keita', 'otoya', 'ichiro'],
  ko: ['injoon', 'bongjin'],
};

const GENERIC_FEMALE_HINTS = ['female', 'woman', 'girl', '女士', '女声'];
const GENERIC_MALE_HINTS = ['male', 'man', 'boy', '男声', '男士'];

/** 男声候选命中以下名字时重罚（多为云端默认女声）。 */
const MALE_PENALTY_NAMES = ['jenny', 'zira', 'aria'];

/** 指定语种 + 性别的全部匹配线索（含通用线索）。 */
export function voiceNameHints(trackLanguage: TtsTrackLanguage, gender: TtsGender): string[] {
  const specific = gender === 'FEMALE' ? FEMALE_HINTS[trackLanguage] : MALE_HINTS[trackLanguage];
  const generic = gender === 'FEMALE' ? GENERIC_FEMALE_HINTS : GENERIC_MALE_HINTS;
  return [...specific, ...generic];
}

/** 与 `voiceNameHints` 同源的打分器：命中 +100，反串 −120，本地音色 +15。 */
export function scoreVoiceName(
  voice: Pick<TtsVoiceDescriptor, 'name' | 'localService'>,
  trackLanguage: TtsTrackLanguage,
  gender: TtsGender
): number {
  const name = voice.name.toLowerCase();
  const own = voiceNameHints(trackLanguage, gender);
  const opposite = voiceNameHints(trackLanguage, gender === 'FEMALE' ? 'MALE' : 'FEMALE');

  let score = 0;
  for (const kw of own) {
    if (name.includes(kw)) score += 100;
  }
  for (const kw of opposite) {
    if (name.includes(kw)) score -= 120;
  }

  // 本地桌面音色通常比单一云端音色更易分出男女
  if (voice.localService) score += 15;
  // 避免把含 Neural 但未点名的默认云端女声当男声高分
  if (gender === 'MALE' && MALE_PENALTY_NAMES.some((kw) => name.includes(kw))) {
    score -= 200;
  }
  return score;
}

/** 在候选中按性别挑最优（无正向线索且要男声时，尽量避开高分女声名）。 */
export function pickBestVoiceName(
  voices: TtsVoiceDescriptor[],
  trackLanguage: TtsTrackLanguage,
  gender: TtsGender
): TtsVoiceDescriptor | null {
  if (voices.length === 0) return null;
  let best: TtsVoiceDescriptor | null = null;
  let bestScore = -Infinity;
  for (const v of voices) {
    const s = scoreVoiceName(v, trackLanguage, gender);
    if (s > bestScore) {
      bestScore = s;
      best = v;
    }
  }
  if (best && bestScore <= 0 && gender === 'MALE') {
    const ranked = [...voices].sort(
      (a, b) => scoreVoiceName(b, trackLanguage, gender) - scoreVoiceName(a, trackLanguage, gender)
    );
    return ranked[0] ?? best;
  }
  return best ?? voices[0] ?? null;
}
