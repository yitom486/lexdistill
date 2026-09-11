import { describe, expect, it, afterEach } from 'bun:test';
import type { Hono } from 'hono';
import type { PdfInspectorLike } from '../../../../gateway/src/modules/library/application/pdf-import/pdf-runtime.js';
import { createPdfImportRoutes } from '../../../../gateway/src/modules/library/http/pdf-import-routes.js';
import { DEFAULT_GATEWAY_BASE_URL, configureGatewayBaseUrl } from '../../lib/api-client.js';
import { streamDiscoverToc } from '../textbooks-annotations.js';
import type { TocDiscoveryData } from '../../lib/toc-confirm-flow.js';

/**
 * CMD-LINGUA-P2.4 生产形态集成回归（真实验收固化，无 Playwright/新依赖）。
 *
 * - 真实临时 Bun/Hono HTTP server（`Bun.serve` + 真实 `fetch`，不 mock fetch）；
 * - Web 侧实际调用生产 `streamDiscoverToc`，实际读取 NDJSON body；
 * - 数字内嵌书签 → `outlineQuality: "unusable"` → 回退 OCR → 候选 + 琥珀提示数据；
 * - 同时锁定诊断已拆除：线上无 `x-toc-run` 头、`GET /api/debug/toc-arrivals` 404。
 *
 * 输入全合成：内存 stub inspector + 590 字节手写单页 PDF（内容与网关单测同源，
 * 自撰通用形，不含任何教材原文，不接触用户文件）。
 */

const JA_TOC = [
  '目次',
  '第1課 はじめまして ………………… 2',
  '第2課 これは本です ………………… 5',
  '第3課 さんぽ ………………… 8',
  '復習A ………………… 12',
].join('\n');

const BODY_TEXT = '本文です。\nこれはテストです。';

interface StubCalls {
  loadInspector: number;
  ocrWindows: Array<number[] | undefined>;
}

function stubInspector(calls: StubCalls): PdfInspectorLike {
  return {
    processPdf: () => ({ pdfType: 'TextBased', pageCount: 371, markdown: '', pagesNeedingOcr: [] }),
    processPdfWithOcr: async (_pdf, opts) => {
      const window = Array.isArray(opts?.pageNumbers) ? opts.pageNumbers : [];
      calls.ocrWindows.push(window);
      return {
        markdown: '',
        pages: window.map((n) => ({ pageNumber: n, markdown: n === 3 ? JA_TOC : BODY_TEXT })),
        pagesRoutedToOcr: [],
      };
    },
    extractEmbeddedOutline: () => ({
      items: Array.from({ length: 30 }, (_, i) => ({ title: String(i + 1), level: 1, physicalPage: i + 1 })),
      unresolvedCount: 0,
      truncated: false,
    }),
  };
}

function miniPdfBytes(): Uint8Array<ArrayBuffer> {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length 45 >>\nstream\nBT /F1 24 Tf 100 700 Td (Hello TOC world) Tj ET\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objs.length; i++) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefPos = pdf.length;
  pdf += 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  const encoded = new TextEncoder().encode(pdf);
  const out = new Uint8Array(encoded.length);
  out.set(encoded);
  return out;
}

const servers: Array<{ stop: () => void }> = [];
afterEach(() => {
  for (const s of servers.splice(0)) {
    try {
      s.stop();
    } catch {
      // 已停
    }
  }
  configureGatewayBaseUrl(DEFAULT_GATEWAY_BASE_URL);
});

function serve(calls: StubCalls, seenRunHeaders: Array<string | null>): { app: Hono; url: string } {
  const app = createPdfImportRoutes(
    { repo: {} as never, server: {} as never, port: 0 },
    {
      loadInspector: async () => {
        calls.loadInspector++;
        return stubInspector(calls);
      },
    }
  );
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      seenRunHeaders.push(req.headers.get('x-toc-run'));
      return app.fetch(req);
    },
  });
  servers.push(server);
  return { app, url: `http://localhost:${server.port}` };
}

