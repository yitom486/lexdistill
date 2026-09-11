import { describe, expect, it } from 'bun:test';
import { isOk } from '@study-studio/shared';
import type { PdfInspectorLike } from '../application/pdf-import/pdf-runtime.js';
import { MAX_OCR_PAGES_PER_IMPORT } from '../application/pdf-import/pdf-import-service.js';
import {
  TOC_BASELINE_MAX_PAGES,
  TOC_BASELINE_MIN_CONFIDENCE,
  TOC_BASELINE_SOUP_NUMBERS,
  classifyTocEntryKind,
  extractTocBaseline,
  extractTocLineEntry,
  verifyTocGeometry,
  washRepeatedTocLines,
} from '../application/pdf-import/toc-baseline.js';

/**
 * CMD-LINGUA-P3 目录基线单测（全内存 mock/自撰 synthetic，无私人教材与课文）。
 * 自撰标题均为通用形；断言覆盖 kind/level/source 三轴。
 */
describe('P3 行抽取与 kind', () => {
  it('第N課/復習A 为 lesson，其余一律 section（会話/練習不得伪装成课）', () => {
    expect(classifyTocEntryKind('第12課 はじめまして')).toBe('lesson');
    expect(classifyTocEntryKind('復習A')).toBe('lesson');
    expect(classifyTocEntryKind('復習B')).toBe('lesson');
    expect(classifyTocEntryKind('会話')).toBe('section');
    expect(classifyTocEntryKind('練習A')).toBe('section');
    expect(classifyTocEntryKind('はじめに')).toBe('section');
  });

  it('尾页码形抽取 title/printedPage；表格行取末格数字', () => {
    expect(extractTocLineEntry('第1課 はじめまして ………………… 3')).toEqual({
      title: '第1課 はじめまして …………………',
      printedPage: 3,
      tableRow: false,
    });
    expect(extractTocLineEntry('| 第3課 | さんぽ | 11 |')).toEqual({
      title: '第3課 さんぽ',
      printedPage: 11,
      tableRow: true,
    });
  });

  it('拒绝：习题正文/数字汤/无题表格/纯页码', () => {
    expect(extractTocLineEntry('問3 これは___ですか')).toEqual({ refused: 'exercise' });
    expect(extractTocLineEntry('第1課 2 3 4')).toEqual({ refused: 'digit-soup' });
    expect(extractTocLineEntry('| 120 |')).toEqual({ refused: 'no-title' });
    expect(extractTocLineEntry('42')).toBeNull();
    expect(extractTocLineEntry('会話')).toBeNull();
    expect(extractTocLineEntry('   ')).toBeNull();
  });
});

describe('P3 保守清洗', () => {
  it('跨页头尾重复删，课号/尾页码/表格/短标题不删', () => {
    const pages = [
      { page: 2, lines: ['Lingua Textbook', '第1課 … 3', '| A | 1 |', 'もくじ', '本文です'] },
      { page: 3, lines: ['Lingua Textbook', '第2課 … 7', '本文です', 'つづき'] },
      { page: 4, lines: ['あとがき', 'Lingua Textbook'] },
    ];
    const washed = washRepeatedTocLines(pages);
    const kept = washed.kept.map((k) => k.text);
    // 头部重复的书名删；课号行/表格行/短标题保留；尾部重复的正文 sentence 同样删（2 处）
    expect(kept).not.toContain('Lingua Textbook');
    expect(kept).toContain('第1課 … 3');
    expect(kept).toContain('| A | 1 |');
    expect(kept).toContain('もくじ');
    expect(washed.dropped).toBe(5);
  });

  it('同文一次头一次尾（位置不一致）不删', () => {
    const pages = [
      { page: 2, lines: ['Some Header', 'a', 'b', 'c', 'd'] },
      { page: 3, lines: ['a', 'b', 'c', 'd', 'Some Header'] },
    ];
    const washed = washRepeatedTocLines(pages);
    expect(washed.kept.filter((k) => k.text === 'Some Header')).toHaveLength(2);
    expect(washed.dropped).toBe(0);
  });
});

describe('P3 几何验证', () => {
  const span = { text: '第1課 はじめまして ………………… 3', x: 10, y: 100, width: 300, height: 12, confidence: 0.9 };
  it('同行含标题且以页码结尾即几何成立', () => {
    expect(verifyTocGeometry([span], '第1課 はじめまして …………………', 3)).toBe(true);
  });
  it('低置信/标题缺席/页码不对即不成立', () => {
    expect(verifyTocGeometry([{ ...span, confidence: 0.2 }], '第1課 はじめまして …………………', 3)).toBe(false);
    expect(verifyTocGeometry([span], '第9課', 3)).toBe(false);
    expect(verifyTocGeometry([span], '第1課 はじめまして …………………', 4)).toBe(false);
    expect(verifyTocGeometry([], '第1課', 3)).toBe(false);
  });
});

