import { BusinessError, err, isOk, ok, type Result } from '@study-studio/shared';
import { ensurePdfRuntime, type PdfInspectorLike } from './pdf-runtime.js';
import {
  readLocalPdfFileStreamed,
  type LocalPdfStreamedOutcome,
  type LocalPdfStreamedHooks,
} from './local-file.js';
import {
  TOC_BASELINE_MAX_PAGES,
  assembleTocBaseline,
  embeddedBaselineResult,
  fillPositionedSpans,
  washRepeatedTocLines,
  type TocBaselineOutput,
  type TocGeometrySpan,
  type TocWashedLine,
} from './toc-baseline.js';
import {
  probePdfPageCount,
  rangePages,
  validatePdfInput,
  type PdfImportInput,
  type PdfImportServiceDeps,
} from './pdf-import-service.js';
import { classifyEmbeddedOutline } from './embedded-outline-quality.js';
import {
  TOC_DISCOVERY_BATCH_PAGES,
  TOC_READ_TRACE_SAMPLE_BYTES,
  TOC_READ_UI_SAMPLE_BYTES,
  isTocTraceEnabled,
  tocTrace,
} from './toc-discovery-stream.js';

/**
 * CMD-LINGUA-P3.3：目录基线流式编排（只读，NDJSON 事件）。
 *
 * 旧 `extract-toc` 在整本读取 + OCR 完成前零响应；本模块把同一工作拆成
 * 可见阶段：分块文件读取（真实字节进度）→ 探页数 → embedded 检查 →
 * 单次运行时准备 → 固定小批次 OCR（每批完成后上报真实页数）→ 解析 →
 * completed（与旧函数逐字节一致的 `TocBaselineOutput`）。
 *
 * 只读铁律与 P2.1a/P2.2 相同：不写 DB/AST/缓存；OCR 原文不出本函数；
 * 事件与日志只含白名单字段（阶段、页数/字节数、批次范围、耗时、错误码），
 * 绝无路径/文件名/正文/标题/userId/模型输出/下载 URL。
 * multipart 输入字节已在手，无读取进度可言，不发 input_read 事件（不伪造）。
 *
 * 取消：批之间/解析前必查 signal；abort 后只发 cancelled，永不 completed，
 * 后续批次一个都不跑，解析也不执行。
 */

export type TocBaselineStreamEvent =
  | { type: 'started'; elapsedMs: number }
  | { type: 'input_read_started'; elapsedMs: number }
  | { type: 'input_read_progress'; readBytes: number; totalBytes: number | null; elapsedMs: number }
  | { type: 'input_read_ready'; readBytes: number; totalBytes: number | null; elapsedMs: number }
  | { type: 'page_count_ready'; plannedPages: number; elapsedMs: number }
  | { type: 'embedded_outline_checked'; elapsedMs: number }
  | { type: 'runtime_check'; elapsedMs: number }
  | { type: 'runtime_download_started'; elapsedMs: number }
  | { type: 'runtime_ready'; elapsedMs: number }
  | {
      type: 'ocr_batch_completed';
      plannedPages: number;
      completedPages: number;
      batchFrom: number;
      batchTo: number;
      elapsedMs: number;
    }
  | { type: 'parsing'; plannedPages: number; completedPages: number; elapsedMs: number }
  | {
      type: 'completed';
      plannedPages: number;
      completedPages: number;
      elapsedMs: number;
      result: TocBaselineOutput;
    }
  | { type: 'cancelled'; plannedPages: number; completedPages: number; elapsedMs: number }
  | { type: 'failed'; elapsedMs: number; code: string; userMessage: string };

export interface TocBaselineStreamSink {
  emit(event: TocBaselineStreamEvent): void;
  signal?: AbortSignal;
}

export type TocBaselineStreamOutcome =
  | { cancelled: false; result: Result<TocBaselineOutput, BusinessError> }
  | { cancelled: true };

export type TocBaselineStreamDeps = Pick<PdfImportServiceDeps, 'loadInspector' | 'runtimeDir'> & {
  fetchImpl?: typeof fetch;
};

/** P3.3：文件读取器注入点（默认真机分块读取；单测注入慢速/可门控 fake）。 */
export type TocBaselineFileReader = (
  filePath: string,
  hooks: LocalPdfStreamedHooks
) => Promise<LocalPdfStreamedOutcome>;

export type TocBaselineFileDeps = TocBaselineStreamDeps & {
  readLocalFile?: TocBaselineFileReader;
};

