import { describe, expect, it, afterEach } from 'bun:test';
import { isOk } from '@study-studio/shared';
import type { PdfInspectorLike } from '../application/pdf-import/pdf-runtime.js';
import {
  TOC_DISCOVERY_BATCH_PAGES,
  discoverTocPagesStream,
  isTocTraceEnabled,
  type TocDiscoveryStreamEvent,
} from '../application/pdf-import/toc-discovery-stream.js';
import { TOC_DISCOVERY_MAX_PAGES as P2_MAX, type TocDiscoveryOutput } from '../application/pdf-import/toc-discovery.js';
import { discoverTocPages } from '../application/pdf-import/toc-discovery.js';
import { MAX_OCR_PAGES_PER_IMPORT } from '../application/pdf-import/pdf-import-service.js';
import { createPdfImportRoutes } from '../http/pdf-import-routes.js';

/**
 * CMD-LINGUA-P2.1 目录探测流式编排单测（全内存 stub/synthetic，无私人教材）。
 * 自撰目录形文本仅出现在本文件内存常量中，不含任何课文正文。
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
  return new TextEncoder().encode('%PDF-1.4 mock-toc-stream');
}

interface StubCalls {
  loadInspector: number;
  classify: Array<readonly number[] | undefined>;
  ocr: Array<number[] | undefined>;
}

function newCalls(): StubCalls {
  return { loadInspector: 0, classify: [], ocr: [] };
}

function streamStub(
  pageMd: Record<number, string>,
  calls: StubCalls,
  options: {
    pageCount?: number;
    outline?: { items: Array<{ title: string; level: number; physicalPage: number }>; unresolvedCount: number; truncated: boolean } | null;
    ocrImpl?: (window: number[]) => Promise<{ pages: Array<{ pageNumber: number; markdown: string }>; pagesRoutedToOcr: number[] }>;
    onOcrCall?: (window: number[]) => void;
  } = {}
): PdfInspectorLike {
  const pageCount = options.pageCount ?? 371;
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
        return { markdown: '', pages: out.pages, pagesRoutedToOcr: out.pagesRoutedToOcr };
      }
      return {
        markdown: '',
        pages: window.map((n) => ({ pageNumber: n, markdown: pageMd[n] ?? BODY_TEXT })),
        pagesRoutedToOcr: [],
      };
    },
    ...(options.outline
      ? {
          extractEmbeddedOutline: () =>
            options.outline as {
              items: [];
              unresolvedCount: number;
              truncated: boolean;
            },
        }
      : {}),
  };
}

function loadStub(pageMd: Record<number, string>, calls: StubCalls, options?: Parameters<typeof streamStub>[2]) {
  return async (): Promise<PdfInspectorLike> => {
    calls.loadInspector++;
    return streamStub(pageMd, calls, options);
  };
}

async function collect(
  pageMd: Record<number, string>,
  calls: StubCalls,
  options?: Parameters<typeof streamStub>[2],
  signal?: AbortSignal
): Promise<TocDiscoveryStreamEvent[]> {
  const events: TocDiscoveryStreamEvent[] = [];
  await discoverTocPagesStream(
    { loadInspector: loadStub(pageMd, calls, options) },
    { userId: 'u1', filename: 't.pdf', bytes: mockBytes() },
    { emit: (e) => events.push(e), ...(signal ? { signal } : {}) }
  );
  return events;
}

function types(events: TocDiscoveryStreamEvent[]): string[] {
  return events.map((e) => e.type);
}

const FORBIDDEN_TOKENS = [
  'filePath',
  'filename',
  'userId',
  'markdown',
  // 原生目录内容键（事件名 embedded_outline_checked 本身是白名单，只禁内容键）
  '"embeddedOutline"',
  '"outlineSource"',
  '"outline"',
  'title',
  'folio',
  'entries',
  'model',
  'bytes',
  '.pdf',
  '目次',
  '第1課',
  '本文',
];

describe('P2.1 常量与开关', () => {
  it('批次 5 页恒 ≤ 探测窗 30 且 ≤ OCR 总上限 30', () => {
    expect(TOC_DISCOVERY_BATCH_PAGES).toBe(5);
    expect(TOC_DISCOVERY_BATCH_PAGES).toBeLessThanOrEqual(P2_MAX);
    expect(P2_MAX).toBeLessThanOrEqual(MAX_OCR_PAGES_PER_IMPORT);
    expect(P2_MAX).toBeLessThanOrEqual(30);
  });

  it('trace 默认关闭，显式 opt-in 才开', () => {
    expect(isTocTraceEnabled()).toBe(false);
  });
});

describe('P2.1 分批与事件（30 页全窗）', () => {
  it('30 页严格拆 6 个真实 5 页批次，累计 5/10/…/30', async () => {
    const calls = newCalls();
    const events = await collect({ 3: JA_TOC }, calls);
    const batches = events.filter((e) => e.type === 'ocr_batch_completed');
    expect(batches.length).toBe(6);
    expect(batches.map((e) => (e.type === 'ocr_batch_completed' ? e.completedPages : -1))).toEqual([5, 10, 15, 20, 25, 30]);
    for (const e of batches) {
      if (e.type !== 'ocr_batch_completed') continue;
      expect(e.plannedPages).toBe(30);
      expect(e.batchTo - e.batchFrom + 1).toBe(5);
    }
    // 每次 OCR 均带非空页窗，且恰为该批
    expect(calls.ocr.length).toBe(6);
    expect(calls.ocr[0]).toEqual([1, 2, 3, 4, 5]);
    expect(calls.ocr[5]).toEqual([26, 27, 28, 29, 30]);
    const union = calls.ocr.flatMap((w) => w ?? []).sort((a, b) => a - b);
    expect(union).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it('每次 processPdf 均带非空页窗（探针[1]+分类全窗）', async () => {
    const calls = newCalls();
    await collect({ 3: JA_TOC }, calls);
    expect(calls.classify.length).toBeGreaterThan(0);
    for (const w of calls.classify) {
      expect(Array.isArray(w)).toBe(true);
      expect((w as number[]).length).toBeGreaterThan(0);
      expect((w as number[]).length).toBeLessThanOrEqual(30);
    }
  });

  it('运行时只准备一次（桩注入只 load 一次，批循环零准备）', async () => {
    const calls = newCalls();
    await collect({ 3: JA_TOC }, calls);
    expect(calls.loadInspector).toBe(1);
  });

  it('事件顺序正确：started→page_count→embedded→runtime→6批→scoring→completed', async () => {
    const calls = newCalls();
    const events = await collect({ 3: JA_TOC }, calls);
    expect(types(events)).toEqual([
      'started',
      'page_count_ready',
      'embedded_outline_checked',
      'runtime_check',
      'runtime_ready',
      'ocr_batch_completed',
      'ocr_batch_completed',
      'ocr_batch_completed',
      'ocr_batch_completed',
      'ocr_batch_completed',
      'ocr_batch_completed',
      'scoring',
      'completed',
    ]);
    const done = events[events.length - 1];
    if (done?.type !== 'completed') throw new Error('expected completed');
    expect(done.plannedPages).toBe(30);
    expect(done.completedPages).toBe(30);
    expect(done.result.status).toBe('found');
    expect(done.result.candidates).toEqual([{ fromPage: 3, toPage: 3, score: 28 }]);
    expect(done.result.pageCount).toBe(371);
    expect(done.result.pagesScanned).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(done.result.embedded).toBe(false);
    expect(typeof done.elapsedMs).toBe('number');
  });

  it('与旧 JSON 编排同输入同输出（found/ambiguous/not-found 全保持）', async () => {
    for (const pageMd of [{ 3: JA_TOC }, { 3: JA_TOC, 20: JA_TOC }, {}]) {
      const callsA = newCalls();
      const callsB = newCalls();
      const old = await discoverTocPages(
        { loadInspector: loadStub(pageMd, callsA) },
        { userId: 'u1', filename: 't.pdf', bytes: mockBytes() }
      );
      const events = await collect(pageMd, callsB);
      const done = events.find((e) => e.type === 'completed');
      expect(isOk(old)).toBe(true);
      if (!isOk(old) || done?.type !== 'completed') throw new Error('unexpected');
      expect(done.result).toEqual(old.value);
    }
  });

  it('目录在窗尾（29 页）仍命中：不提前停扫', async () => {
    const calls = newCalls();
    const events = await collect({ 29: JA_TOC }, calls);
    const done = events.find((e) => e.type === 'completed');
    if (done?.type !== 'completed') throw new Error('unexpected');
    expect(done.result.status).toBe('found');
    expect(done.result.candidates).toEqual([{ fromPage: 29, toPage: 29, score: 28 }]);
    expect(calls.ocr.length).toBe(6);
  });

  it('小书（12 页）：批次 5/5/2，累计真实', async () => {
    const calls = newCalls();
    const events = await collect({ 3: JA_TOC }, calls, { pageCount: 12 });
    const batches = events.filter((e) => e.type === 'ocr_batch_completed');
    expect(batches.length).toBe(3);
    expect(batches.map((e) => (e.type === 'ocr_batch_completed' ? [e.batchFrom, e.batchTo, e.completedPages] : []))).toEqual([
      [1, 5, 5],
      [6, 10, 10],
      [11, 12, 12],
    ]);
    const done = events.find((e) => e.type === 'completed');
    if (done?.type !== 'completed') throw new Error('unexpected');
    expect(done.plannedPages).toBe(12);
    expect(done.completedPages).toBe(12);
  });
});

describe('P2.1 embedded 短路', () => {
  it('命中零 OCR：无批次事件，completed embedded=true', async () => {
    const calls = newCalls();
    const events = await collect({ 3: JA_TOC }, calls, {
      outline: {
        items: [
          { title: '第1課', level: 1, physicalPage: 5 },
          { title: '第2課', level: 1, physicalPage: 9 },
        ],
        unresolvedCount: 0,
        truncated: false,
      },
    });
    expect(types(events)).toEqual([
      'started',
      'page_count_ready',
      'embedded_outline_checked',
      'scoring',
      'completed',
    ]);
    expect(calls.ocr).toEqual([]);
    const done = events[events.length - 1];
    if (done?.type !== 'completed') throw new Error('unexpected');
    expect(done.result.embedded).toBe(true);
    expect(done.result.candidates).toEqual([]);
    expect(done.result.outlineQuality).toBe('usable');
    expect(calls.loadInspector).toBe(1);
  });

  it('P2.2 纯数字书签 unusable：回退 OCR，前窗照扫 6 批', async () => {
    const calls = newCalls();
    const numeric = {
      items: Array.from({ length: 30 }, (_, i) => ({ title: String(i + 1), level: 1, physicalPage: i + 1 })),
      unresolvedCount: 0,
      truncated: false,
    };
    const events = await collect({ 3: JA_TOC }, calls, { outline: numeric });
    const done = events.find((e) => e.type === 'completed');
    if (done?.type !== 'completed') throw new Error('unexpected');
    expect(done.result.outlineQuality).toBe('unusable');
    expect(done.result.embedded).toBe(false);
    expect(done.result.status).toBe('found');
    expect(done.result.candidates).toEqual([{ fromPage: 3, toPage: 3, score: 28 }]);
    expect(calls.ocr.length).toBe(6);
  });
});

describe('P2.1 取消语义', () => {
  it('启动前已 abort：零准备零 OCR，只发 cancelled 不发 completed', async () => {
    const calls = newCalls();
    const ctrl = new AbortController();
    ctrl.abort();
    const events: TocDiscoveryStreamEvent[] = [];
    const outcome = await discoverTocPagesStream(
      { loadInspector: loadStub({ 3: JA_TOC }, calls) },
      { userId: 'u1', filename: 't.pdf', bytes: mockBytes() },
      { emit: (e) => events.push(e), signal: ctrl.signal }
    );
    expect(outcome.cancelled).toBe(true);
    expect(calls.loadInspector).toBe(0);
    expect(calls.ocr).toEqual([]);
    expect(types(events)).toEqual(['cancelled']);
  });

  it('启动前 abort 的事件序列只有 cancelled', async () => {
    const calls = newCalls();
    const ctrl = new AbortController();
    ctrl.abort();
    const events = await collect({ 3: JA_TOC }, calls, undefined, ctrl.signal);
    expect(types(events)).toEqual(['cancelled']);
    const cancelled = events[0];
    if (cancelled?.type !== 'cancelled') throw new Error('unexpected');
    expect(cancelled.plannedPages).toBe(0);
    expect(cancelled.completedPages).toBe(0);
  });

  it('两批后 abort：恰跑 2 批，后续 25 页一页都不跑，无 completed', async () => {
    const calls = newCalls();
    const ctrl = new AbortController();
    let seen = 0;
    const events = await collect(
      { 3: JA_TOC },
      calls,
      {
        onOcrCall: () => {
          seen++;
          if (seen === 2) ctrl.abort();
        },
      },
      ctrl.signal
    );
    expect(calls.ocr.length).toBe(2);
    expect(types(events)).toEqual([
      'started',
      'page_count_ready',
      'embedded_outline_checked',
      'runtime_check',
      'runtime_ready',
      'ocr_batch_completed',
      'ocr_batch_completed',
      'cancelled',
    ]);
    const cancelled = events[events.length - 1];
    if (cancelled?.type !== 'cancelled') throw new Error('unexpected');
    expect(cancelled.completedPages).toBe(10);
    expect(cancelled.plannedPages).toBe(30);
  });

  it('末批内 abort：本批计入但不评分、不发 completed', async () => {
    const calls = newCalls();
    const ctrl = new AbortController();
    let seen = 0;
    const events = await collect(
      { 3: JA_TOC },
      calls,
      {
        onOcrCall: () => {
          seen++;
          if (seen === 6) ctrl.abort();
        },
      },
      ctrl.signal
    );
    expect(calls.ocr.length).toBe(6);
    expect(types(events)).not.toContain('scoring');
    expect(types(events)).not.toContain('completed');
    expect(types(events)[types(events).length - 1]).toBe('cancelled');
  });
});

describe('P2.1 失败与白名单', () => {
  it('OCR 抛错 → failed（code+userMessage），无 completed', async () => {
    const calls = newCalls();
    const events = await collect({ 3: JA_TOC }, calls, {
      ocrImpl: async () => {
        throw new Error('boom-native');
      },
    });
    const last = events[events.length - 1];
    if (last?.type !== 'failed') throw new Error(`unexpected: ${last?.type}`);
    expect(last.code).toBe('E_PDF_PARSE');
    expect(typeof last.userMessage).toBe('string');
    expect(last.userMessage.length).toBeGreaterThan(0);
    expect(types(events)).not.toContain('completed');
    expect(types(events)).not.toContain('cancelled');
  });

  it('事件与完成负载不含敏感字段（路径/正文/标题/userId/模型输出）', async () => {
    for (const pageMd of [{ 3: JA_TOC }, {}]) {
      const calls = newCalls();
      const events = await collect(pageMd, calls);
      const dumped = JSON.stringify(events);
      for (const token of FORBIDDEN_TOKENS) {
        expect(dumped.includes(token)).toBe(false);
      }
    }
  });
});

describe('P2.1 trace 日志白名单', () => {
  const prevTrace = process.env.LINGUA_PDF_TRACE;
  const warned: unknown[][] = [];
  const prevWarn = console.warn;
  afterEach(() => {
    if (prevTrace === undefined) delete process.env.LINGUA_PDF_TRACE;
    else process.env.LINGUA_PDF_TRACE = prevTrace;
    console.warn = prevWarn;
    warned.length = 0;
  });

  it('关闭时零日志；开启后阶段齐、只含白名单字段', async () => {
    const calls = newCalls();
    console.warn = (...args: unknown[]) => {
      warned.push(args);
    };
    await collect({ 3: JA_TOC }, calls);
    expect(warned.length).toBe(0);

    process.env.LINGUA_PDF_TRACE = '1';
    const calls2 = newCalls();
    const events = await collect({ 3: JA_TOC }, calls2);
    expect(warned.length).toBeGreaterThan(0);
    const heads = warned.map((args) => String(args[1]));
    for (const stage of ['started', 'page_count_ready', 'embedded_outline_checked', 'runtime_check', 'runtime_ready', 'ocr_batch_completed', 'scoring', 'completed']) {
      expect(heads).toContain(stage);
    }
    expect(heads.filter((h) => h === 'ocr_batch_completed').length).toBe(6);
    // 首个 batch 日志含真实范围与累计
    const firstBatch = warned.find((args) => String(args[1]) === 'ocr_batch_completed');
    expect(firstBatch?.[2]).toMatchObject({ batchFrom: 1, batchTo: 5, completedPages: 5 });
    // 所有日志 payload 只允许白名单键
    const allowed = new Set(['plannedPages', 'completedPages', 'batchFrom', 'batchTo', 'elapsedMs', 'pageCount', 'candidates', 'needsOcr', 'downloaded', 'quality', 'reason', 'validEntries', 'semanticEntries', 'batchMs', 'code']);
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
    expect(types(events)[types(events).length - 1]).toBe('completed');
  });

  it('取消也落 trace（cancelled + 总耗时），失败落 code', async () => {
    console.warn = (...args: unknown[]) => {
      warned.push(args);
    };
    process.env.LINGUA_PDF_TRACE = '1';
    const calls = newCalls();
    const ctrl = new AbortController();
    ctrl.abort();
    await collect({ 3: JA_TOC }, calls, undefined, ctrl.signal);
    expect(warned.map((args) => String(args[1]))).toEqual(['cancelled']);

    warned.length = 0;
    const calls2 = newCalls();
    await collect({ 3: JA_TOC }, calls2, {
      ocrImpl: async () => {
        throw new Error('boom');
      },
    });
    const failed = warned.find((args) => String(args[1]) === 'failed');
    expect(failed?.[2]).toMatchObject({ code: 'E_PDF_PARSE' });
  });
});

describe('P2.1 路由：discover-toc-stream（stub runtime，直挂路由，无 DB）', () => {
  function mount(pageMd: Record<number, string>, calls: StubCalls) {
    return createPdfImportRoutes(
      { repo: {} as never, server: {} as never, port: 0 },
      { loadInspector: loadStub(pageMd, calls) }
    );
  }

  async function readEvents(res: Response): Promise<TocDiscoveryStreamEvent[]> {
    const text = await res.text();
    return text
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as TocDiscoveryStreamEvent);
  }

  it('multipart 小 PDF：NDJSON 流以 completed 收尾，结果与旧 JSON 端点一致', async () => {
    const calls = newCalls();
    const app = mount({ 3: JA_TOC }, calls);
    const bytes = mockBytes();
    const form = new FormData();
    form.append('file', new File([bytes as unknown as BlobPart], 't.pdf', { type: 'application/pdf' }));
    const res = await app.request('/api/documents/u1/discover-toc-stream', { method: 'POST', body: form });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    const events = await readEvents(res);
    const done = events[events.length - 1];
    if (done?.type !== 'completed') throw new Error(`unexpected tail: ${done?.type}`);
    expect(done.result.status).toBe('found');

    const calls2 = newCalls();
    const app2 = mount({ 3: JA_TOC }, calls2);
    const form2 = new FormData();
    form2.append('file', new File([bytes as unknown as BlobPart], 't.pdf', { type: 'application/pdf' }));
    const old = await app2.request('/api/documents/u1/discover-toc', { method: 'POST', body: form2 });
    expect(old.status).toBe(200);
    const oldJson = (await old.json()) as TocDiscoveryOutput;
    expect(done.result).toEqual(oldJson);
  });

  it('旧 JSON 端点回归：not-found 空候选形状不变', async () => {
    const calls = newCalls();
    const app = mount({}, calls);
    const form = new FormData();
    form.append('file', new File([mockBytes() as unknown as BlobPart], 't.pdf', { type: 'application/pdf' }));
    const res = await app.request('/api/documents/u1/discover-toc', { method: 'POST', body: form });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string; candidates: unknown[]; embedded: boolean };
    expect(json.status).toBe('not-found');
    expect(json.candidates).toEqual([]);
    expect(json.embedded).toBe(false);
  });
});
