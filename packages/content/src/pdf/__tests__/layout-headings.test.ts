import { describe, expect, test } from 'bun:test';
import {
  layoutItemsToCandidates,
  mergeHeadingCandidates,
  type LayoutTextItem,
} from '../../index.js';

/** M8-6：自 Gateway 迁入（纯规则单测；合成条目与断言逐项一致）。 */

/** 合成条目：一行正文（10pt）+ 一行大字标题（18pt 加粗居中独立行）。 */
function syntheticPage(pageWidth = 500): LayoutTextItem[] {
  const items: LayoutTextItem[] = [];
  // 标题行（y=100，大字加粗）
  items.push({ text: '第', page: 1, x: 220, y: 100, width: 18, height: 18, fontSize: 18, isBold: true });
  items.push({ text: '7', page: 1, x: 238, y: 100, width: 18, height: 18, fontSize: 18, isBold: true });
  items.push({ text: '課', page: 1, x: 256, y: 100, width: 18, height: 18, fontSize: 18, isBold: true });
  // 正文行（y=200/214，小字）
  for (let i = 0; i < 8; i++) {
    items.push({ text: 'あ', page: 1, x: 60 + i * 20, y: 200, width: 12, height: 10, fontSize: 10, isBold: false });
  }
  for (let i = 0; i < 8; i++) {
    items.push({ text: 'い', page: 1, x: 60 + i * 20, y: 214, width: 12, height: 10, fontSize: 10, isBold: false });
  }
  void pageWidth;
  return items;
}

describe('layoutItemsToCandidates', () => {
  test('大字加粗行被检出并带上版式特征', () => {
    const cands = layoutItemsToCandidates(syntheticPage(), [], { pageWidthPt: 500 });
    expect(cands.length).toBe(1);
    const c = cands[0]!;
    expect(c.text).toBe('第7課');
    expect(c.page).toBe(1);
    expect(c.bold).toBe(true);
    expect(c.standalone).toBe(true);
    expect(c.hasNumbering).toBe(true);
    expect(c.centered).toBe(true);
    expect(c.relSize).toBeGreaterThanOrEqual(1.15);
  });

  test('纯正文页零候选（不打扰模型）', () => {
    const items: LayoutTextItem[] = [];
    for (let i = 0; i < 6; i++) {
      items.push({ text: 'あいうえおかきくけこ', page: 2, x: 60, y: 100 + i * 14, width: 200, height: 10, fontSize: 10, isBold: false });
    }
    expect(layoutItemsToCandidates(items)).toEqual([]);
  });

  test('标签化PDF的H2角色直接放行（含小字标题）', () => {
    const items: LayoutTextItem[] = [
      { text: '文法のまとめ', page: 3, x: 60, y: 100, width: 120, height: 10, fontSize: 10, isBold: false, mcid: 7 },
    ];
    const cands = layoutItemsToCandidates(items, [{ page: 3, mcid: 7, role: 'H2' }]);
    expect(cands.length).toBe(1);
    expect(cands[0]!.structRole).toBe('H2');
  });

  test('未知页宽时 centered 保持缺席（未知≠false）', () => {
    const cands = layoutItemsToCandidates(syntheticPage());
    expect(cands.length).toBe(1);
    expect('centered' in (cands[0] as Record<string, unknown>)).toBe(false);
  });

  test('空输入返回空数组（读侧永不抛）', () => {
    expect(layoutItemsToCandidates([])).toEqual([]);
  });
});

describe('mergeHeadingCandidates', () => {
  test('同行合并特征，正则 level 保留；纯版式行 level 记 0', () => {
    const merged = mergeHeadingCandidates(
      [{ page: 5, level: 2, text: '第3課' }],
      [
        { page: 5, text: '第3課', bold: true, relSize: 1.8 },
        { page: 6, text: 'まとめ', standalone: true },
      ]
    );
    expect(merged.length).toBe(2);
    expect(merged[0]).toMatchObject({ page: 5, level: 2, text: '第3課', bold: true, relSize: 1.8 });
    expect(merged[1]).toMatchObject({ page: 6, level: 0, text: 'まとめ', standalone: true });
  });
});
