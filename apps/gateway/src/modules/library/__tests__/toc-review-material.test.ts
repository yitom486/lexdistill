import { describe, expect, it } from 'bun:test';
import { isOk } from '@study-studio/shared';
import type { PdfInspectorLike } from '../application/pdf-import/pdf-runtime.js';
import {
  TOC_REVIEW_MAX_PAGES,
  prepareTocReviewMaterial,
} from '../application/pdf-import/toc-review-material.js';
import { ensurePdfTestRuntime, pinProcessToTestRuntime } from './pdf-test-runtime.js';

/**
 * CMD-LINGUA-P4A-2 review material 单测。
 *
 * mock 部分全内存（自撰 synthetic，不读私人路径）；
 * 真机部分用 pinned 测试运行时 + 内存 synthetic PDF 走真实 native binding。
 */

interface RenderCalls {
  classify: Array<readonly number[] | undefined>;
  render: Array<readonly number[] | undefined>;
}

function materialMock(args: {
  pageCount: number;
  outline?: { value: unknown };
  calls: RenderCalls;
}): PdfInspectorLike {
  const base: PdfInspectorLike = {
    processPdf: (_pdf, pages) => {
      args.calls.classify.push(pages);
      return { pdfType: 'TextBased', pageCount: args.pageCount, markdown: '', pagesNeedingOcr: [] };
    },
    processPdfWithOcr: async () => ({ markdown: '', pages: [] }),
  };
  const withRender: PdfInspectorLike = {
    ...base,
    renderPdfPages: async (_pdf, pages) => {
      args.calls.render.push(pages);
      return pages.map((n) => ({
        pageNumber: n,
        png: new Uint8Array([137, 80, 78, 71, n]),
        width: 100 + n,
        height: 200 + n,
      }));
    },
  };
  if (!args.outline) return withRender;
  return {
    ...withRender,
    extractEmbeddedOutline: () => {
      if (args.outline?.value instanceof Error) throw args.outline.value;
      // 故意喂畸形 native 负载时才需要断言（有注释）；正常用例均为合法形状。
      return args.outline?.value as import('../application/pdf-import/pdf-runtime.js').EmbeddedOutlineResult;
    },
  };
}

function newCalls(): RenderCalls {
  return { classify: [], render: [] };
}

function mockBytes(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.4 mock-review-material');
}

