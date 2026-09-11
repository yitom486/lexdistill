import { describe, expect, it, afterEach } from 'bun:test';
import { GatewayRequestError } from '../../lib/gateway-error.js';
import { streamDiscoverToc } from '../textbooks-annotations.js';

/**
 * CMD-LINGUA-P2.1 流式客户端单测（无私人 PDF、无真实网关）。
 * 全局 fetch 桩回 NDJSON 字节流（分块投喂，模拟真实流式到达），
 * 验证事件回调、取消语义、失败透传与异常结束。
 */

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const FOUND_RESULT = {
  status: 'found',
  candidates: [{ fromPage: 2, toPage: 4, score: 12 }],
  pageCount: 100,
  pagesScanned: [1, 2, 3],
  ocrPages: [1, 2],
  embedded: false,
};

function ndjson(lines: unknown[]): string {
  return lines.map((line) => `${JSON.stringify(line)}\n`).join('');
}

function installStreamStub(chunks: string[], status = 200, payload: unknown = null): { calls: string[] } {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
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

describe('streamDiscoverToc', () => {
  it('分块到达的事件逐行回调，completed 回数据', async () => {
    const body = ndjson([
      { type: 'started', elapsedMs: 1 },
      { type: 'page_count_ready', plannedPages: 30, elapsedMs: 2 },
      { type: 'ocr_batch_completed', plannedPages: 30, completedPages: 5, batchFrom: 1, batchTo: 5, elapsedMs: 3 },
      { type: 'scoring', plannedPages: 30, completedPages: 30, elapsedMs: 4 },
      { type: 'completed', plannedPages: 30, completedPages: 30, elapsedMs: 5, result: FOUND_RESULT },
    ]);
    // 故意按行碎片化，证明解析不依赖分块边界
    const chunks = body.split('\n').map((line) => `${line}\n`);
    const { calls } = installStreamStub(chunks);
    const seen: string[] = [];
    const out = await streamDiscoverToc('u1', { filePath: 'C:\\book\\a.pdf' }, { onEvent: (e) => seen.push(e.type) });
    expect(out.cancelled).toBe(false);
    expect(out.data?.status).toBe('found');
    expect(out.data?.candidates).toEqual([{ fromPage: 2, toPage: 4, score: 12 }]);
    expect(seen).toEqual(['started', 'page_count_ready', 'ocr_batch_completed', 'scoring', 'completed']);
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain('/discover-toc-stream');
  });

  it('file 走 multipart，File 源同样可用', async () => {
    installStreamStub([
      ndjson([{ type: 'completed', plannedPages: 3, completedPages: 3, elapsedMs: 1, result: FOUND_RESULT }]),
    ]);
    const file = new File(['%PDF-1.4 x'], 't.pdf', { type: 'application/pdf' });
    const out = await streamDiscoverToc('u1', { file });
    expect(out.cancelled).toBe(false);
    expect(out.data?.pageCount).toBe(100);
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
    const pending = streamDiscoverToc('u1', { filePath: 'C:\\x.pdf' }, { signal: ctrl.signal });
    ctrl.abort();
    const out = await pending;
    expect(out.cancelled).toBe(true);
    expect(out.data).toBeNull();
  });

  it('服务端 cancelled 事件：resolve cancelled，不抛错', async () => {
    installStreamStub([
      ndjson([
        { type: 'started', elapsedMs: 1 },
        { type: 'cancelled', plannedPages: 30, completedPages: 10, elapsedMs: 2 },
        { type: 'completed', plannedPages: 30, completedPages: 30, elapsedMs: 3, result: FOUND_RESULT },
      ]),
    ]);
    const seen: string[] = [];
    const out = await streamDiscoverToc('u1', { filePath: 'C:\\x.pdf' }, { onEvent: (e) => seen.push(e.type) });
    expect(out.cancelled).toBe(true);
    expect(out.data).toBeNull();
    // cancelled 之后的行不再回调（迟到 completed 被客户端丢弃）
    expect(seen).toEqual(['started', 'cancelled']);
  });

  it('服务端 failed 事件：抛 userMessage（取消外唯一的错误路径）', async () => {
    installStreamStub([
      ndjson([{ type: 'failed', elapsedMs: 1, code: 'E_PDF_PARSE', userMessage: '目录页探测失败，请稍后重试' }]),
    ]);
    const err = await streamDiscoverToc('u1', { filePath: 'C:\\x.pdf' }).then(
      () => null,
      (e: unknown) => e
    );
    expect(err instanceof GatewayRequestError).toBe(true);
    expect((err as Error).message).toBe('目录页探测失败，请稍后重试');
  });

  it('流异常结束（无 completed）：抛中性错误，不静默挂起', async () => {
    installStreamStub([ndjson([{ type: 'started', elapsedMs: 1 }])]);
    const err = await streamDiscoverToc('u1', { filePath: 'C:\\x.pdf' }).then(
      () => null,
      (e: unknown) => e
    );
    expect((err as Error).message).toBe('识别目录返回异常，请稍后重试');
  });

  it('HTTP 非 200：走旧信封 userMessage', async () => {
    installStreamStub([], 400, {
      success: false,
      error: { code: 'E_INVALID_INPUT', userMessage: '未收到 PDF 文件', category: 'VALIDATION', retryable: false },
    });
    const err = await streamDiscoverToc('u1', { filePath: 'C:\\x.pdf' }).then(
      () => null,
      (e: unknown) => e
    );
    expect((err as Error).message).toBe('未收到 PDF 文件');
  });

  it('P2.1a input_read 事件透传回调且不影响完成', async () => {
    installStreamStub([
      ndjson([
        { type: 'started', elapsedMs: 1 },
        { type: 'input_read_started', elapsedMs: 2 },
        { type: 'input_read_progress', readBytes: 262144, totalBytes: 1048576, elapsedMs: 3 },
        { type: 'input_read_ready', readBytes: 1048576, totalBytes: 1048576, elapsedMs: 4 },
        { type: 'completed', plannedPages: 3, completedPages: 3, elapsedMs: 5, result: FOUND_RESULT },
      ]),
    ]);
    const seen: Array<{ type: string; readBytes: number | null; totalBytes: number | null }> = [];
    const out = await streamDiscoverToc('u1', { filePath: 'C:\\x.pdf' }, {
      onEvent: (e) => seen.push({ type: e.type, readBytes: e.readBytes, totalBytes: e.totalBytes }),
    });
    expect(out.cancelled).toBe(false);
    expect(out.data?.status).toBe('found');
    expect(seen.map((e) => e.type)).toEqual([
      'started',
      'input_read_started',
      'input_read_progress',
      'input_read_ready',
      'completed',
    ]);
    expect(seen[2]).toMatchObject({ readBytes: 262144, totalBytes: 1048576 });
  });
});
