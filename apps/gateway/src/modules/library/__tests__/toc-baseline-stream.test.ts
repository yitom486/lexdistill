import { describe, expect, it, afterEach } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promises as fsp } from 'node:fs';
import { isOk, ok } from '@study-studio/shared';
import type { PdfInspectorLike } from '../application/pdf-import/pdf-runtime.js';
import type { LocalPdfStreamedOutcome } from '../application/pdf-import/local-file.js';
import {
  extractTocBaselineStream,
  extractTocBaselineStreamFromFile,
  type TocBaselineFileReader,
  type TocBaselineStreamEvent,
} from '../application/pdf-import/toc-baseline-stream.js';
import { extractTocBaseline } from '../application/pdf-import/toc-baseline.js';
import { createPdfImportRoutes } from '../http/pdf-import-routes.js';

/**
 * CMD-LINGUA-P3.3 基线流式编排单测（全内存 stub/synthetic，无私人教材）。
 * 自撰目录形文本仅本文件内存常量；真临时文件（os.tmpdir，用后即删）仅验读取层。
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
  return new TextEncoder().encode('%PDF-1.4 mock-toc-baseline-stream');
}

interface StubCalls {
  loadInspector: number;
  classify: Array<readonly number[] | undefined>;
  ocr: Array<number[] | undefined>;
}

function newCalls(): StubCalls {
  return { loadInspector: 0, classify: [], ocr: [] };
}

function loadStub(
  pageMd: Record<number, string>,
  calls: StubCalls,
  options: { pageCount?: number; outline?: unknown; ocrImpl?: (window: number[]) => Promise<{ pages: Array<{ pageNumber: number; markdown: string }>; routed: number[] }>; onOcrCall?: (window: number[]) => void } = {}
) {
  const pageCount = options.pageCount ?? 371;
  return async (): Promise<PdfInspectorLike> => {
    calls.loadInspector++;
    return {
      processPdf: (_pdf, pages) => {
        calls.classify.push(pages);
        return { pdfType: 'TextBased', pageCount, markdown: '', pagesNeedingOcr: [] };
      },
      processPdfWithOcr: async (_pdf, opts) => {
        const window = Array.isArray(opts?.pageNumbers) ? opts.pageNumbers : [];
        calls.ocr.push(window);
        options.onOcrCall?.(window);
        if (options.ocrImpl) {
          const out = await options.ocrImpl(window);
          return { markdown: '', pages: out.pages, pagesRoutedToOcr: out.routed };
        }
        return {
          markdown: '',
          pages: window.map((n) => ({ pageNumber: n, markdown: pageMd[n] ?? BODY_TEXT })),
          pagesRoutedToOcr: [],
        };
      },
      ...(options.outline === undefined
        ? {}
        : {
            extractEmbeddedOutline: () =>
              options.outline as import('../application/pdf-import/pdf-runtime.js').EmbeddedOutlineResult,
          }),
    };
  };
}

function types(events: TocBaselineStreamEvent[]): string[] {
  return events.map((e) => e.type);
}

async function collectBytes(
  pageMd: Record<number, string>,
  calls: StubCalls,
  range: { fromPage: number; toPage: number },
  options?: Parameters<typeof loadStub>[2],
  signal?: AbortSignal
): Promise<TocBaselineStreamEvent[]> {
  const events: TocBaselineStreamEvent[] = [];
  await extractTocBaselineStream(
    { loadInspector: loadStub(pageMd, calls, options) },
    { userId: 'u1', filename: 't.pdf', bytes: mockBytes(), ...range },
    { emit: (e) => events.push(e), ...(signal ? { signal } : {}) }
  );
  return events;
}

/** 可门控 fake reader：resolve 前读取永远 pending。 */
function deferredReader() {
  let resolveRead: (v: LocalPdfStreamedOutcome) => void = () => {};
  const gate = new Promise<LocalPdfStreamedOutcome>((r) => {
    resolveRead = r;
  });
  const reader: TocBaselineFileReader = () => gate;
  return { reader, resolveRead };
}

/** 分块 fake reader：每块 honour signal。 */
function chunkedReader(totalBytes: number, chunkBytes: number, onChunk?: (read: number) => void): TocBaselineFileReader {
  return async (_path, hooks) => {
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
    return { cancelled: false, result: ok({ bytes: mockBytes(), filename: 'f.pdf' }) };
  };
}

