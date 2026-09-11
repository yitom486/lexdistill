import { describe, expect, it } from 'bun:test';
import { isOk } from '@study-studio/shared';
import { MAX_OCR_PAGES_PER_IMPORT } from '../application/pdf-import/pdf-import-service.js';
import type { PdfInspectorLike } from '../application/pdf-import/pdf-runtime.js';
import {
  TOC_DISCOVERY_MAX_PAGES,
  TOC_DISCOVERY_SCORE,
  discoverTocPages,
  extractTocPageFeatures,
  mergeTocCandidateRanges,
  scoreTocDiscoveryPage,
} from '../application/pdf-import/toc-discovery.js';

/**
 * CMD-LINGUA-P2 目录页发现单测（全内存 mock/synthetic，无私人教材）。
 * 断言标题均为自撰通用形；不含任何课文正文。
 */

// 自撰日语形目录页（1 页 5 条：目次 + 第1–3課 + 復習A，点线 + 尾页码）。
const JA_TOC = [
  '目次',
  '第1課 はじめまして ………………… 2',
  '第2課 これは本です ………………… 5',
  '第3課 さんぽ ………………… 8',
  '復習A ………………… 12',
].join('\n');

// 自撰第二段目录页（与上连续）。
const JA_TOC_2 = ['第4課 てんき ………………… 15', '第5課 かぞく ………………… 18'].join('\n');

// 自撰习题页（問号题干 + 练习字样，无目录锚点）。
const EXERCISE_PAGE = ['練習A', '問1 これは___ですか。', '問2 つぎの___をえらびなさい。', '1. はい 2. いいえ'].join(
  '\n'
);

// 自撰普通表格页（价格表：竖线 + 尾数，无目录锚点）。
const PLAIN_TABLE = ['| 品名 | 価格 |', '| りんご | 120 |', '| みかん | 80 |', '| バナナ | 150 |'].join('\n');

const BODY_TEXT = '本文です。\nこれはテストです。';

describe('P2 纯评分函数', () => {
  it('日语形目录页：特征齐、28 分、成候选', () => {
    expect(extractTocPageFeatures(JA_TOC)).toEqual({
      hasTocTitle: true,
      lessonTokenLines: 4,
      dotLeaderLines: 4,
      trailingPageLines: 4,
      tableRowLines: 0,
      exerciseLines: 0,
    });
    expect(scoreTocDiscoveryPage(3, JA_TOC)).toEqual({ page: 3, score: 28, candidate: true });
  });

  it('习题页：负分、无锚点，不成候选', () => {
    const scored = scoreTocDiscoveryPage(7, EXERCISE_PAGE);
    expect(scored.score).toBeLessThan(0);
    expect(scored.candidate).toBe(false);
  });

  it('普通表格页：无锚点不成候选（分再高也不行）', () => {
    const features = extractTocPageFeatures(PLAIN_TABLE);
    expect(features.tableRowLines).toBe(4);
    // 价格尾数把分抬过阈值（6 行×表行 1 + 尾页 1 = 12），无锚点仍不成候选
    const pricey = ['| 品名 価格', '| りんご 120', '| みかん 80', '| バナナ 150', '| ぶどう 200', '| もも 180', '| すいか 300'].join(
      '\n'
    );
    const scored = scoreTocDiscoveryPage(9, pricey);
    expect(scored.score).toBeGreaterThanOrEqual(TOC_DISCOVERY_SCORE.CANDIDATE);
    expect(scored.candidate).toBe(false);
  });

  it('纯正文页 0 分不成候选', () => {
    expect(scoreTocDiscoveryPage(11, BODY_TEXT)).toEqual({ page: 11, score: 0, candidate: false });
  });

  it('阈值与上限常量锁定（探测窗恒 ≤30 且 ≤OCR 上限）', () => {
    expect(TOC_DISCOVERY_MAX_PAGES).toBeLessThanOrEqual(30);
    expect(TOC_DISCOVERY_MAX_PAGES).toBeLessThanOrEqual(MAX_OCR_PAGES_PER_IMPORT);
    expect(TOC_DISCOVERY_SCORE.CANDIDATE).toBe(6);
  });
});

describe('P2 连续页合并', () => {
  it('相邻候选合并、间隔不断开、不替用户选', () => {
    expect(
      mergeTocCandidateRanges([
        { page: 3, score: 28, candidate: true },
        { page: 4, score: 12, candidate: true },
        { page: 5, score: 0, candidate: false },
        { page: 20, score: 30, candidate: true },
      ])
    ).toEqual([
      { fromPage: 3, toPage: 4, score: 28 },
      { fromPage: 20, toPage: 20, score: 30 },
    ]);
    expect(mergeTocCandidateRanges([])).toEqual([]);
  });
});

interface OutlineStub {
  outline?: unknown;
}

function textBook371Stub(
  pageMd: Record<number, string>,
  calls: { classify: Array<readonly number[] | undefined>; ocr: Array<number[] | undefined> },
  outline?: OutlineStub
): PdfInspectorLike {
  return {
    processPdf: (_pdf, pages) => {
      calls.classify.push(pages);
      return { pdfType: 'TextBased', pageCount: 371, markdown: '', pagesNeedingOcr: [] };
    },
    processPdfWithOcr: async (_pdf, options) => {
      const window = Array.isArray(options?.pageNumbers) ? options.pageNumbers : [];
      calls.ocr.push(window);
      return {
        markdown: '',
        pages: window.map((n) => ({ pageNumber: n, markdown: pageMd[n] ?? BODY_TEXT })),
        pagesRoutedToOcr: [],
      };
    },
    ...(outline
      ? {
          extractEmbeddedOutline: () => {
            if (outline.outline instanceof Error) throw outline.outline;
            return outline.outline as import('../application/pdf-import/pdf-runtime.js').EmbeddedOutlineResult;
          },
        }
      : {}),
  };
}