describe('P2.4 真实 NDJSON 路径集成（numeric outline → unusable → OCR → 候选）', () => {
  it('Content-Type + 首事件 + 完整事件顺序（原始 fetch，不 mock）', async () => {
    const calls: StubCalls = { loadInspector: 0, ocrWindows: [] };
    const seenRunHeaders: Array<string | null> = [];
    const { url } = serve(calls, seenRunHeaders);
    const form = new FormData();
    form.append('file', new File([miniPdfBytes()], 'mini.pdf', { type: 'application/pdf' }));
    const res = await fetch(`${url}/api/documents/u1/discover-toc-stream`, { method: 'POST', body: form });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    const text = await res.text();
    const types = text
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => (JSON.parse(l) as { type: string }).type);
    expect(types.slice(0, 5)).toEqual([
      'started',
      'page_count_ready',
      'embedded_outline_checked',
      'runtime_check',
      'runtime_ready',
    ]);
    expect(types.filter((t) => t === 'ocr_batch_completed').length).toBe(6);
    expect(types.slice(-2)).toEqual(['scoring', 'completed']);
    const completed = JSON.parse(
      text.split('\n').filter((l) => l.trim()).pop() as string
    ) as { result: TocDiscoveryData };
    expect(completed.result.outlineQuality).toBe('unusable');
    expect(completed.result.embedded).toBe(false);
    expect(completed.result.status).toBe('found');
    expect(completed.result.candidates).toEqual([{ fromPage: 3, toPage: 3, score: 28 }]);
  });

  it('生产 streamDiscoverToc 端到端：事件回调 + 最终 state 驱动琥珀提示', async () => {
    const calls: StubCalls = { loadInspector: 0, ocrWindows: [] };
    const seenRunHeaders: Array<string | null> = [];
    const { url } = serve(calls, seenRunHeaders);
    configureGatewayBaseUrl(url);
    try {
      const seen: string[] = [];
      const out = await streamDiscoverToc(
        'u1',
        { file: new File([miniPdfBytes()], 'mini.pdf', { type: 'application/pdf' }) },
        { onEvent: (e) => seen.push(e.type) }
      );
      expect(out.cancelled).toBe(false);
      expect(out.data?.status).toBe('found');
      expect(out.data?.outlineQuality).toBe('unusable');
      expect(out.data?.embedded).toBe(false);
      // 面板琥珀提示的同一判定条件：unusable + 有候选（UI 文案由面板单测锁定）
      const showsUnusableBanner = out.data !== null && !out.data.embedded && out.data.outlineQuality === 'unusable';
      const showsCandidates = (out.data?.candidates.length ?? 0) > 0;
      expect(showsUnusableBanner).toBe(true);
      expect(showsCandidates).toBe(true);
      expect(seen.filter((t) => t === 'ocr_batch_completed').length).toBe(6);
      expect(seen[seen.length - 1]).toBe('completed');
      // OCR 确实执行（6 个真实 5 页窗），不是被书签截断
      expect(calls.ocrWindows.length).toBe(6);
      expect(calls.ocrWindows[0]).toEqual([1, 2, 3, 4, 5]);
    } finally {
      configureGatewayBaseUrl(DEFAULT_GATEWAY_BASE_URL);
    }
  });

  it('诊断已拆除：线上无 x-toc-run 头，debug 端点 404', async () => {
    const calls: StubCalls = { loadInspector: 0, ocrWindows: [] };
    const seenRunHeaders: Array<string | null> = [];
    const { url } = serve(calls, seenRunHeaders);
    configureGatewayBaseUrl(url);
    try {
      await streamDiscoverToc('u1', { file: new File([miniPdfBytes()], 'mini.pdf', { type: 'application/pdf' }) });
    } finally {
      configureGatewayBaseUrl(DEFAULT_GATEWAY_BASE_URL);
    }
    expect(seenRunHeaders.length).toBeGreaterThan(0);
    for (const header of seenRunHeaders) {
      expect(header).toBeNull();
    }
    const debug = await fetch(`${url}/api/debug/toc-arrivals`, { method: 'GET' });
    expect(debug.status).toBe(404);
  });
});
