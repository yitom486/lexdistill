import { describe, expect, it } from 'bun:test';
import { isOk } from '@study-studio/shared';
import {
  convertPdfToAst,
  mapPdfPages,
} from '../application/pdf-import/pdf-import-service.js';
import type { PdfInspectorLike } from '../application/pdf-import/pdf-runtime.js';

/**
 * CMD-P0.1 已选页开窗锁（mock，不碰原生，禁止私人书）。
 *
 * 371 页扫描 stub（echo 口径：needing 即所给窗口——并集再与选页求交即精确值，
 * 与原生窗内外两种口径都兼容）：任何路径下每一次 processPdf 第二参都必须是非空
 * number[]（长度 ≤30），不得出现 undefined；pageCount 仍诚实为全书 371。
 */
function scanned371Stub(
  classifyCalls: Array<readonly number[] | undefined>,
  ocrCalls: Array<number[] | undefined>
): PdfInspectorLike {
  return {
    processPdf: (_pdf, pages) => {
      classifyCalls.push(pages);
      const w = Array.isArray(pages) ? [...pages] : [];
      return { pdfType: 'Scanned', pageCount: 371, markdown: '', pagesNeedingOcr: w };
    },
    processPdfWithOcr: async (_pdf, options) => {
      ocrCalls.push(options?.pageNumbers);
      return { markdown: '# 第1課\nアキ：はじめまして。\n' };
    },
  };
}

function expectAllWindowed(calls: Array<readonly number[] | undefined>) {
  expect(calls.length).toBeGreaterThan(0);
  for (const w of calls) {
    expect(Array.isArray(w)).toBe(true);
    if (!Array.isArray(w)) continue;
    expect(w.length).toBeGreaterThan(0);
    expect(w.length).toBeLessThanOrEqual(30);
  }
}

function mockBytes(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.4 mock-371');
}

describe('P0.1 convert 已选页开窗（371 页扫描 stub）', () => {
  it('pages:[1,2,3] 成功，页数诚实 371，全部分块 ≤30', async () => {
    const classifyCalls: Array<readonly number[] | undefined> = [];
    const ocrCalls: Array<number[] | undefined> = [];
    const res = await convertPdfToAst(
      { loadInspector: async () => scanned371Stub(classifyCalls, ocrCalls) },
      { userId: 'u1', filename: 'scan371.pdf', bytes: mockBytes(), pages: [1, 2, 3] }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.classification.pageCount).toBe(371);
    expect(res.value.classification.selectedPages).toEqual([1, 2, 3]);
    expect(res.value.book.lessons.map((l) => l.title)).toEqual(['第1課']);
    expectAllWindowed(classifyCalls);
    expect(ocrCalls).toEqual([[1, 2, 3]]);
  });

  it('pages:1..30 成功且只 OCR 该窗', async () => {
    const classifyCalls: Array<readonly number[] | undefined> = [];
    const ocrCalls: Array<number[] | undefined> = [];
    const expected = Array.from({ length: 30 }, (_, i) => i + 1);
    const res = await convertPdfToAst(
      { loadInspector: async () => scanned371Stub(classifyCalls, ocrCalls) },
      { userId: 'u1', filename: 'scan371.pdf', bytes: mockBytes(), pages: expected }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.classification.pageCount).toBe(371);
    expect(res.value.classification.selectedPages).toEqual(expected);
    expectAllWindowed(classifyCalls);
    expect(ocrCalls).toEqual([expected]);
  });

  it('pages:1..31 仍拒绝（31 页 OCR 上限保持），且分类全分块', async () => {
    const classifyCalls: Array<readonly number[] | undefined> = [];
    const ocrCalls: Array<number[] | undefined> = [];
    const res = await convertPdfToAst(
      { loadInspector: async () => scanned371Stub(classifyCalls, ocrCalls) },
      {
        userId: 'u1',
        filename: 'scan371.pdf',
        bytes: mockBytes(),
        pages: Array.from({ length: 31 }, (_, i) => i + 1),
      }
    );
    expect(isOk(res)).toBe(false);
    if (isOk(res)) return;
    expect(res.error.code).toBe('E_INVALID_INPUT');
    expectAllWindowed(classifyCalls);
    expect(ocrCalls).toEqual([]);
  });

  it('pages:[400] 选页越界（本书共 371 页），不碰 OCR', async () => {
    const classifyCalls: Array<readonly number[] | undefined> = [];
    const ocrCalls: Array<number[] | undefined> = [];
    const res = await convertPdfToAst(
      { loadInspector: async () => scanned371Stub(classifyCalls, ocrCalls) },
      { userId: 'u1', filename: 'scan371.pdf', bytes: mockBytes(), pages: [400] }
    );
    expect(isOk(res)).toBe(false);
    if (isOk(res)) return;
    expect(res.error.code).toBe('E_INVALID_INPUT');
    expect(res.error.userMessage).toContain('本书共 371 页');
    expectAllWindowed(classifyCalls);
    expect(ocrCalls).toEqual([]);
  });
});

