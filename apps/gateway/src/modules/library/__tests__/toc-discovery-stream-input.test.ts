import { describe, expect, it, afterEach } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promises as fsp } from 'node:fs';
import { isOk, ok } from '@study-studio/shared';
import type { PdfInspectorLike } from '../application/pdf-import/pdf-runtime.js';
import type {
  LocalPdfStreamedHooks,
  LocalPdfStreamedOutcome,
} from '../application/pdf-import/local-file.js';
import { readLocalPdfFileStreamed } from '../application/pdf-import/local-file.js';
import {
  discoverTocPagesStreamFromFile,
  type TocDiscoveryFileReader,
  type TocDiscoveryStreamEvent,
} from '../application/pdf-import/toc-discovery-stream.js';
import { createPdfImportRoutes } from '../http/pdf-import-routes.js';

/**
 * CMD-LINGUA-P2.1a：流内文件读取单测（全合成字节，无私人 PDF）。
 * - 服务层用可门控 fake reader 证明“读取完成前即有事件、abort 可停读”；
 * - 真临时文件（os.tmpdir，用后即删）证明分块进度真实递增、总量一致；
 * - 路由层证明 JSON filePath 先建流后读文件，multipart/旧端点回归。
 */

const JA_TOC = [
  '目次',
  '第1課 はじめまして ………………… 2',
  '第2課 これは本です ………………… 5',
  '第3課 さんぽ ………………… 8',
  '復習A ………………… 12',
].join('\n');

const BODY_TEXT = '本文です。\nこれはテストです。';

function mockBytes(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.4 mock-toc-input');
}

interface StubCalls {
  loadInspector: number;
  ocr: Array<number[] | undefined>;
}

function newCalls(): StubCalls {
  return { loadInspector: 0, ocr: [] };
}

function loadStub(pageMd: Record<number, string>, calls: StubCalls, outline?: unknown): () => Promise<PdfInspectorLike> {
  return async () => {
    calls.loadInspector++;
    return {
      processPdf: () => ({ pdfType: 'TextBased', pageCount: 371, markdown: '', pagesNeedingOcr: [] }),
      processPdfWithOcr: async (_pdf, opts) => {
        const window = Array.isArray(opts?.pageNumbers) ? opts.pageNumbers : [];
        calls.ocr.push(window);
        return {
          markdown: '',
          pages: window.map((n) => ({ pageNumber: n, markdown: pageMd[n] ?? BODY_TEXT })),
          pagesRoutedToOcr: [],
        };
      },
      ...(outline ? { extractEmbeddedOutline: () => outline as never } : {}),
    };
  };
}

function types(events: TocDiscoveryStreamEvent[]): string[] {
  return events.map((e) => e.type);
}

/** 可门控 fake reader：resolve 前读取永远 pending（复现慢速本地盘）。 */
function deferredReader() {
  let resolveRead: (v: LocalPdfStreamedOutcome) => void = () => {};
  const gate = new Promise<LocalPdfStreamedOutcome>((r) => {
    resolveRead = r;
  });
  const reader: TocDiscoveryFileReader = () => gate;
  return { reader, resolveRead };
}

/** 分块 fake reader：每块 honour signal，块间同步钩子可 abort（确定性取消）。 */
function chunkedReader(totalBytes: number, chunkBytes: number, onChunk?: (read: number) => void): TocDiscoveryFileReader {
  return async (_path, hooks: LocalPdfStreamedHooks) => {
    let read = 0;
    while (read < totalBytes) {
      if (hooks.signal?.aborted) return { cancelled: true };
      await Bun.sleep(0);
      if (hooks.signal?.aborted) return { cancelled: true };
      read = Math.min(totalBytes, read + chunkBytes);
      onChunk?.(read);
      if (hooks.signal?.aborted) return { cancelled: true };
      hooks.onProgress?.({ readBytes: read, totalBytes });
    }
    return { cancelled: false, result: ok({ bytes: mockBytes(), filename: 'fake.pdf' }) };
  };
}

