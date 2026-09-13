import { describe, expect, it } from 'bun:test';
import { deinflectKo } from '../index.js';
import { decomposeSyllable, composeSyllable } from '../index.js';

function bases(surface: string): string[] {
  return deinflectKo(surface).map((c) => c.base);
}

describe('hangul 谚文分解合成（公开算法）', () => {
  it('分解合成往返（含复终声）', () => {
    expect(decomposeSyllable('한')).toEqual({ cho: 'ㅎ', jung: 'ㅏ', jong: 'ㄴ', raw: '한' });
    expect(decomposeSyllable('닭')).toEqual({ cho: 'ㄷ', jung: 'ㅏ', jong: 'ㄺ', raw: '닭' });
    expect(decomposeSyllable('값')).toEqual({ cho: 'ㄱ', jung: 'ㅏ', jong: 'ㅄ', raw: '값' });
    expect(composeSyllable('ㅊ', 'ㅜ', 'ㅂ')).toBe('춥');
    expect(composeSyllable('ㄹ', 'ㅡ', '')).toBe('르');
    expect(decomposeSyllable('A')).toBeNull();
    expect(composeSyllable('ㅊ', 'X', '')).toBe('');
  });
});

describe('deinflectKo 规则词尾', () => {
  it('해요体/합니다体/过去时', () => {
    expect(bases('가요')).toContain('가다');
    expect(bases('먹어요')).toContain('먹다');
    expect(bases('해요')).toContain('하다');
    expect(bases('갑니다')).toContain('가다');
    expect(bases('먹습니다')).toContain('먹다');
    expect(bases('갔다')).toContain('가다');
    expect(bases('먹었다')).toContain('먹다');
    expect(bases('했습니다')).toContain('하다');
    expect(bases('갔어요')).toContain('가다');
  });

  it('系动词/缩约/连接定语', () => {
    expect(bases('이에요')).toContain('이다');
    expect(bases('입니다')).toContain('이다');
    expect(bases('이었다')).toContain('이다');
    expect(bases('와요')).toContain('오다');
    expect(bases('봤어요')).toContain('보다');
    expect(bases('가고')).toContain('가다');
    expect(bases('가면')).toContain('가다');
    expect(bases('가는')).toContain('가다');
    expect(bases('가세요')).toContain('가다');
    expect(bases('가자')).toContain('가다');
  });

  it('否定前缀链式', () => {
    expect(bases('안 먹어요')).toContain('먹다');
    expect(bases('가지 않아요')).toContain('가다');
  });

  it('不规则 7 式', () => {
    expect(bases('추워요')).toContain('춥다');
    expect(bases('고마워요')).toContain('고맙다');
    expect(bases('예뻐요')).toContain('예쁘다');
    expect(bases('들어요')).toContain('듣다');
    expect(bases('지어요')).toContain('짓다');
    expect(bases('몰라요')).toContain('모르다');
    expect(bases('커요')).toContain('크다');
    expect(bases('노래요')).toContain('노랗다');
  });

  it('原形不返回自身；空输入返回空；候选有上限；双词性', () => {
    expect(bases('가다')).not.toContain('가다');
    expect(deinflectKo('')).toEqual([]);
    expect(deinflectKo('가').length).toBeLessThanOrEqual(24);
    const cands = deinflectKo('먹어요').filter((c) => c.base === '먹다');
    expect(cands.some((c) => c.pos === 'verb')).toBe(true);
    expect(cands.some((c) => c.pos === 'adjective')).toBe(true);
  });
});