export interface TocBaselineStreamRange {
  userId: string;
  filename: string;
  bytes: Uint8Array;
  fromPage: number;
  toPage: number;
}

function aborted(signal: AbortSignal | undefined): boolean {
  try {
    return signal?.aborted === true;
  } catch {
    return false;
  }
}

interface BaselineRun {
  sink: TocBaselineStreamSink;
  startedAt: number;
  plannedPages: number;
  completedPages: number;
}

function elapsedMsOf(run: BaselineRun): number {
  return Date.now() - run.startedAt;
}

function failRun(run: BaselineRun, error: BusinessError): TocBaselineStreamOutcome {
  tocTrace('failed', { code: error.code, elapsedMs: elapsedMsOf(run) });
  run.sink.emit({ type: 'failed', elapsedMs: elapsedMsOf(run), code: error.code, userMessage: error.userMessage });
  return { cancelled: false, result: err(error) };
}

function cancelRun(run: BaselineRun): TocBaselineStreamOutcome {
  tocTrace('cancelled', { plannedPages: run.plannedPages, completedPages: run.completedPages, elapsedMs: elapsedMsOf(run) });
  run.sink.emit({ type: 'cancelled', plannedPages: run.plannedPages, completedPages: run.completedPages, elapsedMs: elapsedMsOf(run) });
  return { cancelled: true };
}

function invalidRange(fromPage: unknown, toPage: unknown): BusinessError | null {
  if (!Number.isInteger(fromPage) || !Number.isInteger(toPage)) {
    return new BusinessError('E_INVALID_INPUT', '请提供已确认的目录页范围（fromPage/toPage，非空且 fromPage ≤ toPage）', 'VALIDATION');
  }
  const from = fromPage as number;
  const to = toPage as number;
  if (from < 1 || to < from) {
    return new BusinessError('E_INVALID_INPUT', '请提供已确认的目录页范围（fromPage/toPage，非空且 fromPage ≤ toPage）', 'VALIDATION');
  }
  if (to - from + 1 > TOC_BASELINE_MAX_PAGES) {
    return new BusinessError(
      'E_INVALID_INPUT',
      `确认范围共 ${to - from + 1} 页（单次上限 ${TOC_BASELINE_MAX_PAGES} 页），请缩小后重试`,
      'VALIDATION'
    );
  }
  return null;
}

/**
 * 共享基线 core：运行时准备 → 探页数 → 越界校验 → embedded 短路 →
 * 单次 OCR 运行时准备 → 固定批次 OCR → 解析 → completed/cancelled/failed。
 * 调用方（内存字节 / 流内文件读取）均先发 `started` 再进此函数。
 */
