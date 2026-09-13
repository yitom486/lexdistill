import { describe, expect, it } from 'bun:test';
import { deinflectJa } from '../index.js';

function bases(surface: string): string[] {
  return deinflectJa(surface).map((c) => c.base);
}

describe('deinflectJa（clean-room 活用形还原）', () => {
  it('た形/て形：五段各行 + 一段', () => {
    expect(bases('食べた')).toContain('食べる');
    expect(bases('行った')).toContain('行く');
    expect(bases('書いた')).toContain('書く');
    expect(bases('泳いだ')).toContain('泳ぐ');
    expect(bases('話した')).toContain('話す');
    expect(bases('待った')).toContain('待つ');
    expect(bases('読んだ')).toContain('読む');
    expect(bases('死んだ')).toContain('死ぬ');
    expect(bases('呼んだ')).toContain('呼ぶ');
    expect(bases('買った')).toContain('買う');
    expect(bases('食べて')).toContain('食べる');
  });

  it('ない形/ます形/たい形', () => {
    expect(bases('書かない')).toContain('書く');
    expect(bases('食べない')).toContain('食べる');
    expect(bases('行きました')).toContain('行く');
    expect(bases('食べます')).toContain('食べる');
    expect(bases('食べたい')).toContain('食べる');
    expect(bases('高かった')).toContain('高い');
    expect(bases('高くない')).toContain('高い');
  });

  it('する/来る/ある不规则', () => {
    expect(bases('した')).toContain('する');
    expect(bases('しない')).toContain('する');
    expect(bases('して')).toContain('する');
    expect(bases('きた')).toContain('くる');
    expect(bases('こない')).toContain('くる');
    expect(bases('きました')).toContain('くる');
    expect(bases('ない')).toContain('ある');
  });

  it('受身可能使役/意向命令/条件', () => {
    expect(bases('書かれる')).toContain('書く');
    expect(bases('食べられる')).toContain('食べる');
    expect(bases('書ける')).toContain('書く');
    expect(bases('書けない')).toContain('書く');
    expect(bases('書かせる')).toContain('書く');
    expect(bases('書こう')).toContain('書く');
    expect(bases('書け')).toContain('書く');
    expect(bases('書けば')).toContain('書く');
    expect(bases('書いたら')).toContain('書く');
    expect(bases('書かず')).toContain('書く');
  });

  it('链式：進行体/てください/てしまう缩约', () => {
    const prog = deinflectJa('食べている').map((c) => `${c.base}(${c.note})`);
    expect(prog.some((s) => s.startsWith('食べる('))).toBe(true);
    expect(bases('書いてください')).toContain('書く');
    expect(bases('買っちゃう')).toContain('買う');
  });

  it('原形不返回自身；空输入返回空；候选有上限', () => {
    expect(bases('食べる')).not.toContain('食べる');
    expect(deinflectJa('')).toEqual([]);
    expect(deinflectJa('あ').length).toBeLessThanOrEqual(16);
  });

  it('候选带跳数与表层词性（た形动词/形容词/だ系其他）', () => {
    const tabeta = deinflectJa('食べた').find((c) => c.base === '食べる');
    expect(tabeta?.depth).toBe(1);
    expect(tabeta?.pos).toBe('verb');
    const takakatta = deinflectJa('高かった').find((c) => c.base === '高い');
    expect(takakatta?.pos).toBe('adjective');
    const datta = deinflectJa('だった').find((c) => c.base === 'だ');
    expect(datta?.pos).toBe('other');
    // 链条首跳决定表层词性：食べさせられた（受身链）仍是动词
    const chain = deinflectJa('食べさせられた').find((c) => c.base === '食べる');
    expect(chain?.pos).toBe('verb');
    expect(chain && chain.depth > 1).toBe(true);
  });
});