const tempFiles: string[] = [];
afterEach(async () => {
  for (const f of tempFiles.splice(0)) {
    try {
      await fsp.unlink(f);
    } catch {
      // 已删或从未落盘
    }
  }
});

async function writeTempPdf(sizeBytes: number): Promise<{ path: string; size: number }> {
  const p = join(tmpdir(), `p21a-${Date.now()}-${Math.floor(Math.random() * 1e9)}.pdf`);
  const buf = Buffer.alloc(sizeBytes, 0x41);
  buf.write('%PDF-1.4 synthetic-p21a', 0, 'latin1');
  await fsp.writeFile(p, buf);
  tempFiles.push(p);
  return { path: p, size: sizeBytes };
}

const FORBIDDEN_TOKENS = [
  'filePath',
  'filename',
  '"path"',
  'userId',
  'markdown',
  '"title"',
  'folio',
  'entries',
  'model',
  'C:\\',
  '/tmp/',
  '目次',
  '第1課',
  '本文',
];

describe('P2.1a 读取完成前即有事件（门控 reader）', () => {
  it('started/input_read_started 先于文件内容到达；零运行时准备', async () => {
    const calls = newCalls();
    const gate = deferredReader();
    const events: TocDiscoveryStreamEvent[] = [];
    const outcomeP = discoverTocPagesStreamFromFile(
      { loadInspector: loadStub({ 3: JA_TOC }, calls), readLocalFile: gate.reader },
      { userId: 'u1', filePath: '/tmp/slow.pdf' },
      { emit: (e) => events.push(e) }
    );
    await Bun.sleep(10);
    expect(types(events)).toEqual(['started', 'input_read_started']);
    expect(calls.loadInspector).toBe(0);
    expect(calls.ocr).toEqual([]);
    gate.resolveRead({ cancelled: false, result: ok({ bytes: mockBytes(), filename: 'slow.pdf' }) });
    const outcome = await outcomeP;
    expect(outcome.cancelled).toBe(false);
    if (outcome.cancelled) return;
    expect(isOk(outcome.result)).toBe(true);
    expect(types(events)[types(events).length - 1]).toBe('completed');
  });

  it('门控期间 abort：只有 cancelled，不碰运行时/OCR', async () => {
    const calls = newCalls();
    const gate = deferredReader();
    const ctrl = new AbortController();
    const events: TocDiscoveryStreamEvent[] = [];
    const outcomeP = discoverTocPagesStreamFromFile(
      { loadInspector: loadStub({ 3: JA_TOC }, calls), readLocalFile: gate.reader },
      { userId: 'u1', filePath: '/tmp/slow.pdf' },
      { emit: (e) => events.push(e), signal: ctrl.signal }
    );
    await Bun.sleep(10);
    expect(types(events)).toEqual(['started', 'input_read_started']);
    ctrl.abort();
    gate.resolveRead({ cancelled: true });
    const outcome = await outcomeP;
    expect(outcome.cancelled).toBe(true);
    expect(types(events)).toEqual(['started', 'input_read_started', 'cancelled']);
    expect(calls.loadInspector).toBe(0);
    expect(calls.ocr).toEqual([]);
  });
});

