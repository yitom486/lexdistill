import { describe, expect, it, afterEach } from 'bun:test';
import { ok } from '@study-studio/shared';
import type { Hono } from 'hono';
import type { PdfInspectorLike } from '../application/pdf-import/pdf-runtime.js';
import type { LocalPdfStreamedOutcome } from '../application/pdf-import/local-file.js';
import type {
  TocDiscoveryFileReader,
  TocDiscoveryStreamEvent,
} from '../application/pdf-import/toc-discovery-stream.js';
import { createPdfImportRoutes } from '../http/pdf-import-routes.js';

/**
 * CMD-LINGUA-P2.2 真实 loopback HTTP 时序（Bun.serve + 真实 fetch）。
 *
 * app.request() 只验最终 body，验不出“首字节何时到”；本文件证明：
 * JSON filePath 请求在文件内容未读完前，真实浏览器就已拿到 HTTP 200、
 * NDJSON Content-Type、started、input_read_started；abort 后读取停止、
 * runtime/OCR 为 0、无 completed。端口随机（port 0），用后即停。
 */

const JA_TOC = [
  '目次',
  '第1課 はじめまして ………………… 2',
  '第2課 これは本です ………………… 5',
].join('\n');

function mockBytes(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.4 mock-loopback');
}

interface StubCalls {
  loadInspector: number;
  ocr: number;
}

function stubInspector(calls: StubCalls): PdfInspectorLike {
  return {
    processPdf: () => ({ pdfType: 'TextBased', pageCount: 371, markdown: '', pagesNeedingOcr: [] }),
    processPdfWithOcr: async (_pdf, opts) => {
      calls.ocr++;
      const window = Array.isArray(opts?.pageNumbers) ? opts.pageNumbers : [];
      return {
        markdown: '',
        pages: window.map((n) => ({ pageNumber: n, markdown: n === 3 ? JA_TOC : 'plain' })),
        pagesRoutedToOcr: [],
      };
    },
  };
}

/** 门控 reader：释放前读取永远 pending（模拟大文件慢读）。 */
function gatedReader() {
  let release: (v: LocalPdfStreamedOutcome) => void = () => {};
  const gate = new Promise<LocalPdfStreamedOutcome>((r) => {
    release = r;
  });
  let calls = 0;
  const reader: TocDiscoveryFileReader = () => {
    calls++;
    return gate;
  };
  return { reader, calls: () => calls, release };
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
});

function serve(app: Hono): string {
  const server = Bun.serve({ port: 0, fetch: app.fetch });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

function mount(calls: StubCalls, reader: TocDiscoveryFileReader): Hono {
  return createPdfImportRoutes(
    { repo: {} as never, server: {} as never, port: 0 },
    {
      loadInspector: async () => {
        calls.loadInspector++;
        return stubInspector(calls);
      },
      readLocalFile: reader,
    }
  );
}

interface LineReader {
  nextLine(timeoutMs: number): Promise<string>;
  readRest(timeoutMs: number): Promise<string>;
}

function lineReader(body: ReadableStream<Uint8Array>): LineReader {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let ended = false;
  const fill = async (): Promise<void> => {
    const { done, value } = await reader.read();
    if (done) {
      ended = true;
      return;
    }
    if (value) buffer += decoder.decode(value, { stream: true });
  };
  const nextLine = async (timeoutMs: number): Promise<string> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const idx = buffer.indexOf('\n');
      if (idx >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) return line;
        continue;
      }
      if (ended) throw new Error('stream ended before next line');
      if (Date.now() > deadline) throw new Error('timed out waiting for next NDJSON line');
      await Promise.race([fill(), Bun.sleep(5)]);
    }
  };
  const readRest = async (timeoutMs: number): Promise<string> => {
    const deadline = Date.now() + timeoutMs;
    let tail = '';
    for (;;) {
      if (ended && !buffer) break;
      const idx = buffer.indexOf('\n');
      if (idx >= 0) {
        tail += `${buffer.slice(0, idx + 1)}`;
        buffer = buffer.slice(idx + 1);
        continue;
      }
      if (ended) {
        tail += buffer;
        buffer = '';
        break;
      }
      if (Date.now() > deadline) throw new Error('timed out waiting for stream end');
      await fill();
    }
    return tail;
  };
  return { nextLine, readRest };
}

function parseEvent(line: string): TocDiscoveryStreamEvent {
  return JSON.parse(line) as TocDiscoveryStreamEvent;
}

describe('P2.2 真 HTTP 首事件时序（gate 阻塞中）', () => {
  it('gate 未释放时：已 200 + NDJSON + started + input_read_started，runtime/OCR 为 0', async () => {
    const calls: StubCalls = { loadInspector: 0, ocr: 0 };
    const gate = gatedReader();
    const url = serve(mount(calls, gate.reader));
    const res = await fetch(`${url}/api/documents/u1/discover-toc-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: '/tmp/loopback.pdf' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    if (!res.body) throw new Error('missing body');
    const lines = lineReader(res.body);
    // gate 仍阻塞：这两行必须在 3 秒内到达（async start 旧实现下稳定超时）。
    const first = parseEvent(await lines.nextLine(3000));
    const second = parseEvent(await lines.nextLine(3000));
    expect(first.type).toBe('started');
    expect(second.type).toBe('input_read_started');
    expect(gate.calls()).toBe(1);
    expect(calls.loadInspector).toBe(0);
    expect(calls.ocr).toBe(0);
    // 释放后流正常走完
    gate.release({ cancelled: false, result: ok({ bytes: mockBytes(), filename: 'loopback.pdf' }) });
    const tail = await lines.readRest(10000);
    const tailTypes = tail
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => parseEvent(l).type);
    expect(tailTypes[tailTypes.length - 1]).toBe('completed');
    expect(calls.ocr).toBe(6);
    await res.body.cancel().catch(() => {});
  });

  it('真 HTTP abort：input_read_started 后取消，读取停止，无 completed，runtime/OCR 为 0', async () => {
    const calls: StubCalls = { loadInspector: 0, ocr: 0 };
    const gate = gatedReader();
    const url = serve(mount(calls, gate.reader));
    const ctrl = new AbortController();
    const res = await fetch(`${url}/api/documents/u1/discover-toc-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: '/tmp/loopback-abort.pdf' }),
      signal: ctrl.signal,
    });
    expect(res.status).toBe(200);
    if (!res.body) throw new Error('missing body');
    const lines = lineReader(res.body);
    expect(parseEvent(await lines.nextLine(3000)).type).toBe('started');
    expect(parseEvent(await lines.nextLine(3000)).type).toBe('input_read_started');
    ctrl.abort();
    // 释放 gate 让 producer 有机会结束（abort 已标记取消，只应发 cancelled）
    gate.release({ cancelled: true });
    const tail = await lines.readRest(10000).catch(() => '');
    const tailTypes = tail
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return parseEvent(l).type;
        } catch {
          return 'unparsed';
        }
      });
    expect(tailTypes).not.toContain('completed');
    expect(tailTypes).not.toContain('runtime_check');
    expect(calls.loadInspector).toBe(0);
    expect(calls.ocr).toBe(0);
    await res.body.cancel().catch(() => {});
    await Bun.sleep(20);
  });
});
