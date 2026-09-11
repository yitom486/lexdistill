import { describe, expect, it, afterEach } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { isOk, logger } from '@study-studio/shared';
import type { PdfInspectorLike } from '../application/pdf-import/pdf-runtime.js';
import {
  FOLIO_CANDIDATE_MAX_PAGES,
  detectFolioCandidates,
  extractFolioCandidates,
  type FolioGeometryItem,
} from '../application/pdf-import/toc-folio-candidates.js';
import { explicitPageNumbers } from '../http/pdf-import-routes.js';
import { createApp } from '../../../transport/http/create-app.js';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { ensurePdfTestRuntime, pinProcessToTestRuntime } from './pdf-test-runtime.js';

/**
 * CMD-LINGUA-P5B folio 候选（纯函数 + 编排 + 真机位）。
 * 自造坐标/memory stub，不读私人教材；真机部分用 pdf-lib 自造单页 + pinned 测试运行时。
 */

function item(text: string, x: number, y: number, height = 12): FolioGeometryItem {
  return { text, x, y, height };
}

function frozen<T>(value: T): T {
  const snapshot = JSON.stringify(value);
  const copy = JSON.parse(snapshot) as T;
  const first = detectFolioCandidates(copy as FolioGeometryItem[], 'native');
  const second = detectFolioCandidates(copy as FolioGeometryItem[], 'native');
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  return copy;
}

describe('P5B detectFolioCandidates（纯函数）', () => {
  it('上限锁死 8 页', () => {
    expect(FOLIO_CANDIDATE_MAX_PAGES).toBe(8);
  });

  it('footer 孤立 Arabic 页码命中（native → medium）', () => {
    const items = frozen([
      item('第一章 はじめに 会話', 50, 600, 14),
      item('本文の内容が続きます 段落', 50, 580, 14),
      item('12', 280, 40),
    ]);
    const found = detectFolioCandidates(items, 'native');
    expect(found).toEqual([
      { raw: '12', normalized: { kind: 'arabic', value: 12 }, location: 'footer', source: 'native', confidence: 'medium' },
    ]);
  });

  it('header Roman 页码命中（只给大写原形，绝不转数字）', () => {
    const found = detectFolioCandidates(
      [item('Body line one here', 50, 400), item('Body line two here', 50, 380), item('iv', 280, 750)],
      'native'
    );
    expect(found.length).toBe(1);
    expect(found[0]?.normalized).toEqual({ kind: 'roman', value: 'IV' });
    expect(found[0]?.location).toBe('header');
    // roman 归一化里没有数字值可误用为 anchor
    expect(typeof (found[0]?.normalized as { value?: unknown }).value).toBe('string');
  });

  it('中央 2026 / 水印数字拒绝（不在边带；边带内年份超限也拒绝）', () => {
    const central = detectFolioCandidates(
      [item('Body line one here', 50, 600), item('Body line two here', 50, 580), item('2026', 280, 400)],
      'native'
    );
    expect(central).toEqual([]);
    const footerYear = detectFolioCandidates(
      [item('Body line one here', 50, 600), item('Body line two here', 50, 580), item('2026', 280, 40)],
      'native'
    );
    expect(footerYear).toEqual([]);
  });

  it('行内数字 / 习题序号 / 表格数字拒绝', () => {
    const body = [item('Body line one here', 50, 600), item('Body line two here', 50, 580)];
    expect(detectFolioCandidates([...body, item('第1課 会話 12', 50, 40)], 'native')).toEqual([]);
    expect(detectFolioCandidates([...body, item('練習3', 50, 40)], 'native')).toEqual([]);
    expect(detectFolioCandidates([...body, item('A | 12 | B', 50, 40)], 'native')).toEqual([]);
    expect(detectFolioCandidates([...body, item('010-1234-5678', 50, 40)], 'native')).toEqual([]);
  });

  it('同页 header/footer 冲突并列保留，绝不仲裁', () => {
    const found = detectFolioCandidates(
      [item('Body line one here', 50, 400), item('Body line two here', 50, 380), item('vii', 280, 750), item('88', 280, 40)],
      'native'
    );
    expect(found.length).toBe(2);
    expect(found.map((c) => c.location).sort()).toEqual(['footer', 'header']);
  });

  it('候选形状恒为五键（无 anchor 字段可误用）', () => {
    const found = detectFolioCandidates(
      [item('Body line one here', 50, 400), item('Body line two here', 50, 380), item('·12', 280, 40)],
      'ocr'
    );
    expect(found.length).toBe(1);
    expect(Object.keys(found[0] ?? {}).sort()).toEqual(['confidence', 'location', 'normalized', 'raw', 'source']);
    expect(found[0]?.confidence).toBe('low');
    expect(found[0]?.raw).toBe('·12');
    expect(found[0]?.normalized).toEqual({ kind: 'arabic', value: 12 });
  });

  it('证据不足（<3 条）直接无候选，不猜边带', () => {
    expect(detectFolioCandidates([item('12', 280, 40)], 'native')).toEqual([]);
  });
});

