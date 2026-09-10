import { describe, expect, it } from 'bun:test';
import {
  reconcileLessons,
  type ReconLessonInput,
} from '../lesson-reconciliation.js';

/**
 * P1-C0.5 reconciliation fixture matrix（纯函数，原型未接生产）。
 * 覆盖 §6 十二场景 + 阈值边界；FP（错误复用旧 id）出现即失败。
 */
function L(id: string, title: string, lines: string[], vocab: string[] = []): ReconLessonInput {
  return {
    id,
    title,
    dialogues: lines.map((japanese, i) => ({ speaker: i % 2 === 0 ? 'A' : 'B', japanese })),
    vocabularies: vocab.map((surface) => ({ surface })),
  };
}

const JA = [
  'はじめまして。わたしはアキです。',
  'こちらこそよろしくおねがいします。',
  'きょうはいい天気ですね。',
  'はい、さんぽに行きましょう。',
];
const JB = [
  'すみません、えきはどこですか。',
  'あの信号を右に曲がると見えますよ。',
  'どうもありがとうございます。',
];
const JC = [
  'この料理はとてもおいしいですね。',
  'ええ、母の味がします。',
];

function autoIds(r: ReturnType<typeof reconcileLessons>): string[] {
  return r.reconciledLessons.filter((l) => l.status === 'AUTO_MATCH').map((l) => l.id);
}

