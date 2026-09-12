import { describe, expect, it } from 'bun:test';
import { isOk } from '@study-studio/shared';
import type { PdfInspectorLike } from '../application/pdf-import/pdf-runtime.js';
import { MAX_OCR_PAGES_PER_IMPORT } from '../application/pdf-import/pdf-import-service.js';
import {
  TOC_BASELINE_MAX_PAGES,
  TOC_BASELINE_MIN_CONFIDENCE,
  TOC_BASELINE_SOUP_NUMBERS,
  assembleTocBaseline,
  classifyTocEntryKind,
  countRawDigits,
  extractTocBaseline,
  extractTocLineEntry,
  maybeUnresolvedCandidate,
  resolveDigitLossStage,
  summarizePageStage,
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
    // 本书復習到 G：C–G 同为 lesson（課号 token 不止 A/B；練習C 仍是 section）
    expect(classifyTocEntryKind('復習C')).toBe('lesson');
    expect(classifyTocEntryKind('復習G')).toBe('lesson');
    expect(classifyTocEntryKind('練習C')).toBe('section');
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
  const span = { text: '第1課 はじめまして ………………… 3', x: 10, y: 100, width: 300, height: 12, confidence: 0.9, source: 'ocr' as const };
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
  positioned: Array<readonly number[] | undefined>;
}

interface NativeItemInit {
  text: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

function baselineMock(args: {
  pageCount: number;
  needing?: number[];
  mdByPage?: Record<number, string>;
  spansByPage?: Record<number, SpanInit[]>;
  nativeByPage?: Record<number, NativeItemInit[]>;
  routed?: number[];
  outline?: { value: unknown };
  calls: BaselineCalls;
}): PdfInspectorLike {
  const needing = args.needing ?? [];
  const md = args.mdByPage ?? {};
  const spans = args.spansByPage ?? {};
  const natives = args.nativeByPage ?? {};
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
    extractTextWithPositions: (_pdf, pages) => {
      args.calls.positioned.push(pages);
      const wanted = new Set(Array.isArray(pages) ? pages : []);
      const out: NativeItemInit[] = [];
      for (const [key, items] of Object.entries(natives)) {
        if (wanted.has(Number(key))) out.push(...items);
      }
      return out as never;
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
  return { classify: [], ocr: [], positioned: [] };
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
      { title: '第1課 はじめまして …………………', printedPage: 3, level: 1, source: 'geometry-block', kind: 'lesson' },
      { title: '第2課 これは本です …………………', printedPage: 7, level: 1, source: 'geometry-block', kind: 'lesson' },
      { title: '第3課 さんぽ …………………', printedPage: 11, level: 1, source: 'text-fallback', kind: 'lesson' },
      { title: '復習A …………………', printedPage: 15, level: 1, source: 'text-fallback', kind: 'lesson' },
      { title: '会話 …………………', printedPage: 4, level: 2, source: 'text-fallback', kind: 'section' },
      { title: '練習A …………………', printedPage: 6, level: 2, source: 'text-fallback', kind: 'section' },
    ]);
    expect(res.value.diagnostics).toEqual({
      pagesRequested: 2,
      pagesOcr: 2,
      linesConsidered: 9,
      linesDroppedWash: 2,
      entriesAccepted: 6,
      entriesRejected: 0,
      badTitle: 0,
      entriesFromBlocks: 0,
      unresolvedBlocks: 0,
    });
    expect(res.value.verdict).toBe('usable');
    expect(res.value.pageEvidence.map((e) => e.page)).toEqual([2, 3]);
    for (const evidence of res.value.pageEvidence) {
      expect(evidence.excerpt.length).toBeLessThanOrEqual(1500 + 6);
    }
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
      { title: '第3課 さんぽ', printedPage: 11, level: 1, source: 'geometry-block', kind: 'lesson' },
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
      { title: '第3課 さんぽ', printedPage: 11, level: 1, source: 'text-fallback', kind: 'lesson' },
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
    expect(res.value.entries).toEqual([{ title: '第1課 …', printedPage: 3, level: 1, source: 'text-fallback', kind: 'lesson' }]);
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

  it('embedded 命中时 OCR 为 0（不伪造条目）', async () => {    const calls = newCalls();
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
    expect(res.value.pageEvidence).toEqual([]);
    expect(calls.ocr).toEqual([]);
  });
});

