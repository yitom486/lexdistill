import { describe, expect, it } from 'bun:test';
import { confusionDistractors, voicingVariants } from '../kana-confusion.js';
import type { KanaItem } from '@lexdistill/protocol';

function makeKana(
  id: string,
  hiragana: string,
  katakana: string,
  romaji: string,
  row: string,
  col: string
): KanaItem {
  return { id, type: 'SEION', hiragana, katakana, romaji, row, col, audioText: hiragana, sortOrder: 0 };
}

const POOL: KanaItem[] = [
  makeKana('k_shi', 'し', 'シ', 'shi', 'さ行', 'い段'),
  makeKana('k_sha', 'しゃ', 'シャ', 'sha', 'し拗音', 'あ段'),
  makeKana('k_shu', 'しゅ', 'シュ', 'shu', 'し拗音', 'う段'),
  makeKana('k_sho', 'しょ', 'ショ', 'sho', 'し拗音', 'お段'),
  makeKana('k_ji', 'じ', 'ジ', 'ji', 'ざ行', 'い段'),
  makeKana('k_de', 'で', 'デ', 'de', 'だ行', 'え段'),
  makeKana('k_pa', 'ぱ', 'パ', 'pa', 'ぱ行', 'あ段'),
  makeKana('k_ha', 'は', 'ハ', 'ha', 'は行', 'あ段'),
  makeKana('k_ba', 'ば', 'バ', 'ba', 'ば行', 'あ段'),
  makeKana('k_su', 'す', 'ス', 'su', 'さ行', 'う段'),
];

describe('voicingVariants', () => {
  it('produces real dakuten/handakuten counterparts only', () => {
    expect(voicingVariants('は')).toEqual(expect.arrayContaining(['ば', 'ぱ']));
    expect(voicingVariants('し')).toContain('じ');
    expect(voicingVariants('シ')).toContain('ジ');
    expect(voicingVariants('い')).toEqual([]);
    expect(voicingVariants('ア')).toEqual([]);
  });

  it('returns empty for non-kana', () => {
    expect(voicingVariants('A')).toEqual([]);
    expect(voicingVariants('')).toEqual([]);
  });
});

describe('confusionDistractors', () => {
  it('keeps one useful neighbor while mixing same-column and cross-row options', () => {
    const target = POOL.find((k) => k.id === 'k_shu')!;
    const usefulNeighbors = new Set(['しゃ', 'しょ', 'し']);

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const got = confusionDistractors(target, POOL, 'HIRAGANA', 3);
      expect(got).not.toContain('しゅ');
      expect(got.length).toBe(3);
      expect(got.filter((face) => usefulNeighbors.has(face))).toHaveLength(1);
      expect(got).toContain('す');
      expect(got.some((face) => ['じ', 'で', 'ぱ', 'は', 'ば'].includes(face))).toBe(true);
    }
  });

  it('includes voicing counterparts (は → ば/ぱ)', () => {
    const target = POOL.find((k) => k.id === 'k_ha')!;
    const got = confusionDistractors(target, POOL, 'HIRAGANA', 4);
    expect(got).toContain('ば');
    expect(got).toContain('ぱ');
  });

  it('respects katakana script while preserving option diversity', () => {
    const target = POOL.find((k) => k.id === 'k_shu')!;
    const got = confusionDistractors(target, POOL, 'KATAKANA', 2);
    expect(got.length).toBe(2);
    expect(got.some((face) => ['シャ', 'ショ', 'シ'].includes(face))).toBe(true);
    expect(got).toContain('ス');
    expect(got.every((g) => /[\u30A0-\u30FF]/.test(g[0] ?? ''))).toBe(true);
  });

  it('never invents options outside the pool', () => {
    const tiny = POOL.slice(0, 2);
    const got = confusionDistractors(tiny[0]!, tiny, 'HIRAGANA', 3);
    expect(got.length).toBeLessThanOrEqual(1);
    expect(got.every((g) => g === 'し' || g === 'しゃ')).toBe(true);
  });
});
