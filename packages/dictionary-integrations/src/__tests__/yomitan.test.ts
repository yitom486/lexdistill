import { describe, expect, it } from 'bun:test';
import {
  parseYomitanDictionary,
  pitchPositionsLabel,
  slugifyTitle,
} from '../index.js';

/**
 * M5-2 Yomitan bank v3 解析（随解析核从网关迁入，断言逐字保留；
 * fixture 由 zip 改为直给文件数组——解包仍归网关 archive）。
 */
const MINI_INDEX = JSON.stringify({ title: 'MiniTest', format: 3, revision: 't1' });
const MINI_TERMS = JSON.stringify([
  ['雨', 'あめ', 'n', '', 0, ['rain', { type: 'text', text: ' precipitation' }], 1, 'n'],
  ['食べる', 'たべる', 'v1 vt', '', 0, [{ type: 'structured-content', content: ['to eat', { tag: 'x', content: ['food'] }] }], 2, 'v1 vt'],
  ['画像', 'がぞう', 'n', '', 0, [{ type: 'image', path: 'a.webp', width: 1, height: 1 }], 3, 'n'],
  ['空', '', '', '', 0, [], 4, ''],
]);
const MINI_META = JSON.stringify([
  ['雨', 'pitch', { reading: 'あめ', pitches: [{ position: 1 }] }],
  ['食べる', 'pitch', { reading: 'たべる', pitches: [{ position: 0 }] }],
  ['雨', 'freq', { reading: 'あめ', frequency: 5 }],
]);
const MINI_KANJI = JSON.stringify([['雨', 'ウ', 'あめ あま', 'n', ['rain']]]);

function miniFiles(): Array<{ path: string; data: Uint8Array }> {
  const enc = new TextEncoder();
  return [
    { path: 'index.json', data: enc.encode(MINI_INDEX) },
    { path: 'term_bank_1.json', data: enc.encode(MINI_TERMS) },
    { path: 'term_meta_bank_1.json', data: enc.encode(MINI_META) },
    { path: 'kanji_bank_1.json', data: enc.encode(MINI_KANJI) },
  ];
}

describe('yomitan bank v3 解析（clean-room）', () => {
  it('解析词条/读音/词性/释义/声调/汉字，跳过纯图片词条', () => {
    const parsed = parseYomitanDictionary(miniFiles(), 'yt');
    expect(parsed.index.title).toBe('MiniTest');
    expect(parsed.entries.map((e) => e.headword)).toEqual(['雨', '食べる', '雨']);
    const ame = parsed.entries.find((e) => e.headword === '雨' && e.reading === 'あめ');
    expect(ame?.meanings).toEqual(['rain', 'precipitation']);
    expect(ame?.partOfSpeech).toBe('名词');
    const taberu = parsed.entries.find((e) => e.headword === '食べる');
    // 相邻文本节点各自成义（不臆造拼接）
    expect(taberu?.meanings).toEqual(['to eat', 'food']);
    expect(taberu?.partOfSpeech).toBe('一段动词');
    // 声调走覆盖行（安装时回填），解析阶段只出 pitchRows
    const amePitch = parsed.pitchRows.find((r) => r.term === '雨');
    expect(JSON.parse(amePitch?.pitchJson ?? '{}')).toMatchObject({ pitch: { label: '①' } });
    expect(parsed.stats.pitchMeta).toBe(2);
    expect(parsed.stats.freqMeta).toBe(1);
    expect(parsed.stats.mediaSkipped).toBe(1);
    expect(parsed.stats.kanji).toBe(1);
    const kanji = parsed.entries.find((e) => e.headword === '雨' && e.partOfSpeech === 'kanji');
    expect(kanji?.meanings).toEqual(['rain']);
  });

  it('拒绝非 v3 / 缺 index / 坏 bank', () => {
    const files = (name: string, content: string) => [{ path: name, data: new TextEncoder().encode(content) }];
    expect(() =>
      parseYomitanDictionary(files('index.json', JSON.stringify({ title: 'x', format: 2, revision: 'r' })), 'yt')
    ).toThrow();
    expect(() => parseYomitanDictionary([], 'yt')).toThrow();
    expect(() =>
      parseYomitanDictionary(files('index.json', MINI_INDEX).concat([{ path: 'term_bank_1.json', data: new TextEncoder().encode('{{{') }]), 'yt')
    ).toThrow();
  });

  it('畸形 bank 一律宽容跳过（不抛、按有效行产出）', () => {
    const enc = new TextEncoder();
    const files = [
      { path: 'index.json', data: enc.encode(MINI_INDEX) },
      { path: 'term_bank_1.json', data: enc.encode(JSON.stringify(['not-an-array-row', 42, null])) },
      { path: 'term_bank_2.json', data: enc.encode(JSON.stringify([['只', 'zhǐ']])) },
      { path: 'term_meta_bank_1.json', data: enc.encode(JSON.stringify([['x'], 'garbage', null])) },
      { path: 'kanji_bank_1.json', data: enc.encode(JSON.stringify([['雨']])) },
    ];
    const parsed = parseYomitanDictionary(files, 'yt');
    expect(parsed.entries).toEqual([]);
    expect(parsed.pitchRows).toEqual([]);
    expect(parsed.stats.terms).toBe(0);
  });

  it('index 类型错误即拒（标题非空/版本可解析为硬门）', () => {
    const files = (name: string, content: string) => [{ path: name, data: new TextEncoder().encode(content) }];
    expect(() =>
      parseYomitanDictionary(files('index.json', JSON.stringify({ title: 42, format: 3, revision: 'r' })), 'yt')
    ).toThrow();
    expect(() =>
      parseYomitanDictionary(files('index.json', JSON.stringify({ title: 'x', format: 'v3', revision: 'r' })), 'yt')
    ).toThrow();
  });

  it('pitchPositionsLabel：0→⓪，超范围保留数字', () => {
    expect(pitchPositionsLabel([0])).toBe('⓪');
    expect(pitchPositionsLabel([1, 3])).toBe('①/③');
    expect(pitchPositionsLabel([])).toBe('？');
    expect(slugifyTitle('Kanjium Pitch Accents')).toBe('kanjium-pitch-accents');
  });
});
