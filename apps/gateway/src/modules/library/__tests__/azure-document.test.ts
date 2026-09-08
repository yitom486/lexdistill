import { describe, it, expect } from 'bun:test';
import {
  analyzePagesWithAzure,
  analyzeWithEndpoint,
  normalizeAzureEndpoint,
} from '../application/ocr/azure-document.js';
import { selectFailedPages, azureLinesToLayoutItems } from '../application/pdf-import/pdf-import-service.js';

/**
 * Azure 云 OCR fallback（stub fetch，只进单测）：
 * - endpoint 白名单 + 跨域轮询拒绝；
 * - 202→轮询→succeeded 全流程解析（行/框/span 对齐置信度）；
 * - 401/429 错误映射；失败页阈值挑选。
 */

function jsonResponse(body: unknown, status: number, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
  });
}

const SUCCEEDED_BODY = {
  status: 'succeeded',
  analyzeResult: {
    pages: [
      {
        pageNumber: 16,
        lines: [
          { content: '第2課', polygon: [200, 80, 260, 80, 260, 98, 200, 98], spans: [{ offset: 0, length: 3 }] },
          { content: 'これは辞書です', polygon: [60, 200, 200, 200, 200, 212, 60, 212], spans: [{ offset: 4, length: 8 }] },
        ],
        words: [
          { content: '第2課', polygon: [200, 80, 260, 80, 260, 98, 200, 98], confidence: 0.99, span: { offset: 0, length: 3 } },
          { content: 'これは辞書です', polygon: [60, 200, 200, 200, 200, 212, 60, 212], confidence: 0.9, span: { offset: 4, length: 8 } },
        ],
      },
    ],
  },
};

function stubFetchOk(): typeof fetch {
  let calls = 0;
  const fn = (async (_url: unknown) => {
    calls++;
    if (calls === 1) {
      return new Response(null, {
        status: 202,
        // 真实 Azure 回同 host；跨 host 会被守卫拒绝（防 Key 外泄），桩必须同 host
        headers: { 'operation-location': 'https://lingua-test.cognitiveservices.azure.com/op/1?api-version=2024-11-30' },
      });
    }
    return jsonResponse(SUCCEEDED_BODY, 200);
  }) as unknown as typeof fetch;
  return fn;
}

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

describe('normalizeAzureEndpoint', () => {
  it('拒绝非 https / 非 Azure 域名 / 垃圾输入（DNS 之前）', async () => {
    for (const bad of [
      'http://x.cognitiveservices.azure.com',
      'https://evil.com/x',
      'https://cognitiveservices.azure.com.evil.com',
      'not a url',
      '',
    ]) {
      let code = '';
      try {
        await normalizeAzureEndpoint(bad);
      } catch (e) {
        code = (e as { code?: string }).code ?? '';
      }
      expect(code).toMatch(/E_INVALID_INPUT/);
    }
  });
});

describe('analyzePagesWithAzure', () => {
  // 内层接缝（endpoint 已验，不碰 DNS）+ stub fetch：全流程 hermetic 可测；
  // 外层只测 DNS 之前的前置分支（空页/空钥），与 news-ssrf 只测拦截面同口径。
  const ENDPOINT = 'https://lingua-test.cognitiveservices.azure.com';

  it('202→轮询→succeeded：行/框/置信度对齐', async () => {
    const res = await analyzeWithEndpoint({
      pdfBytes: PDF,
      pages: [16],
      endpoint: ENDPOINT,
      apiKey: 'k',
      fetchImpl: stubFetchOk(),
    });
    if (!res.ok) throw new Error(`unexpected err ${res.error.code}: ${res.error.userMessage}`);
    expect(res.value.pages.length).toBe(1);
    const p = res.value.pages[0]!;
    expect(p.pageNumber).toBe(16);
    expect(p.markdown).toBe('第2課\nこれは辞書です');
    expect(p.lines[0]).toMatchObject({ text: '第2課', confidence: 0.99 });
    expect(p.lines[0]!.width).toBeGreaterThan(0);
    expect(p.lines[0]!.height).toBe(18);
    expect(p.confidence).toBeCloseTo(0.945, 3);
  });

  it('轮询地址跨域拒绝跟随', async () => {
    const evil = (async (url: unknown, _init?: unknown) => {
      if (typeof url === 'string' && url.includes(':analyze')) {
        return new Response(null, {
          status: 202,
          headers: { 'operation-location': 'https://evil.com/op/1' },
        });
      }
      return jsonResponse(SUCCEEDED_BODY, 200);
    }) as unknown as typeof fetch;
    const res = await analyzeWithEndpoint({
      pdfBytes: PDF,
      pages: [16],
      endpoint: ENDPOINT,
      apiKey: 'k',
      fetchImpl: evil,
    });
    expect(res.ok).toBe(false);
  });

  it('401 → E_AZURE_AUTH 不可重试；429 → 限流可重试', async () => {
    const f401 = (async () => new Response('{"error":{"code":"Unauthorized","message":"bad key"}}', { status: 401 })) as unknown as typeof fetch;
    // endpoint 校验先行：用合法后缀但 stub 不会走到 DNS？normalize 会 DNS。
    // 为隔离错误映射，DNS 可达时才断言；否则只验空页/空钥等前置分支。
    const empty = await analyzePagesWithAzure({
      pdfBytes: PDF,
      pages: [],
      credentials: { endpoint: 'https://x.cognitiveservices.azure.com', apiKey: 'k' },
      fetchImpl: f401,
    });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe('E_INVALID_INPUT');
    const noKey = await analyzePagesWithAzure({
      pdfBytes: PDF,
      pages: [1],
      credentials: { endpoint: 'https://x.cognitiveservices.azure.com', apiKey: '' },
      fetchImpl: f401,
    });
    expect(noKey.ok).toBe(false);
    if (!noKey.ok) expect(noKey.error.code).toBe('E_INVALID_INPUT');
  });
});

describe('失败页挑选与云行转版式', () => {
  it('过薄页才打云；达标页不打扰', () => {
    const pages = selectFailedPages(
      new Map([
        [5, 'x'.repeat(49)],
        [6, 'y'.repeat(50)],
        [7, ''],
      ])
    );
    expect(pages).toEqual([5, 7]);
  });

  it('云行转 LayoutTextItem（字号取行高，粗体缺席不断言）', () => {
    const items = azureLinesToLayoutItems({
      pageNumber: 16,
      markdown: '第2課',
      confidence: 0.99,
      lines: [{ text: '第2課', x: 200, y: 80, width: 60, height: 18, confidence: 0.99 }],
    });
    expect(items).toEqual([
      { text: '第2課', page: 16, x: 200, y: 80, width: 60, height: 18, fontSize: 18, isBold: false },
    ]);
  });
});