describe('P0.1 map 已选页开窗（371 页扫描 stub）', () => {
  it('pages:[300,301,302] 只扫该窗，页数诚实 371', async () => {
    const classifyCalls: Array<readonly number[] | undefined> = [];
    const ocrCalls: Array<number[] | undefined> = [];
    const res = await mapPdfPages(
      { loadInspector: async () => scanned371Stub(classifyCalls, ocrCalls) },
      { userId: 'u1', filename: 'scan371.pdf', bytes: mockBytes(), pages: [300, 301, 302] }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.classification.pageCount).toBe(371);
    expect(res.value.window).toEqual([300, 301, 302]);
    expectAllWindowed(classifyCalls);
    expect(ocrCalls).toEqual([[300, 301, 302]]);
  });

  it('P0.1a map pages:[400] 全越界直接拒绝：仅 probe [1] 调用，零 OCR', async () => {
    const classifyCalls: Array<readonly number[] | undefined> = [];
    const ocrCalls: Array<number[] | undefined> = [];
    const res = await mapPdfPages(
      { loadInspector: async () => scanned371Stub(classifyCalls, ocrCalls) },
      { userId: 'u1', filename: 'scan371.pdf', bytes: mockBytes(), pages: [400] }
    );
    expect(isOk(res)).toBe(false);
    if (isOk(res)) return;
    expect(res.error.code).toBe('E_INVALID_INPUT');
    expect(res.error.userMessage).toContain('本书共 371 页');
    expect(classifyCalls).toEqual([[1]]);
    expect(ocrCalls).toEqual([]);
  });

  it('P0.1a map pages:[31..60] 窗与 OCR 精确等于该窗，不得偷换为 [1..30]', async () => {
    const classifyCalls: Array<readonly number[] | undefined> = [];
    const ocrCalls: Array<number[] | undefined> = [];
    const expected = Array.from({ length: 30 }, (_, i) => i + 31);
    const res = await mapPdfPages(
      { loadInspector: async () => scanned371Stub(classifyCalls, ocrCalls) },
      { userId: 'u1', filename: 'scan371.pdf', bytes: mockBytes(), pages: expected }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.classification.pageCount).toBe(371);
    expect(res.value.window).toEqual(expected);
    expectAllWindowed(classifyCalls);
    expect(ocrCalls).toEqual([expected]);
  });

  it('P0.1a convert pages:[31..60] 成功，OCR 精确等于该窗，全部分块 1–30', async () => {
    const classifyCalls: Array<readonly number[] | undefined> = [];
    const ocrCalls: Array<number[] | undefined> = [];
    const expected = Array.from({ length: 30 }, (_, i) => i + 31);
    const res = await convertPdfToAst(
      { loadInspector: async () => scanned371Stub(classifyCalls, ocrCalls) },
      { userId: 'u1', filename: 'scan371.pdf', bytes: mockBytes(), pages: expected }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.classification.pageCount).toBe(371);
    expect(res.value.classification.selectedPages).toEqual(expected);
    expectAllWindowed(classifyCalls);
    expect(ocrCalls).toEqual([expected]);
  });
});
