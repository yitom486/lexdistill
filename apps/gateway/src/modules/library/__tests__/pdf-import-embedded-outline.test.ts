import { describe, expect, it } from 'bun:test';
import { isOk } from '@study-studio/shared';
import { mapPdfPages } from '../application/pdf-import/pdf-import-service.js';
import type { PdfInspectorLike } from '../application/pdf-import/pdf-runtime.js';

/**
 * CMD-LINGUA-P1A map 内置目录优先（mock，不碰原生；标题均为虚构通用词）。
 *
 * mock inspector 自带 extractEmbeddedOutline（echo 口径扫描书，35 页）；
 * 记录 classify 窗与 OCR 调用，锁“命中则零 OCR、tocEntries 不混入”。
 */
function outlineMock(outline: unknown, calls: { classify: Array<readonly number[] | undefined>; ocr: Array<number[] | undefined> }): PdfInspectorLike {
  return {
    processPdf: (_pdf, pages) => {
      calls.classify.push(pages);
      const w = Array.isArray(pages) ? [...pages] : [];
      return { pdfType: 'Scanned', pageCount: 35, markdown: '', pagesNeedingOcr: w };
    },
    processPdfWithOcr: async (_pdf, options) => {
      calls.ocr.push(options?.pageNumbers);
      return { markdown: '# 第1課\nアキ：はじめまして。\n' };
    },
    // 故意喂畸形 native 负载时才需要断言（有注释）；正常用例均为合法形状。
    extractEmbeddedOutline: () => {
      if (outline instanceof Error) throw outline;
      return outline as import('../application/pdf-import/pdf-runtime.js').EmbeddedOutlineResult;
    },
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
  return new TextEncoder().encode('%PDF-1.4 mock-outline');
}

const USABLE = {
  items: [
    { title: 'Alpha', level: 1, physicalPage: 2 },
    { title: 'Beta', level: 2, physicalPage: 40 },
    { title: 'Gamma' },
    { title: '  ', level: 1, physicalPage: 3 },
    { title: 'Delta', level: 0, physicalPage: 3 },
  ],
  unresolvedCount: 2,
  truncated: false,
};

describe('P1A map embedded outline 优先', () => {
  it('可用目录：顺序/层级/物理页进入结果，零 OCR，tocEntries 不混入', async () => {
    const calls = newCalls();
    const res = await mapPdfPages(
      { loadInspector: async () => outlineMock(USABLE, calls) },
      { userId: 'u1', filename: 'outlined.pdf', bytes: mockBytes() }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.outlineSource).toBe('embedded');
    // Beta 越界（40 > 35）、Gamma 缺页、空白标题、level 0 全部丢弃，只留 Alpha。
    expect(res.value.embeddedOutline).toEqual([{ title: 'Alpha', level: 1, physicalPage: 2 }]);
    expect(calls.ocr).toEqual([]);
    expect(res.value.window).toEqual([]);
    expect(res.value.headings).toEqual([]);
    expect(res.value.tocEntries).toEqual([]);
    expect(res.value.classification.pageCount).toBe(35);
    expect(res.value.classification.ocrUsed).toBe(false);
    expectClassifyWindowed(calls.classify);
  });

  it('空目录：走既有 none 路径（正常 OCR 窗）', async () => {
    const calls = newCalls();
    const res = await mapPdfPages(
      { loadInspector: async () => outlineMock({ items: [], unresolvedCount: 0, truncated: false }, calls) },
      { userId: 'u1', filename: 'plain.pdf', bytes: mockBytes() }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.outlineSource).toBe('none');
    expect(res.value.embeddedOutline).toEqual([]);
    expect(calls.ocr.length).toBeGreaterThan(0);
    expect(res.value.window.length).toBeGreaterThan(0);
  });

  it('truncated=true：不得当作完整目录（回 none 路径）', async () => {
    const calls = newCalls();
    const res = await mapPdfPages(
      {
        loadInspector: async () =>
          outlineMock(
            { items: [{ title: 'Alpha', level: 1, physicalPage: 2 }], unresolvedCount: 0, truncated: true },
            calls
          ),
      },
      { userId: 'u1', filename: 'truncated.pdf', bytes: mockBytes() }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.outlineSource).toBe('none');
    expect(res.value.embeddedOutline).toEqual([]);
    expect(calls.ocr.length).toBeGreaterThan(0);
  });

  it('native 抛错：安全降级走 none 路径', async () => {
    const calls = newCalls();
    const res = await mapPdfPages(
      { loadInspector: async () => outlineMock(new Error('extract_embedded_outline: boom'), calls) },
      { userId: 'u1', filename: 'bad.pdf', bytes: mockBytes() }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.outlineSource).toBe('none');
    expect(calls.ocr.length).toBeGreaterThan(0);
  });

  it('畸形返回（items 非数组）：不抛，走 none 路径', async () => {
    const calls = newCalls();
    const res = await mapPdfPages(
      {
        loadInspector: async () =>
          outlineMock({ items: 'nope', unresolvedCount: 0, truncated: false }, calls),
      },
      { userId: 'u1', filename: 'malformed.pdf', bytes: mockBytes() }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.outlineSource).toBe('none');
    expect(res.value.embeddedOutline).toEqual([]);
  });
});
