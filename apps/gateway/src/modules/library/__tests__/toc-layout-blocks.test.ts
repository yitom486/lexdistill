import { describe, expect, it } from 'bun:test';
import {
  TOC_BLOCK_ADJACENT_Y_RATIO,
  TOC_BLOCK_EDGE_BAND_RATIO,
  TOC_BLOCK_PAGE_MAX,
  TOC_BLOCK_ROW_Y_RATIO,
  matchTocLayoutBlocks,
} from '../application/pdf-import/toc-layout-blocks.js';
import type { TocGeometrySpan } from '../application/pdf-import/toc-baseline.js';

/**
 * CMD-LINGUA-P3.2B 版式块匹配单测（全手写 synthetic 坐标，无私人教材与课文）。
 * 坐标系与探针一致：y-up（大 y 在页顶），字高 11–12pt、行距 22pt。
 */
function span(text: string, x: number, y: number, width: number, height = 12, confidence = 0.9): TocGeometrySpan {
  return { text, x, y, width, height, confidence };
}

describe('P3.2B 常量锁定', () => {
  it('同行/邻行/边带/页码上限固定', () => {
    expect(TOC_BLOCK_ROW_Y_RATIO).toBe(0.6);
    expect(TOC_BLOCK_ADJACENT_Y_RATIO).toBe(2.2);
    expect(TOC_BLOCK_EDGE_BAND_RATIO).toBe(0.12);
    expect(TOC_BLOCK_PAGE_MAX).toBe(1500);
  });
});

describe('P3.2B 双栏与跨行关联', () => {
  it('双栏：标题左、页码右同行 → 条目', () => {
    const out = matchTocLayoutBlocks([
      span('目次', 50, 730, 40),
      span('第5課 りょこう', 50, 640, 200),
      span('25', 400, 642, 20),
      span('本文つづき', 50, 500, 100),
    ]);
    expect(out.entries).toEqual([{ title: '第5課 りょこう', printedPage: 25 }]);
    expect(out.unresolved).toBe(0);
  });

  it('跨行（J1 断行）：页码在标题正下方同 x → 条目', () => {
    const out = matchTocLayoutBlocks([
      span('目次', 50, 730, 40),
      span('第3課 さんぽ …………………', 50, 642, 220),
      span('30', 50, 620, 14),
      span('本文つづき', 50, 500, 100),
      span('16', 50, 100, 14),
    ]);
    expect(out.entries).toEqual([{ title: '第3課 さんぽ', printedPage: 30 }]);
    expect(out.unresolved).toBe(0);
  });

  it('跨行右下：页码在标题下一行右侧 → 条目', () => {
    const out = matchTocLayoutBlocks([
      span('目次', 50, 730, 40),
      span('第6課 てんき', 50, 640, 150),
      span('42', 400, 618, 20),
      span('本文つづき', 50, 500, 100),
    ]);
    expect(out.entries).toEqual([{ title: '第6課 てんき', printedPage: 42 }]);
    expect(out.unresolved).toBe(0);
  });

  it('双栏两列：右列页码归右列标题（水平最近），左列标题转邻行', () => {
    const out = matchTocLayoutBlocks([
      span('第1課 あいさつ', 50, 640, 150),
      span('第11課 たべもの', 330, 641, 150),
      span('78', 520, 642, 20),
      span('3', 250, 618, 14),
      span('本文つづき', 50, 500, 100),
    ]);
    expect(out.entries).toContainEqual({ title: '第11課 たべもの', printedPage: 78 });
    expect(out.entries).toContainEqual({ title: '第1課 あいさつ', printedPage: 3 });
    expect(out.unresolved).toBe(0);
  });
});

describe('P3.2B 黏连形', () => {
  it('復習A42/第3課42 拆分；Unit 10 不误拆', () => {
    const out = matchTocLayoutBlocks([
      span('復習A42', 50, 640, 120),
      span('第3課 さんぽ42', 50, 610, 160),
      span('Unit 10', 50, 580, 100),
      span('本文つづき', 50, 500, 100),
    ]);
    expect(out.entries).toContainEqual({ title: '復習A', printedPage: 42 });
    expect(out.entries).toContainEqual({ title: '第3課 さんぽ', printedPage: 42 });
    expect(out.entries).toHaveLength(2);
  });
});

describe('P3.2B 误配护栏', () => {
  it('例句数字/无课号行：无 heading 即零条目零 unresolved', () => {
    const out = matchTocLayoutBlocks([
      span('これは本です。12ページを見てください', 50, 640, 260),
      span('7', 400, 642, 14),
      span('本文つづき', 50, 500, 100),
    ]);
    expect(out.entries).toEqual([]);
    expect(out.unresolved).toBe(0);
  });

  it('习题行（問N）纵有邻号也不配对', () => {
    const out = matchTocLayoutBlocks([
      span('問3 つぎの文を読んでください', 50, 640, 240),
      span('42', 400, 642, 14),
      span('本文つづき', 50, 500, 100),
    ]);
    expect(out.entries).toEqual([]);
    expect(out.unresolved).toBe(0);
  });

  it('页脚 folio 不得当页码：heading 无候选 → no-page（不猜）', () => {
    const out = matchTocLayoutBlocks([
      span('Lingua Textbook', 50, 760, 150),
      span('目次', 50, 730, 40),
      span('第7課 まち', 50, 640, 150),
      span('本文つづき', 50, 600, 100),
      span('本文つづき2', 50, 560, 100),
      span('本文つづき3', 50, 520, 100),
      span('本文つづき4', 50, 480, 100),
      span('17', 300, 100, 14),
    ]);
    expect(out.entries).toEqual([]);
    expect(out.unresolved).toBe(1);
    expect(out.unresolvedReasons).toEqual({ 'no-page': 1, contested: 0, 'low-confidence': 0 });
  });

  it('年份/超大数字不当页码', () => {
    const out = matchTocLayoutBlocks([
      span('第8課 りょこう', 50, 640, 150),
      span('2024', 400, 642, 30),
      span('本文つづき', 50, 500, 100),
    ]);
    expect(out.entries).toEqual([]);
    expect(out.unresolved).toBe(1);
  });

  it('双 heading 争一号：上者得，下者 contested（不猜第二解）', () => {
    const out = matchTocLayoutBlocks([
      span('第1課 あいさつ', 50, 640, 150),
      span('第2課 がっこう', 50, 622, 150),
      span('9', 400, 625, 14),
      span('本文つづき', 50, 500, 100),
    ]);
    expect(out.entries).toHaveLength(1);
    expect(out.unresolved).toBe(1);
    expect(out.unresolvedReasons.contested).toBe(1);
  });

  it('低置信 heading 只计 unresolved，不配对', () => {
    const out = matchTocLayoutBlocks([
      span('第9課 まとめ', 50, 640, 150, 12, 0.2),
      span('55', 400, 642, 14),
      span('本文つづき', 50, 500, 100),
    ]);
    expect(out.entries).toEqual([]);
    expect(out.unresolved).toBe(1);
    expect(out.unresolvedReasons['low-confidence']).toBe(1);
  });

  it('无坐标（空数组）→ 零条目零 unresolved（调用方降级文本路径）', () => {
    expect(matchTocLayoutBlocks([])).toEqual({
      entries: [],
      unresolved: 0,
      unresolvedReasons: { 'no-page': 0, contested: 0, 'low-confidence': 0 },
    });
  });
});
