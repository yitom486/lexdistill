import { describe, expect, it } from 'bun:test';
import { coarsePosOfLabel, coarsePosName } from '../index.js';
import { stemEn } from '../index.js';

function stemBases(word: string): string[] {
  return stemEn(word).map((c) => c.base);
}

describe('coarsePosOfLabel（自研三族判定）', () => {
  it('中文标签族', () => {
    expect(coarsePosOfLabel('一段动词')).toBe('verb');
    expect(coarsePosOfLabel('五段·カ行')).toBe('verb');
    expect(coarsePosOfLabel('サ变动词')).toBe('verb');
    expect(coarsePosOfLabel('形容词')).toBe('adjective');
    expect(coarsePosOfLabel('形容动词')).toBe('adjective');
    expect(coarsePosOfLabel('名词')).toBe('noun');
    expect(coarsePosOfLabel('代词')).toBe('noun');
    // 助动词/判断先判 other，不被“动词”子串误收
    expect(coarsePosOfLabel('助动词')).toBe('other');
    expect(coarsePosOfLabel('判断助动词')).toBe('other');
    expect(coarsePosOfLabel('接续词')).toBe('other');
    expect(coarsePosOfLabel('惯用句')).toBe('other');
  });

  it('英文标签族与 OEWN 单字母', () => {
    expect(coarsePosOfLabel('godan verb (ru ending)')).toBe('verb');
    expect(coarsePosOfLabel('i-adjective')).toBe('adjective');
    expect(coarsePosOfLabel('adjectival noun')).toBe('adjective');
    expect(coarsePosOfLabel('noun')).toBe('noun');
    expect(coarsePosOfLabel('n')).toBe('noun');
    expect(coarsePosOfLabel('v')).toBe('verb');
    expect(coarsePosOfLabel('a')).toBe('adjective');
    expect(coarsePosOfLabel('s')).toBe('adjective');
    expect(coarsePosOfLabel('r')).toBe('other');
    expect(coarsePosOfLabel('kanji')).toBe('other');
  });

  it('空与未知一律 other（读侧永不抛）', () => {
    expect(coarsePosOfLabel(undefined)).toBe('other');
    expect(coarsePosOfLabel('')).toBe('other');
    expect(coarsePosOfLabel('  ')).toBe('other');
    expect(coarsePosOfLabel('something-else')).toBe('other');
    expect(coarsePosName('verb')).toBe('动词');
  });
});

describe('stemEn（clean-room 英语还原）', () => {
  it('复数/三单/过去/分词', () => {
    const runs = stemEn('runs');
    expect(runs.some((c) => c.base === 'run' && c.note === '复数' && c.pos === 'noun')).toBe(true);
    expect(runs.some((c) => c.base === 'run' && c.note === '三单' && c.pos === 'verb')).toBe(true);
    expect(stemBases('stories')).toContain('story');
    expect(stemBases('watches')).toContain('watch');
    expect(stemBases('tried')).toContain('try');
    expect(stemBases('stopped')).toContain('stop');
    expect(stemBases('liked')).toContain('like');
    expect(stemBases('making')).toContain('make');
    expect(stemBases('eating')).toContain('eat');
  });

  it('比较级/最高级/副词/不规则', () => {
    const bigger = stemEn('bigger');
    expect(bigger.some((c) => c.base === 'big' && c.note === '比较级' && c.pos === 'adjective')).toBe(true);
    expect(stemBases('happiest')).toContain('happy');
    expect(stemBases('larger')).toContain('large');
    expect(stemBases('quickly')).toContain('quick');
    expect(stemBases('children')).toContain('child');
    expect(stemBases('went')).toContain('go');
    expect(stemBases('men')).toContain('man');
  });

  it('短词/空/上限（不臆造）', () => {
    expect(stemEn('as')).toEqual([]);
    expect(stemEn('')).toEqual([]);
    expect(stemEn('a'.repeat(40)).length).toBeLessThanOrEqual(12);
    // 深度恒为 1（单跳，无链式）
    expect(stemEn('running').every((c) => c.depth === 1)).toBe(true);
    expect(stemBases('running')).toContain('run');
  });
});