const tempFiles: string[] = [];
afterEach(async () => {
  for (const f of tempFiles.splice(0)) {
    try {
      await fsp.unlink(f);
    } catch {
      // 已删
    }
  }
});

const FORBIDDEN_EVENT_TOKENS = [
  'filePath',
  'filename',
  'userId',
  'markdown',
  '"embeddedOutline"',
  '"outlineSource"',
  '"outline"',
  'folio',
  'model',
  'bytes',
  '.pdf',
];

// trace 更严：连标题正文/条目也不许出现（只留阶段与计数）。
const FORBIDDEN_TRACE_TOKENS = [
  ...FORBIDDEN_EVENT_TOKENS,
  'title',
  'entries',
  '目次',
  '第1課',
  '本文',
];

describe('P3.3 分批与事件（16–21 六页窗）', () => {
  it('6 页拆 5+1 真实批次，累计 5/6，事件顺序正确', async () => {
    const calls = newCalls();
    const events = await collectBytes({ 16: JA_TOC }, calls, { fromPage: 16, toPage: 21 });
    expect(types(events)).toEqual([
      'started',
      'page_count_ready',
      'embedded_outline_checked',
      'runtime_check',
      'runtime_ready',
      'ocr_batch_completed',
      'ocr_batch_completed',
      'parsing',
      'completed',
    ]);
    const batches = events.filter((e) => e.type === 'ocr_batch_completed');
    expect(batches.map((e) => (e.type === 'ocr_batch_completed' ? [e.batchFrom, e.batchTo, e.completedPages] : []))).toEqual([
      [16, 20, 5],
      [21, 21, 6],
    ]);
    expect(calls.ocr).toEqual([
      [16, 17, 18, 19, 20],
      [21],
    ]);
    const done = events[events.length - 1];
    if (done?.type !== 'completed') throw new Error('unexpected');
    expect(done.plannedPages).toBe(6);
    expect(done.completedPages).toBe(6);
    expect(done.result.status).toBe('ok');
    // JA_TOC 单页产 4 条（第1–3課 + 復習A）→ usable
    expect(done.result.verdict).toBe('usable');
    expect(done.result.entries.length).toBe(4);
    expect(done.result.range).toEqual({ fromPage: 16, toPage: 21 });
  });

  it('与旧 JSON 编排同输入同输出（usable/thin/empty 全保持）', async () => {
    const cases: Array<Record<number, string>> = [{ 16: JA_TOC }, { 16: JA_TOC, 17: JA_TOC }, {}];
    for (const pageMd of cases) {
      const callsA = newCalls();
      const callsB = newCalls();
      const old = await extractTocBaseline(
        { loadInspector: loadStub(pageMd, callsA) },
        { userId: 'u1', filename: 't.pdf', bytes: mockBytes(), fromPage: 16, toPage: 21 }
      );
      const events = await collectBytes(pageMd, callsB, { fromPage: 16, toPage: 21 });
      const done = events.find((e) => e.type === 'completed');
      expect(isOk(old)).toBe(true);
      if (!isOk(old) || done?.type !== 'completed') throw new Error('unexpected');
      expect(done.result).toEqual(old.value);
    }
  });

  it('范围非法直接 failed（超 30/倒序），零准备零 OCR', async () => {
    const calls = newCalls();
    const over = await collectBytes({}, calls, { fromPage: 1, toPage: 31 });
    expect(types(over)).toEqual(['failed']);
    expect(calls.loadInspector).toBe(0);
    const inverted = await collectBytes({}, calls, { fromPage: 5, toPage: 3 });
    expect(types(inverted)).toEqual(['failed']);
  });

  it('embedded usable 短路：零 OCR，有 parsing 前直接 completed', async () => {
    const calls = newCalls();
    const events = await collectBytes({}, calls, { fromPage: 2, toPage: 3 }, {
      outline: { items: [{ title: '第1課', level: 1, physicalPage: 5 }, { title: '第2課', level: 1, physicalPage: 9 }], unresolvedCount: 0, truncated: false },
    });
    expect(types(events)).toEqual(['started', 'page_count_ready', 'embedded_outline_checked', 'parsing', 'completed']);
    // 注意：embedded 短路无 OCR、无批次（parsing 标记短路点，与 discover 流的 scoring 同位）
    expect(types(events)).not.toContain('ocr_batch_completed');
    expect(calls.ocr).toEqual([]);
    const done = events[events.length - 1];
    if (done?.type !== 'completed') throw new Error('unexpected');
    expect(done.result.embedded).toBe(true);
    expect(done.result.pageEvidence).toEqual([]);
  });

  it('运行时只准备一次（桩注入只 load 一次，批循环零准备）', async () => {
    const calls = newCalls();
    await collectBytes({ 16: JA_TOC }, calls, { fromPage: 16, toPage: 21 });
    expect(calls.loadInspector).toBe(1);
  });
});