describe('P2.1a 分块进度与读取中取消（chunked fake）', () => {
  it('进度真实递增、总量一致，读完走满 6 个 5 页批次', async () => {
    const calls = newCalls();
    const events: TocDiscoveryStreamEvent[] = [];
    const outcome = await discoverTocPagesStreamFromFile(
      { loadInspector: loadStub({ 3: JA_TOC }, calls), readLocalFile: chunkedReader(700 * 1024, 100 * 1024) },
      { userId: 'u1', filePath: '/tmp/c.pdf' },
      { emit: (e) => events.push(e) }
    );
    expect(outcome.cancelled).toBe(false);
    const head = types(events).slice(0, 2);
    expect(head).toEqual(['started', 'input_read_started']);
    const progresses = events.filter((e) => e.type === 'input_read_progress');
    expect(progresses.length).toBeGreaterThanOrEqual(2);
    const reads = progresses.map((e) => (e.type === 'input_read_progress' ? e.readBytes : -1));
    const totals = progresses.map((e) => (e.type === 'input_read_progress' ? e.totalBytes : -1));
    for (let i = 1; i < reads.length; i++) {
      expect((reads[i] as number) > (reads[i - 1] as number)).toBe(true);
    }
    for (const t of totals) expect(t).toBe(700 * 1024);
    const ready = events.find((e) => e.type === 'input_read_ready');
    if (ready?.type !== 'input_read_ready') throw new Error('missing ready');
    expect(ready.totalBytes).toBe(700 * 1024);
    // 读完后 P2.1 语义不变
    expect(calls.ocr.length).toBe(6);
    const done = events[events.length - 1];
    if (done?.type !== 'completed') throw new Error('missing completed');
    expect(done.result.status).toBe('found');
  });

  it('第 2 块后 abort：停读，只有 cancelled，无 runtime_check、无 OCR', async () => {
    const calls = newCalls();
    const ctrl = new AbortController();
    const events: TocDiscoveryStreamEvent[] = [];
    const outcome = await discoverTocPagesStreamFromFile(
      {
        loadInspector: loadStub({ 3: JA_TOC }, calls),
        readLocalFile: chunkedReader(10 * 1024 * 1024, 100 * 1024, (read) => {
          if (read >= 200 * 1024) ctrl.abort();
        }),
      },
      { userId: 'u1', filePath: '/tmp/big.pdf' },
      { emit: (e) => events.push(e), signal: ctrl.signal }
    );
    expect(outcome.cancelled).toBe(true);
    expect(types(events)).toEqual(['started', 'input_read_started', 'input_read_progress', 'cancelled']);
    expect(types(events)).not.toContain('runtime_check');
    expect(types(events)).not.toContain('completed');
    expect(calls.loadInspector).toBe(0);
    expect(calls.ocr).toEqual([]);
  });

  it('读取失败（缺失文件，真 reader）：failed E_INVALID_INPUT，不碰运行时', async () => {
    const calls = newCalls();
    const events: TocDiscoveryStreamEvent[] = [];
    const outcome = await discoverTocPagesStreamFromFile(
      { loadInspector: loadStub({ 3: JA_TOC }, calls) },
      { userId: 'u1', filePath: join(tmpdir(), `p21a-ghost-${Date.now()}.pdf`) },
      { emit: (e) => events.push(e) }
    );
    expect(outcome.cancelled).toBe(false);
    if (outcome.cancelled) return;
    expect(isOk(outcome.result)).toBe(false);
    const last = events[events.length - 1];
    if (last?.type !== 'failed') throw new Error(`unexpected tail: ${last?.type}`);
    expect(last.code).toBe('E_INVALID_INPUT');
    expect(types(events)).toEqual(['started', 'input_read_started', 'failed']);
    expect(calls.loadInspector).toBe(0);
  });

  it('新事件无敏感字段（路径/文件名/正文一律不在负载）', async () => {
    const calls = newCalls();
    const events: TocDiscoveryStreamEvent[] = [];
    await discoverTocPagesStreamFromFile(
      { loadInspector: loadStub({ 3: JA_TOC }, calls), readLocalFile: chunkedReader(300 * 1024, 100 * 1024) },
      { userId: 'u1', filePath: '/tmp/secret-dir/s.pdf' },
      { emit: (e) => events.push(e) }
    );
    const dumped = JSON.stringify(events);
    for (const token of FORBIDDEN_TOKENS) {
      expect(dumped.includes(token)).toBe(false);
    }
  });
});