interface FolioMockCalls {
  load: number;
  classify: number[][];
  native: number[][];
  ocr: number[][];
}

function folioMock(args: {
  pageCount: number;
  calls: FolioMockCalls;
  needing?: number[];
  positions?: Map<number, FolioGeometryItem[]> | 'throw';
  ocrSpans?: Map<number, FolioGeometryItem[]>;
  ocrRouted?: number[];
}): PdfInspectorLike {
  const base: PdfInspectorLike = {
    processPdf: (_pdf, pages) => {
      args.calls.classify.push(pages ?? []);
      return { pdfType: 'Scanned', pageCount: args.pageCount, markdown: '', pagesNeedingOcr: args.needing ?? [] };
    },
    processPdfWithOcr: async (_pdf, options) => {
      const requested = (options as { pageNumbers?: unknown } | undefined)?.pageNumbers;
      const window = Array.isArray(requested) ? requested.filter((n): n is number => typeof n === 'number') : [];
      args.calls.ocr.push(window);
      return {
        markdown: '',
        pages: window.map((pageNumber) => ({
          pageNumber,
          markdown: '',
          spans: [...(args.ocrSpans?.get(pageNumber) ?? [])].map((s) => ({ ...s, width: 20, confidence: 0.9 })),
        })),
        pagesRoutedToOcr: args.ocrRouted ?? window,
      };
    },
  };
  if (args.positions === undefined) return base;
  return {
    ...base,
    extractTextWithPositions: (_pdf, pages) => {
      args.calls.native.push(pages ?? []);
      if (args.positions === 'throw') throw new Error('native boom');
      const out: Array<FolioGeometryItem & { page: number; width: number; fontSize: number; isBold: boolean }> = [];
      for (const page of pages ?? []) {
        for (const s of args.positions?.get(page) ?? []) {
          out.push({ ...s, page, width: 20, fontSize: 12, isBold: false });
        }
      }
      return out as unknown as import('../application/pdf-import/pdf-runtime.js').LayoutTextItemLike[];
    },
  };
}

function mockBytes(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.4 mock-folio-candidates');
}

function bodyLines(): FolioGeometryItem[] {
  return [item('Body line one here', 50, 400), item('Body line two here', 50, 380), item('Body line three now', 50, 360)];
}