async function runBaselinePhases(
  deps: TocBaselineStreamDeps,
  input: TocBaselineStreamRange,
  run: BaselineRun
): Promise<TocBaselineStreamOutcome> {
  const { sink } = run;
  const elapsedMs = (): number => elapsedMsOf(run);
  const { fromPage, toPage } = input;

  let lightInspector: PdfInspectorLike;
  try {
    const runtime = await ensurePdfRuntime({
      ...(deps.loadInspector ? { loadInspector: deps.loadInspector } : {}),
      ...(deps.runtimeDir ? { runtimeDir: deps.runtimeDir } : {}),
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      ...(sink.signal ? { signal: sink.signal } : {}),
      needOcr: false,
      onRuntimeEvent: (event) => {
        if (event.stage === 'inspector_downloaded') {
          tocTrace('runtime_inspector_downloaded', { elapsedMs: elapsedMs() });
        }
      },
    });
    lightInspector = runtime.inspector;
  } catch (e) {
    if (aborted(sink.signal)) return cancelRun(run);
    return failRun(
      run,
      e instanceof BusinessError
        ? e
        : new BusinessError('E_RUNTIME_LOAD', 'PDF 解析运行时准备失败，请检查网络后重试', 'NETWORK')
    );
  }

  const pageCount = probePdfPageCount(lightInspector, input.bytes);
  if (!Number.isFinite(pageCount) || pageCount < 1) {
    return failRun(run, new BusinessError('E_PDF_PARSE', 'PDF 页数识别失败，文件可能已损坏', 'TOOL_EXECUTION'));
  }
  if (toPage > pageCount) {
    return failRun(
      run,
      new BusinessError('E_INVALID_INPUT', `确认范围超出本书（本书共 ${pageCount} 页）`, 'VALIDATION')
    );
  }
  const window = rangePages(fromPage, toPage);
  run.plannedPages = window.length;
  sink.emit({ type: 'page_count_ready', plannedPages: run.plannedPages, elapsedMs: elapsedMs() });
  tocTrace('page_count_ready', { pageCount, plannedPages: run.plannedPages, elapsedMs: elapsedMs() });

  const outlineQuality = classifyEmbeddedOutline(lightInspector, input.bytes, pageCount);
  sink.emit({ type: 'embedded_outline_checked', elapsedMs: elapsedMs() });
  tocTrace('embedded_outline_checked', {
    quality: outlineQuality.quality,
    reason: outlineQuality.reason,
    validEntries: outlineQuality.validEntries,
    semanticEntries: outlineQuality.semanticEntries,
    elapsedMs: elapsedMs(),
  });
  if (outlineQuality.quality === 'usable') {
    const output = embeddedBaselineResult(fromPage, toPage, pageCount);
    sink.emit({ type: 'parsing', plannedPages: run.plannedPages, completedPages: run.completedPages, elapsedMs: elapsedMs() });
    tocTrace('parsing', { plannedPages: run.plannedPages, completedPages: run.completedPages, elapsedMs: elapsedMs() });
    tocTrace('completed', { completedPages: run.completedPages, candidates: 0, elapsedMs: elapsedMs() });
    sink.emit({ type: 'completed', plannedPages: run.plannedPages, completedPages: run.completedPages, elapsedMs: elapsedMs(), result: output });
    return { cancelled: false, result: ok(output) };
  }

  let cls: { pagesNeedingOcr?: unknown };
  try {
    cls = lightInspector.processPdf(input.bytes, window);
  } catch {
    return failRun(run, new BusinessError('E_PDF_PARSE', '目录基线 OCR 失败，请稍后重试', 'TOOL_EXECUTION'));
  }
  const rawNeeding = Array.isArray(cls.pagesNeedingOcr) ? cls.pagesNeedingOcr : [];
  const windowNeeding = rawNeeding.filter((n): n is number => typeof n === 'number');
  const needsOcr = window.some((p) => windowNeeding.includes(p));

  sink.emit({ type: 'runtime_check', elapsedMs: elapsedMs() });
  tocTrace('runtime_check', { needsOcr: needsOcr ? 1 : 0, elapsedMs: elapsedMs() });
  let ocrInspector: PdfInspectorLike = lightInspector;
  if (needsOcr && !deps.loadInspector) {
    let sawDownload = false;
    try {
      const runtime = await ensurePdfRuntime({
        ...(deps.runtimeDir ? { runtimeDir: deps.runtimeDir } : {}),
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        ...(sink.signal ? { signal: sink.signal } : {}),
        needOcr: true,
        onRuntimeEvent: (event) => {
          if (event.stage === 'ocr_downloading' && !sawDownload) {
            sawDownload = true;
            sink.emit({ type: 'runtime_download_started', elapsedMs: elapsedMs() });
            tocTrace('runtime_download_started', { elapsedMs: elapsedMs() });
          }
        },
      });
      ocrInspector = runtime.inspector;
    } catch (e) {
      if (aborted(sink.signal)) return cancelRun(run);
      return failRun(
        run,
        e instanceof BusinessError
          ? e
          : new BusinessError('E_PDF_PARSE', '目录基线 OCR 失败，请稍后重试', 'TOOL_EXECUTION')
      );
    }
    tocTrace('runtime_ready', { downloaded: sawDownload ? 1 : 0, elapsedMs: elapsedMs() });
  } else {
    tocTrace('runtime_ready', { downloaded: 0, elapsedMs: elapsedMs() });
  }
  sink.emit({ type: 'runtime_ready', elapsedMs: elapsedMs() });

  // 固定小批次 OCR：上报真实完成粒度（native 整批完成即整批上报，不伪造逐页）。
  const markdownByPage = new Map<number, string>();
  const spansByPage = new Map<number, TocGeometrySpan[]>();
  const ocrRouted = new Set<number>();
  for (let i = 0; i < window.length; i += TOC_DISCOVERY_BATCH_PAGES) {
    if (aborted(sink.signal)) return cancelRun(run);
    const batch = window.slice(i, i + TOC_DISCOVERY_BATCH_PAGES);
    const batchStart = Date.now();
    let perPage: Array<{ pageNumber?: unknown; markdown?: unknown; spans?: unknown }>;
    let routed: unknown;
    try {
      const ocr = await ocrInspector.processPdfWithOcr(input.bytes, { pageNumbers: batch });
      perPage = Array.isArray(ocr.pages) ? ocr.pages : [];
      routed = ocr.pagesRoutedToOcr;
    } catch (e) {
      if (aborted(sink.signal)) return cancelRun(run);
      return failRun(
        run,
        e instanceof BusinessError
          ? e
          : new BusinessError('E_PDF_PARSE', '目录基线 OCR 失败，请稍后重试', 'TOOL_EXECUTION')
      );
    }
    for (const pg of perPage) {
      if (typeof pg.pageNumber !== 'number' || typeof pg.markdown !== 'string') continue;
      markdownByPage.set(pg.pageNumber, pg.markdown);
      const spans: TocGeometrySpan[] = [];
      if (Array.isArray(pg.spans)) {
        for (const raw of pg.spans) {
          if (!raw || typeof raw !== 'object') continue;
          const rec = raw as Record<string, unknown>;
          if (typeof rec.text !== 'string') continue;
          let coordsOk = true;
          for (const key of ['x', 'y', 'width', 'height'] as const) {
            if (typeof rec[key] !== 'number' || !Number.isFinite(rec[key] as number)) coordsOk = false;
          }
          if (!coordsOk) continue;
          spans.push({
            text: rec.text,
            x: rec.x as number,
            y: rec.y as number,
            width: rec.width as number,
            height: rec.height as number,
            source: 'ocr',
            ...(typeof rec.confidence === 'number' ? { confidence: rec.confidence } : {}),
          });
        }
      }
      spansByPage.set(pg.pageNumber, spans);
    }
    if (Array.isArray(routed)) {
      for (const n of routed) {
        if (typeof n === 'number') ocrRouted.add(n);
      }
    }
    run.completedPages += batch.length;
    const batchFrom = batch[0] as number;
    const batchTo = batch[batch.length - 1] as number;
    sink.emit({
      type: 'ocr_batch_completed',
      plannedPages: run.plannedPages,
      completedPages: run.completedPages,
      batchFrom,
      batchTo,
      elapsedMs: elapsedMs(),
    });
    tocTrace('ocr_batch_completed', {
      batchFrom,
      batchTo,
      completedPages: run.completedPages,
      plannedPages: run.plannedPages,
      batchMs: Date.now() - batchStart,
    });
  }

  // 解析前最后一次取消检查：abort 落在末批内时不再解析、不发 completed。
  if (aborted(sink.signal)) return cancelRun(run);
  // P3.2B：OCR 无 spans 的页回填 native 定位（与 JSON 路径同一函数，结果一致）。
  fillPositionedSpans(ocrInspector, input.bytes, window, spansByPage);
  sink.emit({ type: 'parsing', plannedPages: run.plannedPages, completedPages: run.completedPages, elapsedMs: elapsedMs() });
  tocTrace('parsing', { plannedPages: run.plannedPages, completedPages: run.completedPages, elapsedMs: elapsedMs() });

  const washed = washRepeatedTocLines(
    window.map((p) => ({ page: p, lines: (markdownByPage.get(p) ?? '').split('\n') }))
  );
  const keptByPage = new Map<number, TocWashedLine[]>();
  for (const line of washed.kept) {
    const list = keptByPage.get(line.page) ?? [];
    list.push(line);
    keptByPage.set(line.page, list);
  }
  const evidenceByPage = new Map<number, string[]>();
  for (const line of washed.kept) {
    const list = evidenceByPage.get(line.page) ?? [];
    list.push(line.text);
    evidenceByPage.set(line.page, list);
  }
  const assembled = assembleTocBaseline({
    window,
    keptByPage,
    evidenceByPage,
    spansByPage,
    ocrPages: [...ocrRouted].sort((a, b) => a - b),
    washedKept: washed.kept.length,
    washedDropped: washed.dropped,
  });
  tocTrace('completed', { completedPages: run.completedPages, candidates: assembled.entries.length, elapsedMs: elapsedMs() });
  const output: TocBaselineOutput = {
    status: assembled.status,
    verdict: assembled.verdict,
    range: { fromPage, toPage },
    pageCount,
    entries: assembled.entries,
    unresolvedCandidates: assembled.unresolvedCandidates,
    diagnostics: assembled.diagnostics,
    pageEvidence: assembled.pageEvidence,
    embedded: false,
  };
  sink.emit({ type: 'completed', plannedPages: run.plannedPages, completedPages: run.completedPages, elapsedMs: elapsedMs(), result: output });
  return { cancelled: false, result: ok(output) };
}