describe('P2.1a 真临时文件读取（700KB 合成）', () => {
  it('进度递增且总量 == stat，大文件不再卡首事件', async () => {
    const { path, size } = await writeTempPdf(700 * 1024);
    const calls = newCalls();
    const events: TocDiscoveryStreamEvent[] = [];
    const outcome = await discoverTocPagesStreamFromFile(
      { loadInspector: loadStub({ 3: JA_TOC }, calls) },
      { userId: 'u1', filePath: path },
      { emit: (e) => events.push(e) }
    );
    expect(outcome.cancelled).toBe(false);
    expect(types(events).slice(0, 2)).toEqual(['started', 'input_read_started']);
    const progresses = events.filter((e) => e.type === 'input_read_progress');
    expect(progresses.length).toBeGreaterThanOrEqual(2);
    const reads = progresses.map((e) => (e.type === 'input_read_progress' ? (e.readBytes as number) : -1));
    for (let i = 1; i < reads.length; i++) {
      expect(reads[i] as number).toBeGreaterThan(reads[i - 1] as number);
    }
    const ready = events.find((e) => e.type === 'input_read_ready');
    if (ready?.type !== 'input_read_ready') throw new Error('missing ready');
    expect(ready.readBytes).toBe(size);
    expect(ready.totalBytes).toBe(size);
    const done = events[events.length - 1];
    if (done?.type !== 'completed') throw new Error('missing completed');
    expect(done.result.status).toBe('found');
    expect(calls.ocr.length).toBe(6);
  });

  it('embedded 短路经文件路径同样零 OCR', async () => {
    const { path } = await writeTempPdf(300 * 1024);
    const calls = newCalls();
    const events: TocDiscoveryStreamEvent[] = [];
    const outcome = await discoverTocPagesStreamFromFile(
      {
        loadInspector: loadStub({}, calls, {
          items: [{ title: 'Alpha', level: 1, physicalPage: 5 }],
          unresolvedCount: 0,
          truncated: false,
        }),
      },
      { userId: 'u1', filePath: path },
      { emit: (e) => events.push(e) }
    );
    expect(outcome.cancelled).toBe(false);
    if (outcome.cancelled) return;
    expect(isOk(outcome.result)).toBe(true);
    const done = events[events.length - 1];
    if (done?.type !== 'completed') throw new Error('missing completed');
    expect(done.result.embedded).toBe(true);
    expect(calls.ocr).toEqual([]);
  });
});

describe('P2.1a readLocalPdfFileStreamed 真文件', () => {
  it('字节与文件名正确；与整读同校验（相对路径/扩展名/缺失/坏魔数）', async () => {
    const { path, size } = await writeTempPdf(300 * 1024);
    const seen: Array<{ readBytes: number; totalBytes: number }> = [];
    const out = await readLocalPdfFileStreamed(path, { onProgress: (p) => seen.push(p) });
    expect(out.cancelled).toBe(false);
    if (out.cancelled) return;
    expect(isOk(out.result)).toBe(true);
    if (!isOk(out.result)) return;
    expect(out.result.value.bytes.length).toBe(size);
    expect(out.result.value.filename.endsWith('.pdf')).toBe(true);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]?.readBytes as number).toBeGreaterThan(seen[i - 1]?.readBytes as number);
    }

    const rel = await readLocalPdfFileStreamed('relative/x.pdf', {});
    expect(rel.cancelled).toBe(false);
    if (!rel.cancelled) expect(isOk(rel.result)).toBe(false);

    const badExt = await readLocalPdfFileStreamed(join(tmpdir(), 'x.txt'), {});
    expect(badExt.cancelled).toBe(false);
    if (!badExt.cancelled) {
      expect(isOk(badExt.result)).toBe(false);
      if (!isOk(badExt.result)) expect(badExt.result.error.code).toBe('E_INVALID_INPUT');
    }

    const ghost = await readLocalPdfFileStreamed(join(tmpdir(), `p21a-ghost-${Date.now()}.pdf`), {});
    expect(ghost.cancelled).toBe(false);

    const badMagic = join(tmpdir(), `p21a-badmagic-${Date.now()}.pdf`);
    tempFiles.push(badMagic);
    await fsp.writeFile(badMagic, Buffer.alloc(1024, 0x42));
    const bad = await readLocalPdfFileStreamed(badMagic, {});
    expect(bad.cancelled).toBe(false);
    if (!bad.cancelled) expect(isOk(bad.result)).toBe(false);
  });

  it('首个 progress 回调内 abort：确定性停读（cancelled）', async () => {
    const { path } = await writeTempPdf(5 * 1024 * 1024);
    const ctrl = new AbortController();
    const out = await readLocalPdfFileStreamed(path, {
      signal: ctrl.signal,
      onProgress: () => ctrl.abort(),
    });
    expect(out.cancelled).toBe(true);
  });

  it('预 abort：零读取即 cancelled', async () => {
    const { path } = await writeTempPdf(1024);
    const ctrl = new AbortController();
    ctrl.abort();
    const out = await readLocalPdfFileStreamed(path, { signal: ctrl.signal });
    expect(out.cancelled).toBe(true);
  });
});

