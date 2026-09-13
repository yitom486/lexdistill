/**
 * 谚文字节律分解/合成（clean-room：Unicode 谚文音节块公开算法实现，未复制任何外部代码）。
 *
 * U+AC00 起 11172 个音节 = 初声(19) × 中声(21) × 终声(28) 的规则排列，
 * 分解与合成均为纯算术。不规则活用还原用它做词干末音变（ㅂ→우、ㄷ→ㄹ 等）。
 */

export interface HangulSyllable {
  cho: string;
  jung: string;
  jong: string;
  raw: string;
}

const CHOSEONG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];

const JUNGSEONG = [
  'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ',
  'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ',
];

const JONGSEONG = [
  '', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ',
  'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];

const HANGUL_BASE = 0xac00;
const HANGUL_END = 0xd7a3;

export function isHangulSyllable(ch: string): boolean {
  if (!ch) return false;
  const code = ch.codePointAt(0) ?? 0;
  return code >= HANGUL_BASE && code <= HANGUL_END;
}

/** 音节 → 初/中/终声（非音节返回 null，不抛）。 */
export function decomposeSyllable(ch: string): HangulSyllable | null {
  if (!isHangulSyllable(ch)) return null;
  const code = (ch.codePointAt(0) ?? HANGUL_BASE) - HANGUL_BASE;
  const jongIndex = code % 28;
  const jungIndex = Math.floor(code / 28) % 21;
  const choIndex = Math.floor(code / (28 * 21));
  return {
    cho: CHOSEONG[choIndex] ?? '',
    jung: JUNGSEONG[jungIndex] ?? '',
    jong: JONGSEONG[jongIndex] ?? '',
    raw: ch,
  };
}

/** 初/中/终声 → 音节（非法组合返回空串，不抛）。 */
export function composeSyllable(cho: string, jung: string, jong = ''): string {
  const choIndex = CHOSEONG.indexOf(cho);
  const jungIndex = JUNGSEONG.indexOf(jung);
  const jongIndex = JONGSEONG.indexOf(jong);
  if (choIndex < 0 || jungIndex < 0 || jongIndex < 0) return '';
  return String.fromCodePoint(HANGUL_BASE + (choIndex * 21 + jungIndex) * 28 + jongIndex);
}