describe('P3.3 文件读取（门控 reader）', () => {
  it('started/input_read_started 先于文件内容到达；零运行时准备', async () => {
    const calls = newCalls();
    const gate = deferredReader();
    const events: TocBaselineStreamEvent[] = [];
    const outcomeP = extractTocBaselineStreamFromFile(
      { loadInspector: loadStub({ 16: JA_TOC }, calls), readLocalFile: gate.reader },
      { userId: 'u1', filePath: '/tmp/slow.pdf', fromPage: 16, toPage: 21 },
      { emit: (e) => events.push(e) }
    );
    await Bun.sleep(10);
    expect(types(events)).toEqual(['started', 'input_read_started']);
    expect(calls.loadInspector).toBe(0);
    gate.resolveRead({ cancelled: false, result: ok({ bytes: mockBytes(), filename: 'slow.pdf' }) });
    const outcome = await outcomeP;
    expect(outcome.cancelled).toBe(false);
    if (outcome.cancelled) return;
    expect(isOk(outcome.result)).toBe(true);
    expect(types(events)[types(events).length - 1]).toBe('completed');
  });

  it('读取中 abort：只有 cancelled，不碰运行时/OCR/解析', async () => {
    const calls = newCalls();
    const ctrl = new AbortController();
    const events: TocBaselineStreamEvent[] = [];
    const outcome = await extractTocBaselineStreamFromFile(
      {
        loadInspector: loadStub({ 16: JA_TOC }, calls),
        readLocalFile: chunkedReader(10 * 1024 * 1024, 100 * 1024, (read) => {
          if (read >= 200 * 1024) ctrl.abort();
        }),
      },
      { userId: 'u1', filePath: '/tmp/big.pdf', fromPage: 16, toPage: 21 },
      { emit: (e) => events.push(e), signal: ctrl.signal }
    );
    expect(outcome.cancelled).toBe(true);
    expect(types(events)).toEqual(['started', 'input_read_started', 'cancelled']);
    expect(calls.loadInspector).toBe(0);
    expect(calls.ocr).toEqual([]);
  });

  it('分块进度 4MB 采样、总量一致，读完走满批次', async () => {
    const calls = newCalls();
    const events: TocBaselineStreamEvent[] = [];
    const outcome = await extractTocBaselineStreamFromFile(
      { loadInspector: loadStub({ 16: JA_TOC }, calls), readLocalFile: chunkedReader(20 * 1024 * 1024, 1024 * 1024) },
      { userId: 'u1', filePath: '/tmp/c.pdf', fromPage: 16, toPage: 21 },
      { emit: (e) => events.push(e) }
    );
    expect(outcome.cancelled).toBe(false);
    const progresses = events.filter((e) => e.type === 'input_read_progress');
    expect(progresses.map((e) => (e.type === 'input_read_progress' ? e.readBytes : -1))).toEqual(
      [4, 8, 12, 16, 20].map((mb) => mb * 1024 * 1024)
    );
    const ready = events.find((e) => e.type === 'input_read_ready');
    if (ready?.type !== 'input_read_ready') throw new Error('missing ready');
    expect(ready.totalBytes).toBe(20 * 1024 * 1024);
    expect(calls.ocr.length).toBe(2);
    expect(types(events)[types(events).length - 1]).toBe('completed');
  });
});