/**
 * 目录基线流式编排（内存字节输入：multipart 上传；字节已在手，无读取进度，不伪造）。
 */
export async function extractTocBaselineStream(
  deps: TocBaselineStreamDeps,
  input: TocBaselineStreamRange,
  sink: TocBaselineStreamSink
): Promise<TocBaselineStreamOutcome> {
  const run: BaselineRun = { sink, startedAt: Date.now(), plannedPages: 0, completedPages: 0 };
  const valid = validatePdfInput({ userId: input.userId, filename: input.filename, bytes: input.bytes });
  if (!valid.ok) return failRun(run, valid.error);
  const rangeError = invalidRange(input.fromPage, input.toPage);
  if (rangeError) return failRun(run, rangeError);
  if (aborted(sink.signal)) return cancelRun(run);
  sink.emit({ type: 'started', elapsedMs: elapsedMsOf(run) });
  tocTrace('started', { elapsedMs: elapsedMsOf(run) });
  return runBaselinePhases(deps, input, run);
}

/**
 * P3.3：目录基线流式编排（JSON `filePath` 输入：读取也在流内）。
 * `started` 先于文件 IO 发出；分块读取上报真实字节进度；abort 在分块间
 * 停读（只发 cancelled，不碰运行时/OCR）；读完后走同一 core。
 */
