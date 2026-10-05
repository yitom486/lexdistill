import { describe, expect, it } from 'bun:test';
import {
  MIN_SEMANTIC_RATIO,
  MIN_SEMANTIC_TITLES,
  classifyEmbeddedOutline,
  isSemanticOutlineTitle,
  type EmbeddedOutlineInspector,
  type EmbeddedOutlineSource,
} from '../../index.js';

/**
 * M8-5：自 Gateway 迁入（CMD-LINGUA-P2.2 内嵌目录质量门单测，纯内存桩）。
 * 标题均为自撰通用形；断言只涉及状态/reason/计数，不含正文。
 * 与 Gateway 版唯一差别：桩走新包最小契约（EmbeddedOutlineInspector），
 * 不再拼装 Gateway PdfInspectorLike 的 processPdf/processPdfWithOcr。
 */

function inspectorWith(outline: unknown): EmbeddedOutlineInspector {
  return {
    extractEmbeddedOutline: () => {
      if (outline instanceof Error) throw outline;
      return outline as EmbeddedOutlineSource;
    },
  };
}

function noMethodInspector(): EmbeddedOutlineInspector {
  return {};
}

function mockBytes(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.4 mock-quality');
}

function numericOutline(n: number): { items: Array<{ title: string; level: number; physicalPage: number }>; unresolvedCount: number; truncated: boolean } {
  return {
    items: Array.from({ length: n }, (_, i) => ({ title: String(i + 1), level: 1, physicalPage: i + 1 })),
    unresolvedCount: 0,
    truncated: false,
  };
}

describe('isSemanticOutlineTitle', () => {
  it('非语义：纯数字/全角数字/分隔数字/页码式/符号/空白', () => {
    for (const t of ['1', '12', '371', '１２３', '1.2', '1-3', '1/2', 'Page 5', 'page12', '5页', '5ページ', '5頁', '…', '---', '···', '   ', '']) {
      expect(isSemanticOutlineTitle(t)).toBe(false);
    }
  });

  it('语义：第1課/復習A/Lesson 1/第１章 はじめまして/章节文字', () => {
    for (const t of ['第1課', '復習A', 'Lesson 1', '第１章 はじめまして', 'Chapter 3', 'Unit 2', '練習B', 'はじめに', '文法まとめ']) {
      expect(isSemanticOutlineTitle(t)).toBe(true);
    }
  });
});

