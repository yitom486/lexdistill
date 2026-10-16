/**
 * 假名混淆干扰项（从当前题池实时推导）。
 * 保留少量高价值近邻，再从同段与跨行候选中随机补齐，避免选项退化为固定的相邻三格。
 * 候选一律取自题池现存字面，绝不臆造选项。
 */
import type { KanaItem } from '@lexdistill/protocol';

export type KanaScript = 'HIRAGANA' | 'KATAKANA';

const HIRA_MIN = 0x3041;
const HIRA_MAX = 0x3096;
const KATA_MIN = 0x30a1;
const KATA_MAX = 0x30f6;

function inKanaBlock(code: number): boolean {
  return (code >= HIRA_MIN && code <= HIRA_MAX) || (code >= KATA_MIN && code <= KATA_MAX);
}

const VOICED_MARK = '\u3099';
const SEMI_VOICED_MARK = '\u309A';

function composeVoicedBase(base: string, mark: string): string | undefined {
  const composed = (base + mark).normalize('NFC');
  // 无对应的预组字符时，NFC 会保留组合音标；这不是可用的浊音变体。
  return Array.from(composed).length === 1 ? composed : undefined;
}

/**
 * 获取真实的浊音/半浊音对应项。
 * 使用 Unicode 分解/合成，而不是用相邻码点猜测，避免把「あ/う」误判成「い」的变体。
 */
export function voicingVariants(ch: string): string[] {
  const chars = Array.from(ch);
  const first = chars[0];
  if (!first || !inKanaBlock(first.codePointAt(0) ?? -1)) return [];

  const suffix = chars.slice(1).join('');
  const decomposed = Array.from(first.normalize('NFD'));
  const base = decomposed[0];
  const mark = decomposed[1];
  if (!base) return [];

  const firstVariants: string[] = [];
  if (mark === VOICED_MARK || mark === SEMI_VOICED_MARK) {
    firstVariants.push(base);
    const otherMark = mark === VOICED_MARK ? SEMI_VOICED_MARK : VOICED_MARK;
    const otherVariant = composeVoicedBase(base, otherMark);
    if (otherVariant) firstVariants.push(otherVariant);
  } else {
    for (const candidateMark of [VOICED_MARK, SEMI_VOICED_MARK]) {
      const variant = composeVoicedBase(first, candidateMark);
      if (variant) firstVariants.push(variant);
    }
  }

  return [...new Set(firstVariants)]
    .map((variant) => variant + suffix)
    .filter((variant) => variant !== ch);
}

function faceOf(kana: KanaItem, script: KanaScript): string {
  return script === 'KATAKANA' ? kana.katakana : kana.hiragana;
}

function shuffle<T>(items: readonly T[]): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  return shuffled;
}

interface DistractorCandidate {
  item: KanaItem;
  face: string;
  sameRow: boolean;
  sameBase: boolean;
  sameColumn: boolean;
  isVoicing: boolean;
}

function selectDistractorCandidates(
  target: KanaItem,
  pool: readonly KanaItem[],
  script: KanaScript,
  count: number
): DistractorCandidate[] {
  const answer = faceOf(target, script);
  const desiredCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (!answer || desiredCount === 0) return [];

  const voicingFaces = new Set(
    voicingVariants(answer[0] ?? '').map((variant) => `${variant}${answer.slice(1)}`)
  );
  const candidates = new Map<string, DistractorCandidate>();

  for (const kana of pool) {
    const face = faceOf(kana, script);
    if (!face || face === answer) continue;

    const candidate = candidates.get(face) ?? {
      item: kana,
      face,
      sameRow: false,
      sameBase: false,
      sameColumn: false,
      isVoicing: false,
    };
    candidate.sameRow ||= kana.row === target.row;
    candidate.sameBase ||= kana.hiragana[0] !== undefined && kana.hiragana[0] === target.hiragana[0];
    candidate.sameColumn ||= kana.col === target.col;
    candidate.isVoicing ||= voicingFaces.has(face);
    candidates.set(face, candidate);
  }

  const picked: DistractorCandidate[] = [];
  const pickedFaces = new Set<string>();
  const addRandom = (source: readonly DistractorCandidate[], maxAdd: number) => {
    if (maxAdd <= 0 || picked.length >= desiredCount) return;
    for (const candidate of shuffle(source)) {
      if (picked.length >= desiredCount || maxAdd <= 0) break;
      if (pickedFaces.has(candidate.face)) continue;
      picked.push(candidate);
      pickedFaces.add(candidate.face);
      maxAdd -= 1;
    }
  };

  // 浊音/半浊音是高价值对照；最多保留两个，避免它们独占整组选择。
  addRandom(
    [...candidates.values()].filter((candidate) => candidate.isVoicing),
    Math.min(2, desiredCount)
  );

  // 只保留一个同行或同首字近邻，让用户看得到对照但不能靠“认行”蒙答案。
  addRandom(
    [...candidates.values()].filter(
      (candidate) => !candidate.isVoicing && (candidate.sameRow || candidate.sameBase)
    ),
    1
  );

  // 再保留一个同段不同关系的候选，帮助建立“段”的横向辨认。
  addRandom(
    [...candidates.values()].filter(
      (candidate) =>
        !candidate.isVoicing &&
        !candidate.sameRow &&
        !candidate.sameBase &&
        candidate.sameColumn &&
        !pickedFaces.has(candidate.face)
    ),
    1
  );

  // 剩余位置从跨行、跨段候选中随机补齐。
  addRandom(
    [...candidates.values()].filter(
      (candidate) =>
        !candidate.isVoicing &&
        !candidate.sameRow &&
        !candidate.sameBase &&
        !candidate.sameColumn &&
        !pickedFaces.has(candidate.face)
    ),
    desiredCount - picked.length
  );

  // 浊音池/小题池可能没有足够的跨关系候选，此时才放宽到所有剩余候选。
  addRandom(
    [...candidates.values()].filter((candidate) => !pickedFaces.has(candidate.face)),
    desiredCount - picked.length
  );

  return shuffle(picked);
}

/**
 * 为目标假名挑选混淆干扰项字面（不含正确答案）。
 * @param count 需要几个（默认 3；池不足时有多少给多少）。
 */
export function confusionDistractorItems(
  target: KanaItem,
  pool: readonly KanaItem[],
  script: KanaScript,
  count = 3
): KanaItem[] {
  return selectDistractorCandidates(target, pool, script, count).map((candidate) => candidate.item);
}

export function confusionDistractors(
  target: KanaItem,
  pool: readonly KanaItem[],
  script: KanaScript,
  count = 3
): string[] {
  return confusionDistractorItems(target, pool, script, count).map((kana) => faceOf(kana, script));
}