describe('P3.1B 基线质量 verdict（无语义标题拒绝）', () => {
  it('extractTocLineEntry：符号-only/Markdown 残留/纯数字形 → bad-title', () => {
    expect(extractTocLineEntry('##### …… 322')).toEqual({ refused: 'bad-title' });
    expect(extractTocLineEntry('··· 15')).toEqual({ refused: 'bad-title' });
    expect(extractTocLineEntry('12 34')).toEqual({ refused: 'bad-title' });
    expect(extractTocLineEntry('| 120 |')).toEqual({ refused: 'no-title' });
    // 正常行不受影响（含 Markdown 前导符但有实质标题的保留原文）
    expect(extractTocLineEntry('第1課 はじめまして 3')).toMatchObject({ title: '第1課 はじめまして', printedPage: 3 });
    expect(extractTocLineEntry('| 第3課 | さんぽ | 11 |')).toMatchObject({ title: '第3課 さんぽ', printedPage: 11 });
  });

  it('垃圾 + 1 条有效 → thin：拒绝采用链，badTitle 计数，证据有界', async () => {
    const calls = newCalls();
    const garbageMd = ['##### …… 322', '第1課 はじめまして 3', 'Lingua Textbook'].join('\n');
    const res = await extractTocBaseline(
      {
        loadInspector: async () =>
          baselineMock({ pageCount: 371, needing: [16], mdByPage: { 16: garbageMd }, routed: [16], calls }),
      },
      { userId: 'u1', filename: 'big.pdf', bytes: mockBytes(), fromPage: 16, toPage: 16 }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.entries).toEqual([
      { title: '第1課 はじめまして', printedPage: 3, level: 1, source: 'text-fallback', kind: 'lesson' },
    ]);
    expect(res.value.status).toBe('ok');
    expect(res.value.verdict).toBe('thin');
    expect(res.value.diagnostics.badTitle).toBe(1);
    expect(res.value.pageEvidence).toEqual([{ page: 16, excerpt: expect.any(String) as string }]);
    expect((res.value.pageEvidence[0]?.excerpt as string).length).toBeLessThanOrEqual(1506);
  });

  it('全垃圾 → empty', async () => {
    const calls = newCalls();
    const garbageMd = ['##### …… 322', '··· 15'].join('\n');
    const res = await extractTocBaseline(
      {
        loadInspector: async () =>
          baselineMock({ pageCount: 371, needing: [16], mdByPage: { 16: garbageMd }, routed: [16], calls }),
      },
      { userId: 'u1', filename: 'big.pdf', bytes: mockBytes(), fromPage: 16, toPage: 16 }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.entries).toEqual([]);
    expect(res.value.status).toBe('empty');
    expect(res.value.verdict).toBe('empty');
    expect(res.value.diagnostics.badTitle).toBe(2);
  });

  it('单条有效也 thin（<2 条不可采用）；两条有效 usable', async () => {
    const oneCalls = newCalls();
    const one = await extractTocBaseline(
      {
        loadInspector: async () =>
          baselineMock({ pageCount: 371, needing: [2], mdByPage: { 2: '第1課 はじめまして 3' }, routed: [2], calls: oneCalls }),
      },
      { userId: 'u1', filename: 't.pdf', bytes: mockBytes(), fromPage: 2, toPage: 2 }
    );
    expect(isOk(one)).toBe(true);
    if (!isOk(one)) return;
    expect(one.value.entries.length).toBe(1);
    expect(one.value.verdict).toBe('thin');

    const twoCalls = newCalls();
    const two = await extractTocBaseline(
      {
        loadInspector: async () =>
          baselineMock({
            pageCount: 371,
            needing: [2],
            mdByPage: { 2: '第1課 はじめまして 3\n第2課 これは本です 7' },
            routed: [2],
            calls: twoCalls,
          }),
      },
      { userId: 'u1', filename: 't.pdf', bytes: mockBytes(), fromPage: 2, toPage: 2 }
    );
    expect(isOk(two)).toBe(true);
    if (!isOk(two)) return;
    expect(two.value.entries.length).toBe(2);
    expect(two.value.verdict).toBe('usable');
  });

  it('超长页 evidence 截断有界（含截断标记）', async () => {
    const calls = newCalls();
    const longLine = `第1課 ${'あ'.repeat(5000)} 3`;
    const res = await extractTocBaseline(
      {
        loadInspector: async () =>
          baselineMock({ pageCount: 371, needing: [2], mdByPage: { 2: longLine }, routed: [2], calls }),
      },
      { userId: 'u1', filename: 't.pdf', bytes: mockBytes(), fromPage: 2, toPage: 2 }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const excerpt = res.value.pageEvidence[0]?.excerpt as string;
    expect(excerpt.length).toBeLessThanOrEqual(1506);
    expect(excerpt.endsWith('…(已截断)')).toBe(true);
  });
});

describe('P3.2B 版式块编排（坐标补缺口）', () => {
  const J1_MD = ['目次', '第3課 さんぽ …………………', '30', '本文つづき'].join('\n');
  const J1_SPANS: SpanInit[] = [
    { text: '目次', x: 50, y: 730, width: 40, height: 12, confidence: 0.9 },
    { text: '第3課 さんぽ …………………', x: 50, y: 642, width: 220, height: 12, confidence: 0.9 },
    { text: '30', x: 50, y: 620, width: 14, height: 12, confidence: 0.9 },
    { text: '本文つづき', x: 50, y: 500, width: 100, height: 12, confidence: 0.9 },
  ];

  it('J1 断行：markdown 零条目 → 块按坐标补 1 条 geometry-block（不猜第二条）', async () => {
    const calls = newCalls();
    const res = await extractTocBaseline(
      {
        loadInspector: async () =>
          baselineMock({ pageCount: 371, needing: [16], mdByPage: { 16: J1_MD }, spansByPage: { 16: J1_SPANS }, routed: [16], calls }),
      },
      { userId: 'u1', filename: 'big.pdf', bytes: mockBytes(), fromPage: 16, toPage: 16 }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.entries).toEqual([
      { title: '第3課 さんぽ', printedPage: 30, level: 1, source: 'geometry-block', kind: 'lesson' },
    ]);
    expect(res.value.verdict).toBe('thin');
    expect(res.value.diagnostics.entriesFromBlocks).toBe(1);
    expect(res.value.diagnostics.unresolvedBlocks).toBe(0);
  });

  it('OCR 无 spans 时回填 native 定位：同 J1 形状同样补条目', async () => {
    const calls = newCalls();
    const res = await extractTocBaseline(
      {
        loadInspector: async () =>
          baselineMock({
            pageCount: 371,
            needing: [],
            mdByPage: { 16: J1_MD },
            routed: [],
            nativeByPage: {
              16: J1_SPANS.map((s) => ({ text: s.text, page: 16, x: s.x, y: s.y, width: s.width, height: s.height })),
            },
            calls,
          }),
      },
      { userId: 'u1', filename: 'big.pdf', bytes: mockBytes(), fromPage: 16, toPage: 16 }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.entries).toEqual([
      { title: '第3課 さんぽ', printedPage: 30, level: 1, source: 'geometry-block', kind: 'lesson' },
    ]);
    expect(calls.positioned).toEqual([[16]]);
    expect(res.value.diagnostics.entriesFromBlocks).toBe(1);
  });

  it('OCR 有 spans 的页不调 native（只填空页）；无坐标方法时静默降级', async () => {
    const calls = newCalls();
    const res = await extractTocBaseline(
      {
        loadInspector: async () =>
          baselineMock({ pageCount: 371, needing: [16], mdByPage: { 16: J1_MD }, spansByPage: { 16: J1_SPANS }, routed: [16], calls }),
      },
      { userId: 'u1', filename: 'big.pdf', bytes: mockBytes(), fromPage: 16, toPage: 16 }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(calls.positioned).toEqual([]);
    expect(res.value.diagnostics.entriesFromBlocks).toBe(1);
  });

  it('heading 无候选 → unresolved 计数，条目为 empty（绝不猜页码）', async () => {
    const calls = newCalls();
    const md = ['目次', '第7課 まち', '本文つづき'].join('\n');
    const res = await extractTocBaseline(
      {
        loadInspector: async () =>
          baselineMock({
            pageCount: 371,
            needing: [16],
            mdByPage: { 16: md },
            spansByPage: {
              16: [
                { text: '目次', x: 50, y: 730, width: 40, height: 12, confidence: 0.9 },
                { text: '第7課 まち', x: 50, y: 640, width: 150, height: 12, confidence: 0.9 },
                { text: '本文つづき', x: 50, y: 500, width: 100, height: 12, confidence: 0.9 },
              ],
            },
            routed: [16],
            calls,
          }),
      },
      { userId: 'u1', filename: 'big.pdf', bytes: mockBytes(), fromPage: 16, toPage: 16 }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.entries).toEqual([]);
    expect(res.value.verdict).toBe('empty');
    expect(res.value.diagnostics.unresolvedBlocks).toBe(1);
  });
});

describe('P3.5-FIX 未定位候选（无码有效标题不静默丢）', () => {
  it('maybeUnresolvedCandidate：课号/语义标题成候选，正文/空行/超长/非法页不是', () => {
    expect(maybeUnresolvedCandidate('## 第1課', 16)).toEqual({ title: '第1課', page: 16 });
    expect(maybeUnresolvedCandidate('復習A', 16)).toMatchObject({ title: '復習A', page: 16 });
    // 復習C–G 同为候选（课号 token 不止 A/B）；練習C 不是课号，不进候选
    expect(maybeUnresolvedCandidate('復習C', 16)).toMatchObject({ title: '復習C', page: 16 });
    expect(maybeUnresolvedCandidate('復習G', 16)).toMatchObject({ title: '復習G', page: 16 });
    expect(maybeUnresolvedCandidate('練習C', 16)).toBeNull();
    expect(maybeUnresolvedCandidate('わたしは　マイクです。', 16)).toBeNull();
    expect(maybeUnresolvedCandidate('   ', 16)).toBeNull();
    expect(maybeUnresolvedCandidate('第1課', 0)).toBeNull();
    expect(maybeUnresolvedCandidate(`${'あ'.repeat(201)}`, 16)).toBeNull();
  });

  it('assemble：无码课号行进候选，已转正标题不进候选，同标题同页去重', () => {
    const out = assembleTocBaseline({
      window: [16],
      keptByPage: new Map([
        [16, [
          { page: 16, text: '## 第1課' },
          { page: 16, text: '第2課 18' },
          { page: 16, text: '## 第1課' },
          { page: 16, text: '## 第2課' },
          { page: 16, text: 'わたしは　マイクです。' },
        ]],
      ]),
      evidenceByPage: new Map([[16, ['## 第1課', '第2課 18']]]),
      spansByPage: new Map(),
      ocrPages: [16],
      washedKept: 5,
      washedDropped: 0,
    });
    expect(out.entries.map((e) => e.title)).toEqual(['第2課']);
    // 第1課：重复光杆行去重后仅一条；第2課已转正不再候选；正文行不污染
    expect(out.unresolvedCandidates).toEqual([{ title: '第1課', page: 16 }]);
  });

  it('summarizePageStage：只记形状计数不记文本；ocr/native 右栏数字分开计数', () => {
    const summary = summarizePageStage(
      16,
      10,
      { total: 4, validCoords: 3, rightDigits: 3, trailingDigits: 0 },
      [
        { text: '第1課', x: 50, y: 300, width: 60, height: 14, source: 'ocr' },
        { text: '6', x: 500, y: 300, width: 12, height: 14, source: 'ocr' },
        { text: '18', x: 505, y: 400, width: 20, height: 14, source: 'ocr' },
        { text: '3', x: 60, y: 500, width: 10, height: 12, source: 'ocr' },
        { text: '9', x: 502, y: 600, width: 11, height: 13, source: 'native-fallback' },
      ],
      '## 第1課\n第2課 18\n3. something',
      3
    );
    expect(summary.page).toBe(16);
    expect(summary.rawSpans).toBe(10);
    expect(summary.rawDigitTexts).toBe(4);
    expect(summary.rawDigitValidCoords).toBe(3);
    expect(summary.rawRightDigitTexts).toBe(3);
    expect(summary.rawTrailingPageSpans).toBe(0);
    expect(summary.narrowedSpans).toBe(5);
    // raw 4 > valid 3：有数字死在坐标门，优先级压住一切，verdict 未定
    expect(summary.verdict).toBe('coord-gate-undecided');
    // 右栏：6@500 与 18@505 记 ocr（最大右端 525 的 85% 以右）；
    // 9@502 来自 native 回填，另计不合并；左侧 3 不算
    expect(summary.ocrRightDigitSpans).toBe(2);
    expect(summary.nativeRightDigitSpans).toBe(1);
    expect(summary.ocrRightDigitBoxes).toHaveLength(2);
    expect(summary.ocrRightDigitBoxes[0]).toEqual([500, 300, 12, 14, 1, true]);
    expect(summary.nativeRightDigitBoxes).toHaveLength(1);
    // 摘要无文本原文
    expect(JSON.stringify(summary)).not.toContain('第1課');
    expect(summary.markdownTrailingDigits).toBe(1);
    // token 计数含课序号数字（第1課的 1、第2課的 2）+ 页码 18 + 序号 3 = 4；
    // 定责看行尾数，token 数仅作水位参考
    expect(summary.markdownDigitTokens).toBe(4);
    expect(summary.keptLines).toBe(3);
  });

  it('防误判：左侧题号存在、右栏页码不存在 → rawRightDigitTexts 为 0（不得判规范化丢失）', () => {
    // 陷阱：整页有 4 个纯数字（题号 1/2/3/4 全在左侧），右栏一个数字没有。
    // 旧整页口径 rawDigitTexts=4 会误报规范化丢失；右栏口径必须为 0。
    const raw = countRawDigits([
      { text: '1', x: 60, y: 100, width: 10, height: 12 },
      { text: '2', x: 60, y: 200, width: 10, height: 12 },
      { text: '3', x: 60, y: 300, width: 10, height: 12 },
      { text: '4', x: 60, y: 400, width: 10, height: 12 },
      { text: '第1課', x: 50, y: 500, width: 60, height: 14 },
      { text: '目录页标题栏很宽很宽很宽很宽', x: 50, y: 50, width: 400, height: 14 },
    ]);
    expect(raw).toEqual({ total: 4, validCoords: 4, rightDigits: 0, trailingDigits: 0 });
    const summary = summarizePageStage(
      16,
      6,
      raw,
      [
        { text: '1', x: 60, y: 100, width: 10, height: 12, source: 'ocr' },
        { text: '2', x: 60, y: 200, width: 10, height: 12, source: 'ocr' },
        { text: '3', x: 60, y: 300, width: 10, height: 12, source: 'ocr' },
        { text: '4', x: 60, y: 400, width: 10, height: 12, source: 'ocr' },
        { text: '第1課', x: 50, y: 500, width: 60, height: 14, source: 'ocr' },
      ],
      '## 第1課\n1. xxx\n2. xxx',
      3
    );
    expect(summary.rawRightDigitTexts).toBe(0);
    expect(summary.ocrRightDigitSpans).toBe(0);
    // Markdown 同样无行尾数字：判据对齐"目标右栏数字未从 OCR 出来"，而非规范化丢失
    expect(summary.markdownTrailingDigits).toBe(0);
    expect(summary.verdict).toBe('no-locatable-right-digits');
  });

  it('优先级冲突锁定：原始6存在但坐标非法 → 未定，不得落入无右栏数', () => {
    // 用户指定的必备回归：OCR 给了 6 但无合法坐标（进 total 差值），
    // 右栏计数为零且 Markdown 无行尾数——此时判"无右栏数"就是误判。
    const raw = countRawDigits([
      { text: '6', y: 300 },
      { text: '目录页标题栏很宽很宽很宽很宽', x: 50, y: 50, width: 400, height: 14 },
    ]);
    expect(raw).toEqual({ total: 1, validCoords: 0, rightDigits: 0, trailingDigits: 0 });
    const summary = summarizePageStage(16, 2, raw, [], '## 第1課', 1);
    expect(summary.rawRightDigitTexts).toBe(0);
    expect(summary.markdownTrailingDigits).toBe(0);
    expect(summary.verdict).not.toBe('no-right-digits');
    expect(summary.verdict).toBe('coord-gate-undecided');
  });

  it('resolveDigitLossStage：优先级不可调换（坐标门 > 右栏两口径 > Markdown）', () => {
    const v = (o: { t: number; c: number; r: number; g: number; m: number }) =>
      resolveDigitLossStage({
        rawDigitTexts: o.t,
        rawDigitValidCoords: o.c,
        rawRightDigitTexts: o.r,
        rawTrailingPageSpans: o.g,
        markdownTrailingDigits: o.m,
      });
    // 右栏有数、Markdown 无数，但同时有数字死在坐标门 → 仍未定（不得判规范化丢失）
    expect(v({ t: 3, c: 2, r: 2, g: 0, m: 0 })).toBe('coord-gate-undecided');
    // 坐标齐：两口径皆零 → 未观察到可定位右栏数字（不是"引擎没识别"）
    expect(v({ t: 2, c: 2, r: 0, g: 0, m: 0 })).toBe('no-locatable-right-digits');
    // 坐标齐：行内嵌有数、Markdown 无数 → 规范化丢失（独立列为零也不影响）
    expect(v({ t: 1, c: 1, r: 0, g: 1, m: 0 })).toBe('normalization-loss');
    // 坐标齐：独立列有数、Markdown 无数 → 规范化丢失
    expect(v({ t: 2, c: 2, r: 2, g: 0, m: 0 })).toBe('normalization-loss');
    // 坐标齐：右栏有数、Markdown 有数 → 数字链到达 Markdown（成条另看 entries）
    expect(v({ t: 2, c: 2, r: 2, g: 0, m: 2 })).toBe('digits-reached-markdown');
    // 全零 → 无数字可定，归为未观察到
    expect(v({ t: 0, c: 0, r: 0, g: 0, m: 0 })).toBe('no-locatable-right-digits');
  });

  it('countRawDigits：收窄前统计纯数字、合法坐标、右栏与行内嵌子集', () => {
    expect(
      countRawDigits([
        { text: '6', x: 1, y: 2, width: 3, height: 4 },
        { text: '18', x: 1, y: 2, width: 3, height: NaN },
        { text: '第1課', x: 1, y: 2, width: 3, height: 4 },
        null,
        'junk',
      ])
    ).toEqual({ total: 2, validCoords: 1, rightDigits: 1, trailingDigits: 0 });
    expect(countRawDigits(undefined)).toEqual({ total: 0, validCoords: 0, rightDigits: 0, trailingDigits: 0 });
  });

  it('countRawDigits：行尾数字行单记 trailing，不进右栏列', () => {
    expect(
      countRawDigits([
        { text: '第1課……6', x: 50, y: 300, width: 460, height: 14 },
        { text: '復習A42', x: 50, y: 400, width: 200, height: 14 },
        { text: '会話：初めまして', x: 50, y: 500, width: 200, height: 14 },
      ])
    ).toEqual({ total: 2, validCoords: 2, rightDigits: 0, trailingDigits: 2 });
  });

  it('回归：第1課……6行span在、Markdown丢尾数 → normalization-loss（不得判无右栏数）', () => {
    const raw = countRawDigits([
      { text: '第1課……6', x: 50, y: 300, width: 460, height: 14 },
      { text: '第2課', x: 50, y: 400, width: 60, height: 14 },
    ]);
    expect(raw).toEqual({ total: 1, validCoords: 1, rightDigits: 0, trailingDigits: 1 });
    const summary = summarizePageStage(
      16,
      2,
      raw,
      [{ text: '第1課……6', x: 50, y: 300, width: 460, height: 14, source: 'ocr' }],
      '## 第1課',
      1
    );
    expect(summary.rawTrailingPageSpans).toBe(1);
    expect(summary.markdownTrailingDigits).toBe(0);
    expect(summary.verdict).toBe('normalization-loss');
    expect(summary.verdict).not.toBe('no-locatable-right-digits');
  });

  it('summarizePageStage：空 spans 不崩，右栏判据退化为 0', () => {
    const summary = summarizePageStage(
      16,
      0,
      { total: 0, validCoords: 0, rightDigits: 0, trailingDigits: 0 },
      [],
      '',
      0
    );
    expect(summary).toMatchObject({
      page: 16,
      rawSpans: 0,
      rawDigitTexts: 0,
      rawDigitValidCoords: 0,
      rawRightDigitTexts: 0,
      narrowedSpans: 0,
      ocrRightDigitSpans: 0,
      nativeRightDigitSpans: 0,
      ocrRightDigitBoxes: [],
      nativeRightDigitBoxes: [],
      keptLines: 0,
    });
  });
});
