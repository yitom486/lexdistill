import { describe, expect, it, afterEach } from 'bun:test';
import { GatewayRequestError } from '../../lib/gateway-error.js';
import { streamExtractTocBaseline } from '../textbooks-annotations.js';

/**
 * CMD-LINGUA-P3.3 基线流式客户端单测（无私人 PDF、无真实网关）。
 * 全局 fetch 桩回 NDJSON 字节流（分块投喂），验证事件回调、取消语义、
 * 失败透传与异常结束。
 */

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const BASELINE_RESULT = {
  status: 'ok',
  verdict: 'usable',
  range: { fromPage: 16, toPage: 21 },
  pageCount: 371,
  entries: [
    { title: '第1課', printedPage: 12, level: 1, source: 'text', kind: 'lesson' },
    { title: '第2課', printedPage: 30, level: 1, source: 'text', kind: 'lesson' },
  ],
  diagnostics: { pagesRequested: 6, pagesOcr: 6, linesConsidered: 8, linesDroppedWash: 0, entriesAccepted: 2, entriesRejected: 0, badTitle: 0 },
  pageEvidence: [{ page: 16, excerpt: '第1課 12' }],
  embedded: false,
};

function ndjson(lines: unknown[]): string {
  return lines.map((line) => `${JSON.stringify(line)}\n`).join('');
}

function installStreamStub(chunks: string[], status = 200, payload: unknown = null): { calls: string[] } {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    void init;
    if (status !== 200) {
      return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
    }
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
  }) as typeof fetch;
  return { calls };
}

const RANGE = { startPage: 16, endPage: 21 };

describe('streamExtractTocBaseline', () => {
  it('分块到达逐行回调，completed 回基线（含 verdict/证据）', async () => {
    const body = ndjson([
      { type: 'started', elapsedMs: 1 },
      { type: 'input_read_started', elapsedMs: 2 },
      { type: 'ocr_batch_completed', plannedPages: 6, completedPages: 5, batchFrom: 16, batchTo: 20, elapsedMs: 3 },
      { type: 'parsing', plannedPages: 6, completedPages: 6, elapsedMs: 4 },
      { type: 'completed', plannedPages: 6, completedPages: 6, elapsedMs: 5, result: BASELINE_RESULT },
    ]);
    const chunks = body.split('\n').map((line) => `${line}\n`);
    const { calls } = installStreamStub(chunks);
    const seen: string[] = [];
    const out = await streamExtractTocBaseline('u1', { filePath: 'C:\\book\\a.pdf' }, RANGE, { onEvent: (e) => seen.push(e.type) });
    expect(out.cancelled).toBe(false);
    expect(out.data?.verdict).toBe('usable');
    expect(out.data?.entries.length).toBe(2);
    expect(out.data?.pageEvidence.length).toBe(1);
    expect(seen).toEqual(['started', 'input_read_started', 'ocr_batch_completed', 'parsing', 'completed']);
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain('/extract-toc-stream');
  });

  it('file 源走 multipart（startPage/endPage 随表单）', async () => {
    installStreamStub([ndjson([{ type: 'completed', plannedPages: 6, completedPages: 6, elapsedMs: 1, result: BASELINE_RESULT }])]);
    const seen: string[] = [];
    const bodies: unknown[] = [];
    const stubbed = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const form = init?.body;
      if (typeof FormData !== 'undefined' && form instanceof FormData) {
        const fields: Record<string, string> = {};
        for (const [key, value] of form.entries()) {
          fields[key] = typeof value === 'string' ? value : (value as File).name;
        }
        bodies.push(fields);
      }
      return stubbed(input, init);
    }) as typeof fetch;
    const file = new File(['%PDF-1.4 x'], 't.pdf', { type: 'application/pdf' });
    const out = await streamExtractTocBaseline('u1', { file }, RANGE, { onEvent: (e) => seen.push(e.type) });
    expect(out.cancelled).toBe(false);
    expect(out.data?.verdict).toBe('usable');
    expect(seen).toEqual(['completed']);
    expect(JSON.stringify(bodies)).toContain('startPage');
  });

  it('用户 abort：resolve cancelled，不抛错', async () => {
    globalThis.fetch = (async (_input: unknown, init?: RequestInit): Promise<Response> => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => resolve(), 5000);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
      return new Response('never', { status: 200 });
    }) as typeof fetch;
    const ctrl = new AbortController();
    const pending = streamExtractTocBaseline('u1', { filePath: 'C:\\x.pdf' }, RANGE, { signal: ctrl.signal });
    ctrl.abort();
    const out = await pending;
    expect(out.cancelled).toBe(true);
    expect(out.data).toBeNull();
  });

  it('服务端 cancelled：resolve cancelled，迟到 completed 丢弃', async () => {
    installStreamStub([
      ndjson([
        { type: 'started', elapsedMs: 1 },
        { type: 'cancelled', plannedPages: 6, completedPages: 5, elapsedMs: 2 },
        { type: 'completed', plannedPages: 6, completedPages: 6, elapsedMs: 3, result: BASELINE_RESULT },
      ]),
    ]);
    const seen: string[] = [];
    const out = await streamExtractTocBaseline('u1', { filePath: 'C:\\x.pdf' }, RANGE, { onEvent: (e) => seen.push(e.type) });
    expect(out.cancelled).toBe(true);
    expect(out.data).toBeNull();
    expect(seen).toEqual(['started', 'cancelled']);
  });

  it('服务端 failed：抛 userMessage', async () => {
    installStreamStub([
      ndjson([{ type: 'failed', elapsedMs: 1, code: 'E_PDF_PARSE', userMessage: '目录基线 OCR 失败，请稍后重试' }]),
    ]);
    const err = await streamExtractTocBaseline('u1', { filePath: 'C:\\x.pdf' }, RANGE).then(
      () => null,
      (e: unknown) => e
    );
    expect(err instanceof GatewayRequestError).toBe(true);
    expect((err as Error).message).toContain('目录基线');
  });

  it('流异常结束：抛中性错误', async () => {
    installStreamStub([ndjson([{ type: 'started', elapsedMs: 1 }])]);
    const err = await streamExtractTocBaseline('u1', { filePath: 'C:\\x.pdf' }, RANGE).then(
      () => null,
      (e: unknown) => e
    );
    expect((err as Error).message).toBe('目录基线返回异常，请稍后重试');
  });
});
