import type { HangulItem } from '@study-studio/protocol';

export type MatrixTab = 'CONSONANT' | 'VOWEL' | 'ADVANCED';
export type DrillMode = 'AUDIO_TO_JAMO' | 'JAMO_TO_ROMA' | 'MIXED' | 'WORD_DICTATION' | 'WORD_MEANING';
export type RecognitionMode = 'AUDIO_TO_JAMO' | 'JAMO_TO_ROMA';

export const RECOGNITION_MODES: RecognitionMode[] = ['AUDIO_TO_JAMO', 'JAMO_TO_ROMA'];
/** 题量档（0 = 全部）。 */
export const DRILL_COUNTS = [10, 20, 0];

export const DRILL_MODE_LABELS: Record<DrillMode, string> = {
  AUDIO_TO_JAMO: '听音辨字',
  JAMO_TO_ROMA: '看字辨音',
  MIXED: '综合混合',
  WORD_DICTATION: '听写选词',
  WORD_MEANING: '词义回想',
};

export function drillCountLabel(count: number): string {
  return count === 0 ? '全部' : `${count} 题`;
}

export function shuffle<T>(list: T[]): T[] {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = a;
  }
  return arr;
}

/** 同类池内取 3 个异项作干扰（按 sortOrder 就近优先，保证选项有迷惑性）。 */
export function pickDistractors(target: HangulItem, pool: HangulItem[]): HangulItem[] {
  const others = pool.filter((h) => h.id !== target.id);
  others.sort((a, b) => Math.abs(a.sortOrder - target.sortOrder) - Math.abs(b.sortOrder - target.sortOrder));
  return shuffle(others.slice(0, Math.min(6, others.length))).slice(0, 3);
}

/** 进阶三类统一回写 ko.hangul.compound（与网关 skill 映射同源）。 */
export function scriptTypeFor(item: HangulItem): 'CONSONANT' | 'VOWEL' | 'COMPOUND' {
  return item.type === 'CONSONANT' ? 'CONSONANT' : item.type === 'VOWEL' ? 'VOWEL' : 'COMPOUND';
}