describe('P5B extractFolioCandidates 编排（mock）', () => {
  it('空 / 9 页 / 非整数在 runtime 前拒绝（load 零调用）', async () => {
    for (const pageNumbers of [[], [1, 2, 3, 4, 5, 6, 7, 8, 9], [1.5], [0], ['3']]) {
      const calls: FolioMockCalls = { load: 0, classify: [], native: [], ocr: [] };
      const res = await extractFolioCandidates(
        {
          loadInspector: async () => {
            calls.load++;
            return folioMock({ pageCount: 371, calls });
          },
        },
        { userId: 'u1', filename: 't.pdf', bytes: mockBytes(), pageNumbers: pageNumbers as number[] }
      );
      expect(isOk(res)).toBe(false);
      if (isOk(res)) continue;
      expect(res.error.code).toBe('E_INVALID_INPUT');
      expect(calls.load).toBe(0);
    }
  });

  it('越界：仅 [1] 探针，无 native/OCR 调用', async () => {
    const calls: FolioMockCalls = { load: 0, classify: [], native: [], ocr: [] };
    const res = await extractFolioCandidates(
      {
        loadInspector: async () => {
          calls.load++;
          return folioMock({ pageCount: 371, calls, positions: new Map() });
        },
      },
      { userId: 'u1', filename: 't.pdf', bytes: mockBytes(), pageNumbers: [400] }
    );
    expect(isOk(res)).toBe(false);
    if (isOk(res)) return;
    expect(res.error.code).toBe('E_INVALID_INPUT');
    expect(res.error.userMessage).toContain('371');
    expect(calls.classify).toEqual([[1]]);
    expect(calls.native).toEqual([]);
    expect(calls.ocr).toEqual([]);
  });

  it('只处理请求页；native 全命中时零 OCR；无单参 processPdf', async () => {
    const calls: FolioMockCalls = { load: 0, classify: [], native: [], ocr: [] };
    const positions = new Map([
      [3, [...bodyLines(), item('77', 280, 40)]],
      [5, [...bodyLines(), item('ix', 280, 700)]],
    ]);
    const res = await extractFolioCandidates(
      {
        loadInspector: async () => {
          calls.load++;
          return folioMock({ pageCount: 371, calls, positions, needing: [3, 5] });
        },
      },
      { userId: 'u1', filename: 't.pdf', bytes: mockBytes(), pageNumbers: [5, 3, 3] }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.pageCount).toBe(371);
    expect(res.value.pages.map((p) => p.physicalPage)).toEqual([3, 5]);
    expect(res.value.pages[0]?.candidates[0]).toMatchObject({
      normalized: { kind: 'arabic', value: 77 },
      location: 'footer',
      source: 'native',
    });
    expect(res.value.pages[1]?.candidates[0]).toMatchObject({
      normalized: { kind: 'roman', value: 'IX' },
      location: 'header',
      source: 'native',
    });
    expect(res.value.diagnostics).toMatchObject({ pagesRequested: 2, nativePages: 2, ocrPages: 0, candidatesFound: 2 });
    // native 精确等于去重后请求窗；零 OCR；所有 processPdf 恒带非空窗
    expect(calls.native).toEqual([[3, 5]]);
    expect(calls.ocr).toEqual([]);
    for (const window of calls.classify) expect(window.length).toBeGreaterThan(0);
  });

  it('native 缺页才对相同选择页 OCR（不扩大窗）', async () => {
    const calls: FolioMockCalls = { load: 0, classify: [], native: [], ocr: [] };
    const positions = new Map([[3, [...bodyLines(), item('77', 280, 40)]]]);
    const ocrSpans = new Map([[5, [...bodyLines(), item('ix', 280, 700)]]]);
    const res = await extractFolioCandidates(
      {
        loadInspector: async () => {
          calls.load++;
          return folioMock({ pageCount: 371, calls, positions, needing: [5], ocrSpans, ocrRouted: [5] });
        },
      },
      { userId: 'u1', filename: 't.pdf', bytes: mockBytes(), pageNumbers: [3, 5] }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(calls.native).toEqual([[3, 5]]);
    expect(calls.ocr).toEqual([[5]]);
    expect(res.value.pages[1]?.candidates[0]).toMatchObject({ source: 'ocr', location: 'header' });
    expect(res.value.diagnostics).toMatchObject({ nativePages: 1, ocrPages: 1 });
  });

  it('native 缺席（老运行时）整体走 OCR 同页', async () => {
    const calls: FolioMockCalls = { load: 0, classify: [], native: [], ocr: [] };
    const ocrSpans = new Map([[2, [...bodyLines(), item('45', 280, 40)]]]);
    const res = await extractFolioCandidates(
      {
        loadInspector: async () => {
          calls.load++;
          return folioMock({ pageCount: 371, calls, needing: [2], ocrSpans, ocrRouted: [2] });
        },
      },
      { userId: 'u1', filename: 't.pdf', bytes: mockBytes(), pageNumbers: [2] }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.pages[0]?.candidates[0]).toMatchObject({
      normalized: { kind: 'arabic', value: 45 },
      source: 'ocr',
      confidence: 'low',
    });
    expect(res.value.diagnostics).toMatchObject({ nativePages: 0, ocrPages: 1 });
  });

  it('日志只记计数：不含 folio 文本、文件名、userId', async () => {
    const captured: unknown[][] = [];
    const originalWarn = logger.warn;
    logger.warn = (...args: unknown[]): void => {
      captured.push(args);
    };
    try {
      const positions = new Map([[3, [...bodyLines(), item('432', 280, 40)]]]);
      const res = await extractFolioCandidates(
        {
          loadInspector: async () =>
            folioMock({ pageCount: 371, calls: { load: 0, classify: [], native: [], ocr: [] }, positions }),
        },
        { userId: 'u-log-probe-9', filename: 'secret-folio-file.pdf', bytes: mockBytes(), pageNumbers: [3] }
      );
      expect(isOk(res)).toBe(true);
    } finally {
      logger.warn = originalWarn;
    }
    const dumped = JSON.stringify(captured);
    expect(dumped).not.toContain('432');
    expect(dumped).not.toContain('u-log-probe-9');
    expect(dumped).not.toContain('secret-folio-file.pdf');
  });
});

describe('explicitPageNumbers（路由页号集解析）', () => {
  it('数组去重排序；非法整体 invalid；缺席 undefined', () => {
    expect(explicitPageNumbers({ pages: [5, 3, 3] })).toEqual([3, 5]);
    expect(explicitPageNumbers({})).toBeUndefined();
    expect(explicitPageNumbers({ pages: [1, 'x'] })).toBe('invalid');
    expect(explicitPageNumbers({ pages: [0] })).toBe('invalid');
    expect(explicitPageNumbers({ pages: 'nope' })).toBe('invalid');
  });

  it('字符串：JSON 数组或逗号分隔', () => {
    expect(explicitPageNumbers({ pages: '[3,5]' })).toEqual([3, 5]);
    expect(explicitPageNumbers({ pages: '3,5,7' })).toEqual([3, 5, 7]);
  });
});

const repos: DrizzleLearnerRepository[] = [];
const tempFiles: string[] = [];
afterEach(async () => {
  for (const r of repos.splice(0)) r.getRawDb().close();
  for (const f of tempFiles.splice(0)) {
    try {
      await unlink(f);
    } catch {
      /* 已删或从未落盘 */
    }
  }
});

async function syntheticFolioPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawText('Body line one here', { x: 50, y: 400, size: 12 });
  page.drawText('Body line two here', { x: 50, y: 380, size: 12 });
  page.drawText('Body line three now', { x: 50, y: 360, size: 12 });
  page.drawText('77', { x: 280, y: 40, size: 12 });
  return new Uint8Array(await doc.save());
}