describe('P3.3 取消与失败', () => {
  it('批次之间 abort：已完成批保留计数，不解析、不 completed', async () => {
    const calls = newCalls();
    const ctrl = new AbortController();
    let seen = 0;
    const events = await collectBytes(
      { 16: JA_TOC },
      calls,
      { fromPage: 16, toPage: 21 },
      {
        onOcrCall: () => {
          seen++;
          if (seen === 1) ctrl.abort();
        },
      },
      ctrl.signal
    );
    expect(calls.ocr.length).toBe(1);
    expect(types(events)).toEqual([
      'started',
      'page_count_ready',
      'embedded_outline_checked',
      'runtime_check',
      'runtime_ready',
      'ocr_batch_completed',
      'cancelled',
    ]);
    const cancelled = events[events.length - 1];
    if (cancelled?.type !== 'cancelled') throw new Error('unexpected');
    expect(cancelled.completedPages).toBe(5);
  });

  it('末批内 abort：不解析、不 completed', async () => {
    const calls = newCalls();
    const ctrl = new AbortController();
    let seen = 0;
    const events = await collectBytes(
      { 16: JA_TOC },
      calls,
      { fromPage: 16, toPage: 21 },
      {
        onOcrCall: () => {
          seen++;
          if (seen === 2) ctrl.abort();
        },
      },
      ctrl.signal
    );
    expect(calls.ocr.length).toBe(2);
    expect(types(events)).not.toContain('parsing');
    expect(types(events)).not.toContain('completed');
    expect(types(events)[types(events).length - 1]).toBe('cancelled');
  });

  it('OCR 抛错 → failed（code+userMessage），无 completed/parsing', async () => {
    const calls = newCalls();
    const events = await collectBytes({ 16: JA_TOC }, calls, { fromPage: 16, toPage: 21 }, {
      ocrImpl: async () => {
        throw new Error('boom-native');
      },
    });
    const last = events[events.length - 1];
    if (last?.type !== 'failed') throw new Error(`unexpected: ${last?.type}`);
    expect(last.code).toBe('E_PDF_PARSE');
    expect(types(events)).not.toContain('completed');
    expect(types(events)).not.toContain('parsing');
  });

  it('事件信封不含路径/标识（completed.result 含基线是产品本身，非泄漏）', async () => {
    for (const pageMd of [{ 16: JA_TOC }, {}]) {
      const calls = newCalls();
      const events = await collectBytes(pageMd, calls, { fromPage: 16, toPage: 21 });
      const dumped = JSON.stringify(events);
      for (const token of FORBIDDEN_EVENT_TOKENS) {
        expect(dumped.includes(token)).toBe(false);
      }
    }
  });
});

describe('P3.3 trace 白名单', () => {
  const prevTrace = process.env.LINGUA_PDF_TRACE;
  const warned: unknown[][] = [];
  const prevWarn = console.warn;
  afterEach(() => {
    if (prevTrace === undefined) delete process.env.LINGUA_PDF_TRACE;
    else process.env.LINGUA_PDF_TRACE = prevTrace;
    console.warn = prevWarn;
    warned.length = 0;
  });

  it('关闭零日志；开启后阶段齐、只含白名单字段', async () => {
    const calls = newCalls();
    console.warn = (...args: unknown[]) => {
      warned.push(args);
    };
    await collectBytes({ 16: JA_TOC }, calls, { fromPage: 16, toPage: 21 });
    expect(warned.length).toBe(0);

    process.env.LINGUA_PDF_TRACE = '1';
    const calls2 = newCalls();
    const events = await collectBytes({ 16: JA_TOC }, calls2, { fromPage: 16, toPage: 21 });
    const heads = warned.map((args) => String(args[1]));
    for (const stage of ['started', 'page_count_ready', 'embedded_outline_checked', 'runtime_check', 'runtime_ready', 'ocr_batch_completed', 'parsing', 'completed']) {
      expect(heads).toContain(stage);
    }
    const allowed = new Set([
      'plannedPages', 'completedPages', 'batchFrom', 'batchTo', 'elapsedMs',
      'pageCount', 'candidates', 'needsOcr', 'downloaded', 'quality', 'reason',
      'validEntries', 'semanticEntries', 'batchMs', 'code', 'readBytes', 'totalBytes',
    ]);
    for (const args of warned) {
      expect(String(args[0])).toBe('[toc-trace]');
      const fields = args[2] as Record<string, unknown>;
      for (const key of Object.keys(fields)) {
        expect(allowed.has(key)).toBe(true);
      }
    }
    const dumped = JSON.stringify(warned);
    for (const token of FORBIDDEN_TRACE_TOKENS) {
      expect(dumped.includes(token)).toBe(false);
    }
    expect(types(events)[types(events).length - 1]).toBe('completed');
  });
});

