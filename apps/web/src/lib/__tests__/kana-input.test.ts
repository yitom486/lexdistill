import { describe, expect, it } from 'bun:test';
import { buildRomajiMap, romajiToKana, toHiragana } from '../kana-input.js';
import type { KanaItem } from '@lexdistill/protocol';

function makeKana(hiragana: string, katakana: string, romaji: string): KanaItem {
  return {
    id: `k_${romaji}`,
    type: 'SEION',
    hiragana,
    katakana,
    romaji,
    row: 'test',
    col: 'test',
    audioText: hiragana,
    sortOrder: 0,
  };
}

const SEED: KanaItem[] = [
  makeKana('あ', 'ア', 'a'),
  makeKana('め', 'メ', 'me'),
  makeKana('し', 'シ', 'shi'),
  makeKana('は', 'ハ', 'ha'),
  makeKana('こ', 'コ', 'ko'),
  makeKana('ん', 'ン', 'n'),
  makeKana('が', 'ガ', 'ga'),
  makeKana('う', 'ウ', 'u'),
  makeKana('き', 'キ', 'ki'),
  makeKana('きゃ', 'キャ', 'kya'),
  makeKana('ぴゅ', 'ピュ', 'pyu'),
  makeKana('た', 'タ', 'ta'),
  makeKana('ほ', 'ホ', 'ho'),
  makeKana('に', 'ニ', 'ni'),
  makeKana('ち', 'チ', 'chi'),
  makeKana('ゃ', 'ャ', 'ya'),
  makeKana('ま', 'マ', 'ma'),
  makeKana('ちゃ', 'チャ', 'cha'),
];

describe('romajiToKana', () => {
  it('converts basic words', () => {
    expect(romajiToKana('ame', SEED)).toBe('あめ');
    expect(romajiToKana('ame', SEED, 'KATAKANA')).toBe('アメ');
    expect(romajiToKana('hashi', SEED)).toBe('はし');
  });

  it('handles digraphs, geminates and ん', () => {
    expect(romajiToKana('kya', SEED)).toBe('きゃ');
    expect(romajiToKana('gakkou', SEED)).toBe('がっこう');
    expect(romajiToKana('hon', SEED)).toBe('ほん');
    expect(romajiToKana('konpyu-ta-', SEED, 'KATAKANA')).toBe('コンピューター');
    expect(romajiToKana('matcha', SEED)).toBe('まっちゃ');
  });

  it('returns empty for unmappable input instead of inventing', () => {
    expect(romajiToKana('', SEED)).toBe('');
    expect(romajiToKana('xyz', SEED)).toBe('');
    expect(romajiToKana('ame!', SEED)).toBe('あめ');
  });

  it('builds the map from seed rows without statics', () => {
    const map = buildRomajiMap(SEED);
    expect(map.get('shi')).toEqual({ hira: 'し', kata: 'シ' });
  });
});

describe('toHiragana', () => {
  it('normalizes katakana for comparison', () => {
    expect(toHiragana('コンピューター')).toBe('こんぴゅーたー');
    expect(toHiragana('あめ')).toBe('あめ');
  });
});
