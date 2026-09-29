import type { SupportedLanguage } from '../utils/audio.js';
import type { TrackLanguage } from '../learning/learning-shell.js';

export function trackToSpeechLang(track: TrackLanguage | string | null | undefined): SupportedLanguage {
  const value = (track || '').toLowerCase();
  if (value === 'en' || value === 'eng') return 'EN';
  if (value === 'ko' || value === 'kr') return 'KO';
  if (value === 'ja' || value === 'jp') return 'JA';
  return 'EN';
}