describe('P2.1a 路由：JSON 先建流后读文件', () => {
  async function readLines(res: Response, max: number): Promise<{ lines: TocDiscoveryStreamEvent[]; reader: ReadableStreamDefaultReader<Uint8Array>; rest: () => Promise<string> }> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const lines: TocDiscoveryStreamEvent[] = [];
    const pump = async (): Promise<string> => {
      for (;;) {
        const { done, value } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: true });
        let idx = buffer.indexOf('\n');
        while (idx >= 0 && lines.length < max) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (line) lines.push(JSON.parse(line) as TocDiscoveryStreamEvent);
          idx = buffer.indexOf('\n');
        }
        if (lines.length >= max || done) return buffer;
      }
    };
    const restBuffer = await pump();
    return {
      lines,
      reader,
      rest: async () => {
        let tail = restBuffer;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) tail += decoder.decode(value, { stream: true });
        }
        return tail;
      },
    };
  }

  it('JSON filePath：读取完成前即收到 started/input_read_started（门控 reader）', async () => {
    const calls = newCalls();
    const gate = deferredReader();
    const app = createPdfImportRoutes(
      { repo: {} as never, server: {} as never, port: 0 },
      { loadInspector: loadStub({ 3: JA_TOC }, calls), readLocalFile: gate.reader }
    );
    const res = await app.request('/api/documents/u1/discover-toc-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: join(tmpdir(), 'deferred.pdf') }),
    });
    expect(res.status).toBe(200);
    const { lines, rest } = await readLines(res, 2);
    expect(types(lines)).toEqual(['started', 'input_read_started']);
    expect(calls.loadInspector).toBe(0);
    gate.resolveRead({ cancelled: false, result: ok({ bytes: mockBytes(), filename: 'deferred.pdf' }) });
    const tail = await rest();
    const tailTypes = tail
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => (JSON.parse(l) as TocDiscoveryStreamEvent).type);
    expect(tailTypes[tailTypes.length - 1]).toBe('completed');
  });

  it('JSON filePath 真临时文件：input_read_ready 总量 == 文件大小，尾部 completed', async () => {
    const { path, size } = await writeTempPdf(700 * 1024);
    const calls = newCalls();
    const app = createPdfImportRoutes(
      { repo: {} as never, server: {} as never, port: 0 },
      { loadInspector: loadStub({ 3: JA_TOC }, calls) }
    );
    const res = await app.request('/api/documents/u1/discover-toc-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: path }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const events = text
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as TocDiscoveryStreamEvent);
    expect(types(events).slice(0, 2)).toEqual(['started', 'input_read_started']);
    const ready = events.find((e) => e.type === 'input_read_ready');
    if (ready?.type !== 'input_read_ready') throw new Error('missing ready');
    expect(ready.readBytes).toBe(size);
    expect(ready.totalBytes).toBe(size);
    const done = events[events.length - 1];
    if (done?.type !== 'completed') throw new Error('missing completed');
    expect(done.result.status).toBe('found');
  });

  it('JSON 缺 filePath：仍即时 HTTP 400（形状校验仍在建流前）', async () => {
    const calls = newCalls();
    const app = createPdfImportRoutes(
      { repo: {} as never, server: {} as never, port: 0 },
      { loadInspector: loadStub({}, calls) }
    );
    const res = await app.request('/api/documents/u1/discover-toc-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(calls.loadInspector).toBe(0);
  });

  it('multipart 兼容：无 input_read 事件（不伪造），尾部 completed', async () => {
    const calls = newCalls();
    const app = createPdfImportRoutes(
      { repo: {} as never, server: {} as never, port: 0 },
      { loadInspector: loadStub({ 3: JA_TOC }, calls) }
    );
    const form = new FormData();
    form.append('file', new File([mockBytes() as unknown as BlobPart], 't.pdf', { type: 'application/pdf' }));
    const res = await app.request('/api/documents/u1/discover-toc-stream', { method: 'POST', body: form });
    expect(res.status).toBe(200);
    const events = (await res.text())
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as TocDiscoveryStreamEvent);
    expect(types(events)).not.toContain('input_read_started');
    expect(types(events)).not.toContain('input_read_progress');
    expect(types(events)).not.toContain('input_read_ready');
    const done = events[events.length - 1];
    if (done?.type !== 'completed') throw new Error('missing completed');
    expect(done.result.status).toBe('found');
  });
});