describe('P4A-2 prepareTocReviewMaterial（mock）', () => {
  it('上限锁死 8 页（与 fork 原生上限镜像）', () => {
    expect(TOC_REVIEW_MAX_PAGES).toBe(8);
  });

  it('确认范围渲染：内存返回页码/PNG/尺寸，不写任何地方', async () => {
    const calls = newCalls();
    const res = await prepareTocReviewMaterial(
      { loadInspector: async () => materialMock({ pageCount: 371, calls }) },
      { userId: 'u1', filename: 'big.pdf', bytes: mockBytes(), fromPage: 31, toPage: 33 }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.range).toEqual({ fromPage: 31, toPage: 33 });
    expect(res.value.pageCount).toBe(371);
    expect(res.value.embedded).toBe(false);
    expect(res.value.pages.map((p) => p.pageNumber)).toEqual([31, 32, 33]);
    for (const page of res.value.pages) {
      expect(page.png[0]).toBe(137);
      expect(page.width).toBeGreaterThan(0);
      expect(page.height).toBeGreaterThan(0);
    }
    // 渲染精确等于确认范围（去重后 [31,32,33]），分类全开窗
    expect(calls.render).toEqual([[31, 32, 33]]);
    for (const w of calls.classify) {
      expect(Array.isArray(w)).toBe(true);
      if (!Array.isArray(w)) continue;
      expect(w.length).toBeGreaterThan(0);
      expect(w.length).toBeLessThanOrEqual(30);
    }
  });

  it('范围错误在 native render 前失败：超 8/越界/空范围', async () => {
    const overCalls = newCalls();
    const over = await prepareTocReviewMaterial(
      { loadInspector: async () => materialMock({ pageCount: 371, calls: overCalls }) },
      { userId: 'u1', filename: 'big.pdf', bytes: mockBytes(), fromPage: 1, toPage: 9 }
    );
    expect(isOk(over)).toBe(false);
    if (isOk(over)) return;
    expect(over.error.code).toBe('E_INVALID_INPUT');
    expect(overCalls.render).toEqual([]);

    const oobCalls = newCalls();
    const oob = await prepareTocReviewMaterial(
      { loadInspector: async () => materialMock({ pageCount: 371, calls: oobCalls }) },
      { userId: 'u1', filename: 'big.pdf', bytes: mockBytes(), fromPage: 400, toPage: 405 }
    );
    expect(isOk(oob)).toBe(false);
    if (isOk(oob)) return;
    expect(oob.error.code).toBe('E_INVALID_INPUT');
    expect(oob.error.userMessage).toContain('371');
    expect(oobCalls.render).toEqual([]);

    const emptyCalls = newCalls();
    const empty = await prepareTocReviewMaterial(
      { loadInspector: async () => materialMock({ pageCount: 371, calls: emptyCalls }) },
      { userId: 'u1', filename: 'big.pdf', bytes: mockBytes(), fromPage: 5, toPage: 3 }
    );
    expect(isOk(empty)).toBe(false);
    if (isOk(empty)) return;
    expect(empty.error.code).toBe('E_INVALID_INPUT');
    expect(emptyCalls.render).toEqual([]);
    expect(emptyCalls.classify).toEqual([]);
  });

  it('embedded 命中时零渲染（不伪造图片）', async () => {
    const calls = newCalls();
    const res = await prepareTocReviewMaterial(
      {
        loadInspector: async () =>
          materialMock({
            pageCount: 371,
            calls,
            outline: {
              value: { items: [{ title: 'Alpha', level: 1, physicalPage: 5 }], unresolvedCount: 0, truncated: false },
            },
          }),
      },
      { userId: 'u1', filename: 'outlined.pdf', bytes: mockBytes(), fromPage: 2, toPage: 3 }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.embedded).toBe(true);
    expect(res.value.pages).toEqual([]);
    expect(calls.render).toEqual([]);
  });

  it('老运行时缺 renderPdfPages：明确报错而非崩溃', async () => {
    const calls = newCalls();
    const full = materialMock({ pageCount: 10, calls });
    const legacy: PdfInspectorLike = {
      processPdf: full.processPdf,
      processPdfWithOcr: full.processPdfWithOcr,
    };
    const res = await prepareTocReviewMaterial(
      { loadInspector: async () => legacy },
      { userId: 'u1', filename: 't.pdf', bytes: mockBytes(), fromPage: 1, toPage: 2 }
    );
    expect(isOk(res)).toBe(false);
    if (isOk(res)) return;
    expect(res.error.code).toBe('E_RUNTIME_LOAD');
    expect(calls.render).toEqual([]);
  });
});

function buildPdf(objects: string[]): Uint8Array {
  const parts = ['%PDF-1.4\n'];
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(parts.join('')));
    parts.push(`${i + 1} 0 obj\n${objects[i]}\nendobj\n`);
  }
  const xrefAt = Buffer.byteLength(parts.join(''));
  const n = objects.length + 1;
  parts.push(`xref\n0 ${n}\n`);
  parts.push('0000000000 65535 f \n');
  for (let i = 1; i < n; i++) {
    parts.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  parts.push(`trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`);
  return new Uint8Array(Buffer.from(parts.join(''), 'latin1'));
}

/** 内存 synthetic：2 空白页，无私人内容。 */
function syntheticBlankPdf(): Uint8Array {
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
  ]);
}

describe('P4A-2 真实 native binding 生成 PNG（pinned 测试运行时）', () => {
  it('synthetic 空白页渲染：PNG 签名、页码、尺寸自洽', async () => {
    pinProcessToTestRuntime();
    const { inspector } = await ensurePdfTestRuntime();
    expect(typeof inspector.renderPdfPages).toBe('function');
    const res = await prepareTocReviewMaterial(
      {},
      { userId: 'u1', filename: 'synthetic.pdf', bytes: syntheticBlankPdf(), fromPage: 1, toPage: 2 }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.embedded).toBe(false);
    expect(res.value.pages.map((p) => p.pageNumber)).toEqual([1, 2]);
    for (const page of res.value.pages) {
      expect([page.png[0], page.png[1], page.png[2], page.png[3]]).toEqual([137, 80, 78, 71]);
      // IHDR 宽高与报告值一致
      const width = Buffer.from(page.png.subarray(16, 20)).readUInt32BE(0);
      const height = Buffer.from(page.png.subarray(20, 24)).readUInt32BE(0);
      expect(width).toBe(page.width);
      expect(height).toBe(page.height);
      expect(page.width).toBeGreaterThan(0);
      expect(page.height).toBeGreaterThan(0);
    }
  }, 300000);
});