export async function extractTocBaselineStreamFromFile(
  deps: TocBaselineFileDeps,
  fileInput: { userId: string; filePath: string; fromPage: number; toPage: number },
  sink: TocBaselineStreamSink
): Promise<TocBaselineStreamOutcome> {
  const run: BaselineRun = { sink, startedAt: Date.now(), plannedPages: 0, completedPages: 0 };
  if (!fileInput.userId) {
    return failRun(run, new BusinessError('E_INVALID_INPUT', '缺少用户标识', 'VALIDATION'));
  }
  const rangeError = invalidRange(fileInput.fromPage, fileInput.toPage);
  if (rangeError) return failRun(run, rangeError);
  if (aborted(sink.signal)) return cancelRun(run);
  sink.emit({ type: 'started', elapsedMs: elapsedMsOf(run) });
  tocTrace('started', { elapsedMs: elapsedMsOf(run) });

  sink.emit({ type: 'input_read_started', elapsedMs: elapsedMsOf(run) });
  tocTrace('input_read_started', { elapsedMs: elapsedMsOf(run) });
  const reader = deps.readLocalFile ?? readLocalPdfFileStreamed;
  let read: LocalPdfStreamedOutcome;
  let totalBytes: number | null = null;
  let lastUiSample = 0;
  let lastTraceSample = 0;
  try {
    read = await reader(fileInput.filePath, {
      ...(sink.signal ? { signal: sink.signal } : {}),
      onProgress: (progress) => {
        totalBytes = progress.totalBytes;
        if (progress.readBytes - lastUiSample >= TOC_READ_UI_SAMPLE_BYTES) {
          lastUiSample = progress.readBytes;
          sink.emit({
            type: 'input_read_progress',
            readBytes: progress.readBytes,
            totalBytes: progress.totalBytes,
            elapsedMs: elapsedMsOf(run),
          });
        }
        if (progress.readBytes - lastTraceSample >= TOC_READ_TRACE_SAMPLE_BYTES) {
          lastTraceSample = progress.readBytes;
          tocTrace('input_read_progress', {
            readBytes: progress.readBytes,
            totalBytes: progress.totalBytes,
            elapsedMs: elapsedMsOf(run),
          });
        }
      },
    });
  } catch {
    return failRun(run, new BusinessError('E_INVALID_INPUT', '本地文件读取失败', 'VALIDATION'));
  }
  if (read.cancelled || aborted(sink.signal)) return cancelRun(run);
  if (!isOk(read.result)) return failRun(run, read.result.error);
  const { bytes, filename } = read.result.value;
  sink.emit({ type: 'input_read_ready', readBytes: bytes.length, totalBytes, elapsedMs: elapsedMsOf(run) });
  tocTrace('input_read_ready', {
    readBytes: bytes.length,
    ...(totalBytes === null ? {} : { totalBytes }),
    elapsedMs: elapsedMsOf(run),
  });

  const valid = validatePdfInput({ userId: fileInput.userId, filename, bytes });
  if (!valid.ok) return failRun(run, valid.error);
  return runBaselinePhases(
    deps,
    { userId: fileInput.userId, filename, bytes, fromPage: fileInput.fromPage, toPage: fileInput.toPage },
    run
  );
}