describe('P2.1a trace 白名单（含读取阶段）', () => {
  const prevTrace = process.env.LINGUA_PDF_TRACE;
  const warned: unknown[][] = [];
  const prevWarn = console.warn;
  afterEach(() => {
    if (prevTrace === undefined) delete process.env.LINGUA_PDF_TRACE;
    else process.env.LINGUA_PDF_TRACE = prevTrace;
    console.warn = prevWarn;
    warned.length = 0;
  });

  it('开启后 input_read_* 落日志且只含白名单键；关闭零日志', async () => {
    console.warn = (...args: unknown[]) => {
      warned.push(args);
    };
    const calls = newCalls();
    const events: TocDiscoveryStreamEvent[] = [];
    await discoverTocPagesStreamFromFile(
      { loadInspector: loadStub({ 3: JA_TOC }, calls), readLocalFile: chunkedReader(300 * 1024, 100 * 1024) },
      { userId: 'u1', filePath: '/tmp/t.pdf' },
      { emit: (e) => events.push(e) }
    );
    expect(warned.length).toBe(0);

    process.env.LINGUA_PDF_TRACE = '1';
    const calls2 = newCalls();
    await discoverTocPagesStreamFromFile(
      { loadInspector: loadStub({ 3: JA_TOC }, calls2), readLocalFile: chunkedReader(300 * 1024, 100 * 1024) },
      { userId: 'u1', filePath: '/tmp/t.pdf' },
      { emit: () => {} }
    );
    const heads = warned.map((args) => String(args[1]));
    for (const stage of ['started', 'input_read_started', 'input_read_progress', 'input_read_ready', 'page_count_ready', 'completed']) {
      expect(heads).toContain(stage);
    }
    const allowed = new Set([
      'plannedPages', 'completedPages', 'batchFrom', 'batchTo', 'elapsedMs',
      'pageCount', 'candidates', 'needsOcr', 'downloaded', 'embeddedHit', 'batchMs',
      'code', 'readBytes', 'totalBytes',
    ]);
    for (const args of warned) {
      expect(String(args[0])).toBe('[toc-trace]');
      const fields = args[2] as Record<string, unknown>;
      for (const key of Object.keys(fields)) {
        expect(allowed.has(key)).toBe(true);
      }
    }
    const dumped = JSON.stringify(warned);
    for (const token of FORBIDDEN_TOKENS) {
      expect(dumped.includes(token)).toBe(false);
    }
  });
});