describe('P5B 真机位（pinned 测试运行时 + pdf-lib 自造单页）', () => {
  it('native y 轴向上：页顶标记 y 大于页底标记', async () => {
    pinProcessToTestRuntime();
    const { inspector } = await ensurePdfTestRuntime();
    expect(typeof inspector.extractTextWithPositions).toBe('function');
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    page.drawText('TOPMARK', { x: 50, y: 750, size: 24 });
    page.drawText('BOTMARK', { x: 50, y: 50, size: 24 });
    const bytes = new Uint8Array(await doc.save());
    const raw = inspector.extractTextWithPositions?.(bytes, [1]) ?? [];
    const top = raw.find((it) => it.text.includes('TOPMARK'));
    const bottom = raw.find((it) => it.text.includes('BOTMARK'));
    expect(top && bottom).toBeTruthy();
    // y-up：页顶 y > 页底 y（header/footer 边带据此划分）
    expect((top?.y ?? 0)).toBeGreaterThan(bottom?.y ?? 0);
  }, 300000);

  it('POST folio-candidates：真 native 命中 footer 77，不写库', async () => {
    pinProcessToTestRuntime();
    await ensurePdfTestRuntime();
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const app = createApp({ repo, server: {} as never, port: 0 });
    const tmp = join(tmpdir(), `p5b-folio-${process.pid}-${Date.now()}.pdf`);
    await Bun.write(tmp, await syntheticFolioPdf());
    tempFiles.push(tmp);
    const before = await repo.listDocuments('u1');
    const res = await app.request('/api/documents/u1/folio-candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: tmp, pages: [1] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      pageCount: number;
      pages: Array<{ physicalPage: number; candidates: Array<{ raw: string; normalized: unknown; location: string; source: string }> }>;
      diagnostics: { pagesRequested: number; nativePages: number; candidatesFound: number };
    };
    expect(body.pageCount).toBe(1);
    expect(body.pages.length).toBe(1);
    const folio = body.pages[0]?.candidates.find((c) => c.raw === '77');
    expect(folio).toMatchObject({ location: 'footer', source: 'native', normalized: { kind: 'arabic', value: 77 } });
    expect(body.diagnostics.pagesRequested).toBe(1);
    const after = await repo.listDocuments('u1');
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));

    const missing = await app.request('/api/documents/u1/folio-candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: tmp }),
    });
    expect(missing.status).not.toBe(200);
  }, 300000);
});