describe('P3.3 路由：extract-toc-stream + 旧 JSON 兼容', () => {
  function mount(pageMd: Record<number, string>, calls: StubCalls, options?: Parameters<typeof loadStub>[2]) {
    return createPdfImportRoutes(
      { repo: {} as never, server: {} as never, port: 0 },
      { loadInspector: loadStub(pageMd, calls, options) }
    );
  }

  async function readEvents(res: Response): Promise<TocBaselineStreamEvent[]> {
    const text = await res.text();
    return text
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as TocBaselineStreamEvent);
  }

  it('JSON filePath 门控 reader：读取完成前即收到 started/input_read_started', async () => {
    const calls = newCalls();
    const gate = deferredReader();
    const app = createPdfImportRoutes(
      { repo: {} as never, server: {} as never, port: 0 },
      { loadInspector: loadStub({ 16: JA_TOC }, calls), readLocalFile: gate.reader }
    );
    const res = await app.request('/api/documents/u1/extract-toc-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: '/tmp/deferred.pdf', startPage: 16, endPage: 21 }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    // 先读两行（gate 仍阻塞）
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const lines: TocBaselineStreamEvent[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf('\n');
      while (idx >= 0 && lines.length < 2) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) lines.push(JSON.parse(line) as TocBaselineStreamEvent);
        idx = buffer.indexOf('\n');
      }
      if (lines.length >= 2 || done) break;
    }
    expect(types(lines)).toEqual(['started', 'input_read_started']);
    expect(calls.loadInspector).toBe(0);
    gate.resolveRead({ cancelled: false, result: ok({ bytes: mockBytes(), filename: 'deferred.pdf' }) });
    let tail = buffer;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) tail += decoder.decode(value, { stream: true });
    }
    const tailTypes = tail
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => (JSON.parse(l) as TocBaselineStreamEvent).type);
    expect(tailTypes[tailTypes.length - 1]).toBe('completed');
  });

  it('multipart：无 input_read 事件（不伪造），尾部 completed 与旧 JSON 一致', async () => {
    const calls = newCalls();
    const app = mount({ 16: JA_TOC, 17: JA_TOC }, calls);
    const bytes = mockBytes();
    const form = new FormData();
    form.append('file', new File([bytes as unknown as BlobPart], 't.pdf', { type: 'application/pdf' }));
    form.append('startPage', '16');
    form.append('endPage', '21');
    const res = await app.request('/api/documents/u1/extract-toc-stream', { method: 'POST', body: form });
    expect(res.status).toBe(200);
    const events = await readEvents(res);
    expect(types(events)).not.toContain('input_read_started');
    const done = events[events.length - 1];
    if (done?.type !== 'completed') throw new Error(`unexpected tail: ${done?.type}`);
    expect(done.result.verdict).toBe('usable');

    const calls2 = newCalls();
    const app2 = mount({ 16: JA_TOC, 17: JA_TOC }, calls2);
    const form2 = new FormData();
    form2.append('file', new File([bytes as unknown as BlobPart], 't.pdf', { type: 'application/pdf' }));
    form2.append('startPage', '16');
    form2.append('endPage', '21');
    const old = await app2.request('/api/documents/u1/extract-toc', { method: 'POST', body: form2 });
    expect(old.status).toBe(200);
    const oldJson = (await old.json()) as typeof done.result;
    expect(done.result).toEqual(oldJson);
  });

  it('缺范围 400；旧 JSON 端点形状回归（verdict/evidence 在场）', async () => {
    const calls = newCalls();
    const app = mount({ 2: JA_TOC, 3: JA_TOC }, calls);
    const missing = await app.request('/api/documents/u1/extract-toc-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: '/tmp/x.pdf' }),
    });
    expect(missing.status).toBe(400);
    expect(calls.loadInspector).toBe(0);

    const form = new FormData();
    form.append('file', new File([mockBytes() as unknown as BlobPart], 't.pdf', { type: 'application/pdf' }));
    form.append('startPage', '2');
    form.append('endPage', '3');
    const old = await app.request('/api/documents/u1/extract-toc', { method: 'POST', body: form });
    expect(old.status).toBe(200);
    const json = (await old.json()) as { verdict: string; pageEvidence: unknown[]; embedded: boolean };
    expect(json.verdict).toBe('usable');
    expect(Array.isArray(json.pageEvidence)).toBe(true);
    expect(json.embedded).toBe(false);
  });
});