describe('classifyEmbeddedOutline 三态', () => {
  it('门槛常量锁定（保守：≥2 条且 ≥60%）', () => {
    expect(MIN_SEMANTIC_TITLES).toBe(2);
    expect(MIN_SEMANTIC_RATIO).toBe(0.6);
  });

  it('none：无方法/抛错/畸形/空目录', () => {
    expect(classifyEmbeddedOutline(noMethodInspector(), mockBytes(), 371).quality).toBe('none');
    expect(classifyEmbeddedOutline(noMethodInspector(), mockBytes(), 371).reason).toBe('no-method');
    expect(classifyEmbeddedOutline(inspectorWith(new Error('boom')), mockBytes(), 371)).toMatchObject({ quality: 'none', reason: 'threw' });
    expect(classifyEmbeddedOutline(inspectorWith({ items: 'nope' }), mockBytes(), 371)).toMatchObject({ quality: 'none', reason: 'malformed' });
    expect(classifyEmbeddedOutline(inspectorWith({ items: [], unresolvedCount: 0, truncated: false }), mockBytes(), 371)).toMatchObject({
      quality: 'none',
      reason: 'empty',
    });
  });

  it('unusable：纯 1/2/3… 数字书签（真书复现）', () => {
    const report = classifyEmbeddedOutline(inspectorWith(numericOutline(371)), mockBytes(), 371);
    expect(report.quality).toBe('unusable');
    expect(report.reason).toBe('no-semantic-titles');
    expect(report.totalItems).toBe(371);
    expect(report.validEntries).toBe(371);
    expect(report.semanticEntries).toBe(0);
  });

  it('unusable：truncated / 全无有效条目 / 全无语义', () => {
    const truncated = classifyEmbeddedOutline(
      inspectorWith({ items: [{ title: '第1課', level: 1, physicalPage: 5 }], unresolvedCount: 0, truncated: true }),
      mockBytes(),
      371
    );
    expect(truncated).toMatchObject({ quality: 'unusable', reason: 'truncated' });

    const noValid = classifyEmbeddedOutline(
      inspectorWith({ items: [{ title: '第1課', level: 1, physicalPage: 9999 }], unresolvedCount: 0, truncated: false }),
      mockBytes(),
      371
    );
    expect(noValid).toMatchObject({ quality: 'unusable', reason: 'no-valid-entries' });
  });

  it('unusable：单条语义不够（“一条文字即通过”被禁）', () => {
    const report = classifyEmbeddedOutline(
      inspectorWith({ items: [{ title: '第1課', level: 1, physicalPage: 5 }], unresolvedCount: 0, truncated: false }),
      mockBytes(),
      371
    );
    expect(report).toMatchObject({ quality: 'unusable', reason: 'below-threshold', validEntries: 1, semanticEntries: 1 });
  });

  it('unusable：2 条语义混在 8 条数字里（20% < 60%，不得误通过）', () => {
    const items = [
      { title: '第1課', level: 1, physicalPage: 5 },
      { title: '第2課', level: 1, physicalPage: 9 },
      ...Array.from({ length: 8 }, (_, i) => ({ title: String(i + 10), level: 1, physicalPage: 20 + i })),
    ];
    const report = classifyEmbeddedOutline(
      inspectorWith({ items, unresolvedCount: 0, truncated: false }),
      mockBytes(),
      371
    );
    expect(report).toMatchObject({ quality: 'unusable', reason: 'below-threshold', validEntries: 10, semanticEntries: 2 });
  });

  it('usable：第1課/復習A/Lesson 形达门槛，透传有效条目', () => {
    const report = classifyEmbeddedOutline(
      inspectorWith({
        items: [
          { title: '第1課', level: 1, physicalPage: 5 },
          { title: '復習A', level: 1, physicalPage: 9 },
          { title: 'Lesson 3', level: 2, physicalPage: 12 },
          { title: '40', level: 1, physicalPage: 15 },
        ],
        unresolvedCount: 0,
        truncated: false,
      }),
      mockBytes(),
      371
    );
    expect(report.quality).toBe('usable');
    expect(report.reason).toBe('ok');
    expect(report.validEntries).toBe(4);
    expect(report.semanticEntries).toBe(3);
    expect(report.entries).toEqual([
      { title: '第1課', level: 1, physicalPage: 5 },
      { title: '復習A', level: 1, physicalPage: 9 },
      { title: 'Lesson 3', level: 2, physicalPage: 12 },
      { title: '40', level: 1, physicalPage: 15 },
    ]);
    expect(report.directoryPage).toBeNull();
  });

  it('directoryPage：数字洪水中夹带“目录”仍可定位（真书二形态）', () => {
    const items = [
      { title: '封面', level: 1, physicalPage: 1 },
      { title: '目录', level: 1, physicalPage: 17 },
      ...Array.from({ length: 65 }, (_, i) => ({ title: String(i + 1), level: 1, physicalPage: 22 + i })),
    ];
    const report = classifyEmbeddedOutline(
      inspectorWith({ items, unresolvedCount: 0, truncated: false }),
      mockBytes(),
      371
    );
    // 语义 2/67 不到 60%：整体仍 unusable，但定位页可用。
    expect(report).toMatchObject({ quality: 'unusable', reason: 'below-threshold' });
    expect(report.directoryPage).toBe(17);
  });

  it('directoryPage：无定位书签/越界/模糊包含一律 null', () => {
    const noLocator = classifyEmbeddedOutline(inspectorWith(numericOutline(10)), mockBytes(), 371);
    expect(noLocator.directoryPage).toBeNull();
    const outOfRange = classifyEmbeddedOutline(
      inspectorWith({ items: [{ title: '目录', level: 1, physicalPage: 9999 }], unresolvedCount: 0, truncated: false }),
      mockBytes(),
      371
    );
    expect(outOfRange.directoryPage).toBeNull();
    const fuzzy = classifyEmbeddedOutline(
      inspectorWith({ items: [{ title: '目录学', level: 1, physicalPage: 5 }, { title: '第1課', level: 1, physicalPage: 9 }, { title: '第2課', level: 1, physicalPage: 12 }], unresolvedCount: 0, truncated: false }),
      mockBytes(),
      371
    );
    expect(fuzzy.directoryPage).toBeNull();
  });
});