function newCalls() {
  return { classify: [] as Array<readonly number[] | undefined>, ocr: [] as Array<number[] | undefined> };
}

function expectClassifyWindowed(calls: Array<readonly number[] | undefined>) {
  expect(calls.length).toBeGreaterThan(0);
  for (const w of calls) {
    expect(Array.isArray(w)).toBe(true);
    if (!Array.isArray(w)) continue;
    expect(w.length).toBeGreaterThan(0);
    expect(w.length).toBeLessThanOrEqual(30);
  }
}

function mockBytes(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.4 mock-toc-discovery');
}

describe('P2 discoverTocPages 编排（371 页文本 stub）', () => {
  it('371 页只探前 30 页：pagesScanned=[1..30]，分类全开窗', async () => {
    const calls = newCalls();
    const res = await discoverTocPages(
      { loadInspector: async () => textBook371Stub({ 3: JA_TOC }, calls) },
      { userId: 'u1', filename: 'big.pdf', bytes: mockBytes() }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.pageCount).toBe(371);
    expect(res.value.pagesScanned).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expectClassifyWindowed(calls.classify);
    expect(res.value.ocrPages).toEqual([]);
    expect(res.value.embedded).toBe(false);
  });

  it('单页目录 found（只给建议范围）', async () => {
    const calls = newCalls();
    const res = await discoverTocPages(
      { loadInspector: async () => textBook371Stub({ 3: JA_TOC }, calls) },
      { userId: 'u1', filename: 'big.pdf', bytes: mockBytes() }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.status).toBe('found');
    expect(res.value.candidates).toEqual([{ fromPage: 3, toPage: 3, score: 28 }]);
  });

  it('连续两页目录合并为一个 found 范围', async () => {
    const calls = newCalls();
    const res = await discoverTocPages(
      { loadInspector: async () => textBook371Stub({ 3: JA_TOC, 4: JA_TOC_2 }, calls) },
      { userId: 'u1', filename: 'big.pdf', bytes: mockBytes() }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.status).toBe('found');
    expect(res.value.candidates).toEqual([{ fromPage: 3, toPage: 4, score: 28 }]);
  });

  it('两段接近候选 ambiguous（保留多个，不替用户选）', async () => {
    const calls = newCalls();
    const res = await discoverTocPages(
      { loadInspector: async () => textBook371Stub({ 3: JA_TOC, 20: JA_TOC }, calls) },
      { userId: 'u1', filename: 'big.pdf', bytes: mockBytes() }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.status).toBe('ambiguous');
    expect(res.value.candidates).toEqual([
      { fromPage: 3, toPage: 3, score: 28 },
      { fromPage: 20, toPage: 20, score: 28 },
    ]);
  });

  it('全正文 not-found（候选空，调用方手填页码）', async () => {
    const calls = newCalls();
    const res = await discoverTocPages(
      { loadInspector: async () => textBook371Stub({}, calls) },
      { userId: 'u1', filename: 'big.pdf', bytes: mockBytes() }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.status).toBe('not-found');
    expect(res.value.candidates).toEqual([]);
  });

  it('embedded 命中时零 OCR（不跑 discovery，只标记）', async () => {
    const calls = newCalls();
    const res = await discoverTocPages(
      {
        loadInspector: async () =>
          textBook371Stub({ 3: JA_TOC }, calls, {
            outline: {
              items: [
                { title: '第1課', level: 1, physicalPage: 5 },
                { title: '第2課', level: 1, physicalPage: 9 },
              ],
              unresolvedCount: 0,
              truncated: false,
            },
          }),
      },
      { userId: 'u1', filename: 'outlined.pdf', bytes: mockBytes() }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.embedded).toBe(true);
    expect(res.value.status).toBe('not-found');
    expect(res.value.candidates).toEqual([]);
    expect(res.value.pagesScanned).toEqual([]);
    expect(res.value.ocrPages).toEqual([]);
    expect(res.value.outlineQuality).toBe('usable');
    expect(calls.ocr).toEqual([]);
  });

  it('P2.2 纯数字书签 unusable：旧 JSON 路径同样回退 OCR', async () => {
    const calls = newCalls();
    const res = await discoverTocPages(
      {
        loadInspector: async () =>
          textBook371Stub({ 3: JA_TOC }, calls, {
            outline: {
              items: Array.from({ length: 30 }, (_, i) => ({ title: String(i + 1), level: 1, physicalPage: i + 1 })),
              unresolvedCount: 0,
              truncated: false,
            },
          }),
      },
      { userId: 'u1', filename: 'numbered.pdf', bytes: mockBytes() }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.outlineQuality).toBe('unusable');
    expect(res.value.embedded).toBe(false);
    expect(res.value.status).toBe('found');
    expect(res.value.candidates).toEqual([{ fromPage: 3, toPage: 3, score: 28 }]);
    expect(calls.ocr.length).toBe(1);
  });

  it('无 extractEmbeddedOutline 导出的老运行时：正常走 OCR discovery', async () => {
    const calls = newCalls();
    const full = textBook371Stub({ 3: JA_TOC }, calls);
    const legacy: PdfInspectorLike = {
      processPdf: full.processPdf,
      processPdfWithOcr: full.processPdfWithOcr,
    };
    const res = await discoverTocPages(
      { loadInspector: async () => legacy as PdfInspectorLike },
      { userId: 'u1', filename: 'big.pdf', bytes: mockBytes() }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.status).toBe('found');
    expect(res.value.candidates).toEqual([{ fromPage: 3, toPage: 3, score: 28 }]);
    expect(res.value.embedded).toBe(false);
  });
});