describe('P3 常量锁定', () => {
  it('窗上限恒 ≤30 且 ≤OCR 上限；置信度与数字汤阈值固定', () => {
    expect(TOC_BASELINE_MAX_PAGES).toBeLessThanOrEqual(30);
    expect(TOC_BASELINE_MAX_PAGES).toBeLessThanOrEqual(MAX_OCR_PAGES_PER_IMPORT);
    expect(TOC_BASELINE_MIN_CONFIDENCE).toBe(0.5);
    expect(TOC_BASELINE_SOUP_NUMBERS).toBe(3);
  });
});

interface SpanInit {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

interface BaselineCalls {
  classify: Array<readonly number[] | undefined>;
  ocr: Array<number[] | undefined>;
}

function baselineMock(args: {
  pageCount: number;
  needing?: number[];
  mdByPage?: Record<number, string>;
  spansByPage?: Record<number, SpanInit[]>;
  routed?: number[];
  outline?: { value: unknown };
  calls: BaselineCalls;
}): PdfInspectorLike {
  const needing = args.needing ?? [];
  const md = args.mdByPage ?? {};
  const spans = args.spansByPage ?? {};
  const base: PdfInspectorLike = {
    processPdf: (_pdf, pages) => {
      args.calls.classify.push(pages);
      return { pdfType: 'TextBased', pageCount: args.pageCount, markdown: '', pagesNeedingOcr: [...needing] };
    },
    processPdfWithOcr: async (_pdf, options) => {
      const window = Array.isArray(options?.pageNumbers) ? options.pageNumbers : [];
      args.calls.ocr.push(window);
      return {
        markdown: '',
        pages: window.map((n) => ({ pageNumber: n, markdown: md[n] ?? '', spans: spans[n] ?? [] })),
        pagesRoutedToOcr: args.routed ?? window,
      };
    },
  };
  if (!args.outline) return base;
  return {
    ...base,
    extractEmbeddedOutline: () => {
      if (args.outline?.value instanceof Error) throw args.outline.value;
      // 故意喂畸形 native 负载时才需要断言（有注释）；正常用例均为合法形状。
      return args.outline?.value as import('../application/pdf-import/pdf-runtime.js').EmbeddedOutlineResult;
    },
  };
}

function newCalls(): BaselineCalls {
  return { classify: [], ocr: [] };
}

function mockBytes(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.4 mock-toc-baseline');
}

const PAGE2_MD = ['目次', '第1課 はじめまして ………………… 3', '第2課 これは本です ………………… 7', 'Lingua Textbook'].join(
  '\n'
);
const PAGE3_MD = ['第3課 さんぽ ………………… 11', '復習A ………………… 15', '会話 ………………… 4', '練習A ………………… 6', 'Lingua Textbook'].join(
  '\n'
);
const PAGE2_SPANS: SpanInit[] = [
  { text: '第1課 はじめまして ………………… 3', x: 10, y: 100, width: 300, height: 12, confidence: 0.9 },
  { text: '第2課 これは本です ………………… 7', x: 10, y: 130, width: 300, height: 12, confidence: 0.9 },
];

describe('P3 extractTocBaseline 编排', () => {
  it('两页日语目录：kind/level/source 全对，頁眉清洗不误删', async () => {
    const calls = newCalls();
    const res = await extractTocBaseline(
      {
        loadInspector: async () =>
          baselineMock({
            pageCount: 371,
            needing: [2, 3],
            mdByPage: { 2: PAGE2_MD, 3: PAGE3_MD },
            spansByPage: { 2: PAGE2_SPANS },
            routed: [2, 3],
            calls,
          }),
      },
      { userId: 'u1', filename: 'big.pdf', bytes: mockBytes(), fromPage: 2, toPage: 3 }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.status).toBe('ok');
    expect(res.value.range).toEqual({ fromPage: 2, toPage: 3 });
    expect(res.value.pageCount).toBe(371);
    expect(res.value.embedded).toBe(false);
    expect(res.value.entries).toEqual([
      { title: '第1課 はじめまして …………………', printedPage: 3, level: 1, source: 'geometry', kind: 'lesson' },
      { title: '第2課 これは本です …………………', printedPage: 7, level: 1, source: 'geometry', kind: 'lesson' },
      { title: '第3課 さんぽ …………………', printedPage: 11, level: 1, source: 'text', kind: 'lesson' },
      { title: '復習A …………………', printedPage: 15, level: 1, source: 'text', kind: 'lesson' },
      { title: '会話 …………………', printedPage: 4, level: 2, source: 'text', kind: 'section' },
      { title: '練習A …………………', printedPage: 6, level: 2, source: 'text', kind: 'section' },
    ]);
    expect(res.value.diagnostics).toEqual({
      pagesRequested: 2,
      pagesOcr: 2,
      linesConsidered: 9,
      linesDroppedWash: 2,
      entriesAccepted: 6,
      entriesRejected: 0,
    });
    // 分类全开窗（[1] 探 + [2,3] 窗），OCR 精确等于确认范围
    expect(calls.classify).toEqual([[1], [2, 3]]);
    expect(calls.ocr).toEqual([[2, 3]]);
  });

  it('geometry 优先于表格：同行 span 验证即 geometry 而非 table', async () => {
    const calls = newCalls();
    const tableMd = '| 第3課 | さんぽ | 11 |';
    const tableSpan: SpanInit[] = [{ text: tableMd, x: 5, y: 50, width: 200, height: 12, confidence: 0.95 }];
    const withSpan = await extractTocBaseline(
      {
        loadInspector: async () =>
          baselineMock({ pageCount: 10, mdByPage: { 2: tableMd }, spansByPage: { 2: tableSpan }, calls }),
      },
      { userId: 'u1', filename: 't.pdf', bytes: mockBytes(), fromPage: 2, toPage: 2 }
    );
    expect(isOk(withSpan)).toBe(true);
    if (!isOk(withSpan)) return;
    expect(withSpan.value.entries).toEqual([
      { title: '第3課 さんぽ', printedPage: 11, level: 1, source: 'geometry', kind: 'lesson' },
    ]);
    const calls2 = newCalls();
    const withoutSpan = await extractTocBaseline(
      {
        loadInspector: async () => baselineMock({ pageCount: 10, mdByPage: { 2: tableMd }, calls: calls2 }),
      },
      { userId: 'u1', filename: 't.pdf', bytes: mockBytes(), fromPage: 2, toPage: 2 }
    );
    expect(isOk(withoutSpan)).toBe(true);
    if (!isOk(withoutSpan)) return;
    expect(withoutSpan.value.entries).toEqual([
      { title: '第3課 さんぽ', printedPage: 11, level: 1, source: 'table', kind: 'lesson' },
    ]);
  });

  it('低置信 span 只降级为 text，不毙条目', async () => {
    const calls = newCalls();
    const res = await extractTocBaseline(
      {
        loadInspector: async () =>
          baselineMock({
            pageCount: 10,
            mdByPage: { 2: '第1課 … 3' },
            spansByPage: { 2: [{ text: '第1課 … 3', x: 1, y: 1, width: 9, height: 9, confidence: 0.2 }] },
            calls,
          }),
      },
      { userId: 'u1', filename: 't.pdf', bytes: mockBytes(), fromPage: 2, toPage: 2 }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.entries).toEqual([{ title: '第1課 …', printedPage: 3, level: 1, source: 'text', kind: 'lesson' }]);
  });

  it('范围错误在 OCR 前拒绝：超 30/越界/空范围零 OCR', async () => {
    const overCalls = newCalls();
    const over = await extractTocBaseline(
      { loadInspector: async () => baselineMock({ pageCount: 371, calls: overCalls }) },
      { userId: 'u1', filename: 'big.pdf', bytes: mockBytes(), fromPage: 1, toPage: 31 }
    );
    expect(isOk(over)).toBe(false);
    if (isOk(over)) return;
    expect(over.error.code).toBe('E_INVALID_INPUT');
    expect(overCalls.classify).toEqual([]);
    expect(overCalls.ocr).toEqual([]);

    const oobCalls = newCalls();
    const oob = await extractTocBaseline(
      { loadInspector: async () => baselineMock({ pageCount: 371, calls: oobCalls }) },
      { userId: 'u1', filename: 'big.pdf', bytes: mockBytes(), fromPage: 400, toPage: 405 }
    );
    expect(isOk(oob)).toBe(false);
    if (isOk(oob)) return;
    expect(oob.error.code).toBe('E_INVALID_INPUT');
    expect(oob.error.userMessage).toContain('371');
    expect(oobCalls.classify).toEqual([[1]]);
    expect(oobCalls.ocr).toEqual([]);

    const emptyCalls = newCalls();
    const empty = await extractTocBaseline(
      { loadInspector: async () => baselineMock({ pageCount: 371, calls: emptyCalls }) },
      { userId: 'u1', filename: 'big.pdf', bytes: mockBytes(), fromPage: 5, toPage: 3 }
    );
    expect(isOk(empty)).toBe(false);
    if (isOk(empty)) return;
    expect(empty.error.code).toBe('E_INVALID_INPUT');
    expect(emptyCalls.classify).toEqual([]);
    expect(emptyCalls.ocr).toEqual([]);
  });

  it('embedded 命中时 OCR 为 0（不伪造条目）', async () => {
    const calls = newCalls();
    const res = await extractTocBaseline(
      {
        loadInspector: async () =>
          baselineMock({
            pageCount: 371,
            mdByPage: { 2: PAGE2_MD },
            calls,
            outline: {
              value: {
                items: [
                  { title: '第1課', level: 1, physicalPage: 5 },
                  { title: '第2課', level: 1, physicalPage: 9 },
                ],
                unresolvedCount: 0,
                truncated: false,
              },
            },
          }),
      },
      { userId: 'u1', filename: 'outlined.pdf', bytes: mockBytes(), fromPage: 2, toPage: 3 }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.embedded).toBe(true);
    expect(res.value.status).toBe('empty');
    expect(res.value.entries).toEqual([]);
    expect(calls.ocr).toEqual([]);
  });
});
