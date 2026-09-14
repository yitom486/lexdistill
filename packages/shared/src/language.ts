/** 学习轨道语种（由 drizzle-learner-repository.ts 搬迁而来，行为不变）。 */

export type TrackLanguage = 'ja' | 'en' | 'ko';

export function normalizeTrackLanguage(raw: string | null | undefined): TrackLanguage {
  const v = (raw || '').toLowerCase();
  if (v === 'en' || v === 'eng') return 'en';
  if (v === 'ko' || v === 'kr') return 'ko';
  if (v === 'ja' || v === 'jp') return 'ja';
  return 'en';
}

export function inferLanguageFromSkillId(skillId: string): TrackLanguage {
  if (skillId.startsWith('en.')) return 'en';
  if (skillId.startsWith('ko.')) return 'ko';
  return 'ja';
}
