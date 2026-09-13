import { describe, expect, it } from 'bun:test';
import {
  splitMorae,
  moraPitchPattern,
  buildPitchGraphSvg,
} from '../index.js';

describe('splitMorae', () => {
  it('拗音合并；促音拨音长音独立', () => {
    expect(splitMorae('きゃく')).toEqual(['きゃ', 'く']);
    expect(splitMorae('がっこう')).toEqual(['が', 'っ', 'こ', 'う']);
    expect(splitMorae('しんぶん')).toEqual(['し', 'ん', 'ぶ', 'ん']);
    expect(splitMorae('コーヒー')).toEqual(['コ', 'ー', 'ヒ', 'ー']);
    expect(splitMorae('パイ')).toEqual(['パ', 'イ']);
    expect(splitMorae('')).toEqual([]);
  });
});

describe('moraPitchPattern', () => {
  it('平板/头高/中高/尾高', () => {
    expect(moraPitchPattern(['あ', 'め'], [0])).toEqual(['L', 'H']);
    expect(moraPitchPattern(['は', 'し'], [1])).toEqual(['H', 'L']);
    expect(moraPitchPattern(['は', 'し'], [2])).toEqual(['L', 'H']);
    expect(moraPitchPattern(['に', 'ほ', 'ん'], [2])).toEqual(['L', 'H', 'L']);
    // 长音保持前拍
    expect(moraPitchPattern(['コ', 'ー', 'ヒ', 'ー'], [0])).toEqual(['L', 'L', 'H', 'H']);
    // 多核取首核；空核按平板
    expect(moraPitchPattern(['あ', 'め'], [1, 2])).toEqual(['H', 'L']);
    expect(moraPitchPattern(['あ', 'め'], [])).toEqual(['L', 'H']);
  });
});

describe('buildPitchGraphSvg', () => {
  it('阶梯图结构（线+圆点+拍字+标题）', () => {
    const svg = buildPitchGraphSvg('はし', [1], { label: '①' });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('<title>はし ①</title>');
    expect(svg.match(/<circle/g)?.length).toBe(2);
    expect(svg).toContain('は');
    expect(svg).toContain('し');
    // 头高：首圆高位（cy=12），次圆低位（cy=32）
    expect(svg).toContain('cy="12"');
    expect(svg).toContain('cy="32"');
  });

  it('空读音返回空串；假名转义防注入', () => {
    expect(buildPitchGraphSvg('  ', [0])).toBe('');
    const evil = buildPitchGraphSvg('<b>&', [0]);
    expect(evil).not.toContain('<b>');
    expect(evil).toContain('&lt;b&gt;&amp;');
  });
});