describe('reconciliation fixture matrix', () => {
  it('Stable：A B C → A B C 全复用', () => {
    const old = [L('o1', '第1課', JA), L('o2', '第2課', JB), L('o3', '第3課', JC)];
    const cur = [L('n1', '第1課', JA), L('n2', '第2課', JB), L('n3', '第3課', JC)];
    const r = reconcileLessons(old, cur);
    expect(autoIds(r)).toEqual(['o1', 'o2', 'o3']);
    expect(r.added).toEqual([]);
    expect(r.removed).toEqual([]);
    expect(r.pairs.every((p) => p.evidence.exactFp)).toBe(true);
  });

  it('Insert：A Review B C；Review 新 id，A/B/C 复用', () => {
    const old = [L('o1', '第1課', JA), L('o2', '第2課', JB), L('o3', '第3課', JC)];
    const review = ['復習しましょう。', 'もう一度言ってください。'];
    const cur = [L('n1', '第1課', JA), L('nR', '復習A', review), L('n2', '第2課', JB), L('n3', '第3課', JC)];
    const r = reconcileLessons(old, cur);
    expect(autoIds(r)).toEqual(['o1', 'o2', 'o3']);
    // 核心验收：l2=B 插入后仍是 l2，Review 拿新 id
    const byNew = new Map(r.reconciledLessons.map((l) => [l.index, l]));
    expect(byNew.get(2)).toMatchObject({ id: 'o2', idSource: 'preserved-old' });
    expect(byNew.get(1)).toMatchObject({ id: 'nR', idSource: 'new-provisional', status: 'ADDED' });
  });

  it('Delete：A Review B C → A B C；Review removed', () => {
    const review = ['復習しましょう。', 'もう一度言ってください。'];
    const old = [L('o1', '第1課', JA), L('oR', '復習A', review), L('o2', '第2課', JB), L('o3', '第3課', JC)];
    const cur = [L('n1', '第1課', JA), L('n2', '第2課', JB), L('n3', '第3課', JC)];
    const r = reconcileLessons(old, cur);
    expect(autoIds(r)).toEqual(['o1', 'o2', 'o3']);
    expect(r.removed).toHaveLength(1);
    expect(r.removed[0]).toMatchObject({ oldId: 'oR', status: 'REMOVED' });
  });

  it('Middle insert：后续 lesson 不发生 identity shift', () => {
    const old = [L('o1', '第1課', JA), L('o2', '第2課', JB), L('o3', '第3課', JC)];
    const mid = ['追加の課です。', 'よろしくおねがいします。'];
    const cur = [L('n1', '第1課', JA), L('nX', '補充課', mid), L('n2', '第2課', JB), L('n3', '第3課', JC)];
    const r = reconcileLessons(old, cur);
    const rec = r.reconciledLessons;
    expect(rec.map((l) => l.id)).toEqual(['o1', 'nX', 'o2', 'o3']);
  });

  it('Heading OCR fix：だい -第11課 → 第11課，内容同则复用', () => {
    const old = [L('o11', 'だい -第11課', JA)];
    const cur = [L('n11', '第11課', JA)];
    const r = reconcileLessons(old, cur);
    expect(autoIds(r)).toEqual(['o11']);
    expect(r.pairs[0]?.evidence.exactFp).toBe(true);
  });

  it('Positional gap：lessonNumber 15/16/18/20 不影响匹配（number 永不作证据）', () => {
    const old = [L('o15', '第16課', JA), L('o16', '第17課', JB)];
    const cur = [L('n15', '第16課', JA), L('n18', '第19課', JC)];
    const r = reconcileLessons(old, cur);
    // o15↔n15 exact 复用；o16（第17課）vs n18（第19課）内容不同 → 不配对
    expect(r.reconciledLessons[0]).toMatchObject({ id: 'o15', status: 'AUTO_MATCH' });
    expect(r.reconciledLessons[1]?.status).not.toBe('AUTO_MATCH');
    expect(r.removed.map((x) => x.oldId)).toContain('o16');
  });

  it('Number/title restart（minna1 类）：第24課→第1課→復習A 不按 number 配', () => {
    const old = [L('o24', '第24課', JA), L('o1b', '第1課', JB), L('oR', '復習A', JC)];
    const cur = [L('n24', '第24課', JA), L('n1b', '第1課', JB), L('nR', '復習A', JC)];
    const r = reconcileLessons(old, cur);
    // 内容+token 双通道对齐（顺序亦同），全复用
    expect(autoIds(r)).toEqual(['o24', 'o1b', 'oR']);
  });

  it('Same title：同名且内容近似但交叉，不得因 title 错配（tie→AMBIGUOUS）', () => {
    // 裸“復習”无字母 token（非高置信）；两变体仅一字之差、顺序交叉
    const v1 = [...JA];
    const v2 = [...JA];
    v2[0] = 'はじめまして。わたしはボブです。';
    const old = [L('o1', '復習', v1), L('o2', '復習', v2)];
    const cur = [L('n1', '復習', v2), L('n2', '復習', v1)];
    const r = reconcileLessons(old, cur);
    expect(autoIds(r)).toEqual([]);
    expect(r.pairs.length).toBeGreaterThan(0);
    expect(r.pairs.every((p) => p.status === 'AMBIGUOUS')).toBe(true);
    expect(r.pairs.every((p) => p.competitors.length > 0)).toBe(true);
  });

  it('Content minor edit：少量 OCR 修正仍高置信复用', () => {
    const fixed = [...JA];
    fixed[0] = 'はじめまして!わたしはアキです。';
    const old = [L('o1', '第1課', JA)];
    const cur = [L('n1', '第1課', fixed)];
    const r = reconcileLessons(old, cur);
    expect(r.pairs[0]?.evidence.exactFp).toBe(false);
    expect(r.pairs[0]?.evidence.sim).toBeGreaterThanOrEqual(0.8);
    expect(autoIds(r)).toEqual(['o1']);
  });

  it('Major replacement：标题相同但正文全换→ADDED+REMOVED，不得复用', () => {
    const other = ['今日は雨が降っています。', '傘を持って行きましょう。', '電車で帰ります。'];
    const old = [L('o1', '第1課', JA)];
    const cur = [L('n1', '第1課', other)];
    const r = reconcileLessons(old, cur);
    // 零证据即零配对（DP 全 gaps）：旧课 REMOVED（位置 fallback 到文档级），新课 ADDED 拿新 id
    expect(r.pairs).toEqual([]);
    expect(autoIds(r)).toEqual([]);
    expect(r.removed).toMatchObject([{ oldId: 'o1', status: 'REMOVED' }]);
    expect(r.added).toMatchObject([{ newProvisionalId: 'n1', status: 'ADDED' }]);
    expect(r.reconciledLessons[0]).toMatchObject({ id: 'n1', idSource: 'new-provisional' });
  });

  it('Split：B → B1+B2 默认 ambiguous，不强行复用', () => {
    const b1 = [JA[0]!, JA[1]!];
    const b2 = [JA[2]!, JA[3]!];
    const old = [L('oA', '第1課', ['前課です。']), L('oB', '第2課', JA)];
    const cur = [L('nA', '第1課', ['前課です。']), L('nB1', '第2課前半', b1), L('nB2', '第2課後半', b2)];
    const r = reconcileLessons(old, cur);
    expect(r.relations.some((x) => x.kind === 'split-candidate')).toBe(true);
    // B 相关全部 AMBIGUOUS；A 照常复用
    expect(r.reconciledLessons[0]).toMatchObject({ id: 'oA', status: 'AUTO_MATCH' });
    const bIds = autoIds(r);
    expect(bIds).not.toContain('oB');
    expect(bIds).toEqual(['oA']);
  });

  it('Merge：B1+B2 → B 默认 unresolved', () => {
    const b1 = [JA[0]!, JA[1]!];
    const b2 = [JA[2]!, JA[3]!];
    const old = [L('oB1', '第2課前半', b1), L('oB2', '第2課後半', b2)];
    const cur = [L('nB', '第2課', JA)];
    const r = reconcileLessons(old, cur);
    expect(r.relations.some((x) => x.kind === 'merge-candidate')).toBe(true);
    expect(autoIds(r)).toEqual([]);
    expect(r.reconciledLessons[0]?.status).toBe('AMBIGUOUS');
  });

  it('单调性：crossing 候选不得产生 crossing 指派', () => {    // 新序颠倒 JA/JB：单调约束下至多对齐一条，另一条 ADDED/REMOVED
    const old = [L('o1', '甲課', JA), L('o2', '乙課', JB)];
    const cur = [L('n1', '乙課', JB), L('n2', '甲課', JA)];
    const r = reconcileLessons(old, cur);
    const autos = r.pairs.filter((p) => p.status === 'AUTO_MATCH');
    // 单调：若有两个 AUTO，其 oldIndex/newIndex 必须同序
    for (let i = 1; i < autos.length; i++) {
      expect(autos[i]!.oldIndex).toBeGreaterThan(autos[i - 1]!.oldIndex);
      expect(autos[i]!.newIndex).toBeGreaterThan(autos[i - 1]!.newIndex);
    }
    // 颠倒场景下 FP=0 比全配更重要：至多 1 个 AUTO（LCS 形态）
    expect(autos.length).toBeLessThanOrEqual(1);
  });

  it('Absorb：新课吞掉另一旧课实质内容→降级 AMBIGUOUS（真 FP 回归，minna1 形态）', () => {
    // 真实形态：大课 184 行 vs 小课 6 行，合并后 sim 仍 ≈0.98——必须靠 absorb 规则兜住
    const big = [
      '今日は学校で日本語を勉強しました。',
      '先生はとても親切な方です。',
      '友達と一緒に昼ご飯を食べました。',
      '午後は図書館で本を読みました。',
      '夕方は公園を散歩しました。',
      '夜は家でテレビを見ました。',
      '週末は家族と出かけます。',
      '来週の試験に向けて復習します。',
    ];
    const small = ['すみません、トイレはどこですか。', 'あちらです。どうぞ。'];
    const old = [L('oBig', '第1課', big), L('oSmall', '第2課', small)];
    const cur = [L('nM', '第1課', [...big, ...small])];
    const r = reconcileLessons(old, cur);
    // 若无 absorb 规则，nM 会以 token+sim≈0.9 继承 oBig（FP）；必须降级
    expect(r.relations.some((x) => x.kind === 'absorb-candidate')).toBe(true);
    expect(autoIds(r)).toEqual([]);
    expect(r.reconciledLessons[0]?.status).toBe('AMBIGUOUS');
    expect(r.removed.find((x) => x.oldId === 'oSmall')?.status).toBe('AMBIGUOUS');
  });

  it('Absorb 反例：单句偶然包含（<20 字符）不触发降级', () => {
    const big = [
      '今日は学校で日本語を勉強しました。',
      '先生はとても親切な方です。',
      'はい。',
    ];
    const tiny = ['はい。'];
    const old = [L('oBig', '第 1 课', big), L('oTiny', '第2課', tiny)];
    const cur = [L('nBig', '第 1 课', big)];
    const r = reconcileLessons(old, cur);
    // oTiny 仅一句且短：即使被包含也不降级 oBig 的 AUTO
    expect(autoIds(r)).toEqual(['oBig']);
    expect(r.relations.some((x) => x.kind === 'absorb-candidate')).toBe(false);
  });
});
