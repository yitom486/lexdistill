import { BusinessError, err, ok, logger, type Result } from '@study-studio/shared';
import { ensurePdfRuntime, type PdfInspectorLike } from './pdf-runtime.js';
import {
  probePdfPageCount,
  rangePages,
  readEmbeddedOutlineEntries,
  validatePdfInput,
  type PdfImportInput,
  type PdfImportServiceDeps,
} from './pdf-import-service.js';
import {
  TOC_DISCOVERY_MAX_PAGES,
  mergeTocCandidateRanges,
  scoreTocDiscoveryPage,
  type TocDiscoveryOutput,
} from './toc-discovery.js';

/**
 * CMD-LINGUA-P2.1：目录探测流式编排（只读，NDJSON 事件）。
 *
 * 旧 `discoverTocPages` 对前窗一次 `processPdfWithOcr(30页)`，UI 只能干等；
 * 本模块把同一窗口拆成固定小批次（每批 5 页），每批完成后才上报真实
 * completedPages/plannedPages，不伪造百分比。评分规则、found/ambiguous/
 * not-found 语义与旧函数逐行一致（同纯函数、同合并判定），只改“怎么跑”，
 * 不改“怎么判”；不提前停扫（最坏仍看满 30 页）。
 *
 * 只读铁律：不写 DB/AST/缓存；OCR 原文不出本函数；事件与日志只含白名单
 * 字段（阶段、页数、批次范围、耗时、错误 code），绝无路径/文件名/正文/
 * 标题/userId/模型输出/下载 URL。
 *
 * 取消：调用方传 request AbortSignal；native OCR 当前批不可中断时如实处理——
 * 当前批可跑完，但批之间/评分前必查 signal，abort 后只发 cancelled，永不
 * 再发 completed，后续批次一个都不跑。
 *
 * 运行时准备：轻量 inspector（探页数/embedded/分类）与 OCR 运行时各准备
 * 最多一次，批次循环内零准备、零下载；注入桩（单测）时只准备一次。
 */

/** OCR 批次大小（页）：恒 ≤ 探测窗且恒 ≤ OCR 总上限；调大必须重审取消粒度。 */
export const TOC_DISCOVERY_BATCH_PAGES = 5;

export type TocDiscoveryStreamEvent =
  | { type: 'started'; elapsedMs: number }
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
  | { type: 'scoring'; plannedPages: number; completedPages: number; elapsedMs: number }
  | {
      type: 'completed';
      plannedPages: number;
      completedPages: number;
      elapsedMs: number;
      result: TocDiscoveryOutput;
    }
  | { type: 'cancelled'; plannedPages: number; completedPages: number; elapsedMs: number }
  | { type: 'failed'; elapsedMs: number; code: string; userMessage: string };

export interface TocDiscoveryStreamSink {
  emit(event: TocDiscoveryStreamEvent): void;
  signal?: AbortSignal;
}

export type TocDiscoveryStreamOutcome =
  | { cancelled: false; result: Result<TocDiscoveryOutput, BusinessError> }
  | { cancelled: true };

export type TocDiscoveryStreamDeps = Pick<PdfImportServiceDeps, 'loadInspector' | 'runtimeDir'> & {
  fetchImpl?: typeof fetch;
};

/** 开发诊断总开关（显式 opt-in，不改全局日志级别，不影响其他模块）。 */
export function isTocTraceEnabled(): boolean {
  return process.env.LINGUA_PDF_TRACE === '1';
}

/**
 * TOC 诊断白名单日志：只走项目 logger（warn 级，保证默认级别下终端可见，
 * 又不触全局 setLogLevel）；payload 只允许阶段、页数、批次范围、耗时、
 * 错误 code（均为固定枚举形短串/数字，无正文、无路径、无标识）。
 */
function tocTrace(stage: string, fields: Record<string, number | string>): void {
  if (!isTocTraceEnabled()) return;
  logger.warn('[toc-trace]', stage, fields);
}

function aborted(signal: AbortSignal | undefined): boolean {
  try {
    return signal?.aborted === true;
  } catch {
    return false;
  }
}

/**
 * 目录探测流式编排：探页数 → embedded 短路 → 单次 OCR 运行时准备 →
 * 固定 5 页批次 OCR（批间可取消）→ 评分 → completed/cancelled/failed。
 */
export async function discoverTocPagesStream(
  deps: TocDiscoveryStreamDeps,
  input: PdfImportInput,
  sink: TocDiscoveryStreamSink
): Promise<TocDiscoveryStreamOutcome> {
  const startedAt = Date.now();
  const elapsedMs = (): number => Date.now() - startedAt;
  let plannedPages = 0;
  let completedPages = 0;

  const fail = (error: BusinessError): TocDiscoveryStreamOutcome => {
    tocTrace('failed', { code: error.code, elapsedMs: elapsedMs() });
    sink.emit({ type: 'failed', elapsedMs: elapsedMs(), code: error.code, userMessage: error.userMessage });
    return { cancelled: false, result: err(error) };
  };
  const cancel = (): TocDiscoveryStreamOutcome => {
    tocTrace('cancelled', { plannedPages, completedPages, elapsedMs: elapsedMs() });
    sink.emit({ type: 'cancelled', plannedPages, completedPages, elapsedMs: elapsedMs() });
    return { cancelled: true };
  };

  const valid = validatePdfInput(input);
  if (!valid.ok) return fail(valid.error);
  if (aborted(sink.signal)) return cancel();

  sink.emit({ type: 'started', elapsedMs: elapsedMs() });
  tocTrace('started', { elapsedMs: elapsedMs() });

  // 轻量运行时（探页数/embedded/分类用；注入桩时即测试桩，无下载）。
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
    if (aborted(sink.signal)) return cancel();
    return fail(
      e instanceof BusinessError
        ? e
        : new BusinessError('E_RUNTIME_LOAD', 'PDF 解析运行时准备失败，请检查网络后重试', 'NETWORK')
    );
  }

  // 诚实页数（[1] 轻探针，不扫全书）。
  const pageCount = probePdfPageCount(lightInspector, input.bytes);
  if (!Number.isFinite(pageCount) || pageCount < 1) {
    return fail(new BusinessError('E_PDF_PARSE', 'PDF 页数识别失败，文件可能已损坏', 'TOOL_EXECUTION'));
  }
  plannedPages = Math.min(pageCount, TOC_DISCOVERY_MAX_PAGES);
  sink.emit({ type: 'page_count_ready', plannedPages, elapsedMs: elapsedMs() });
  tocTrace('page_count_ready', { pageCount, plannedPages, elapsedMs: elapsedMs() });

  // P1 embedded 可用 → 零 OCR，直接完成（不伪造候选；与旧函数同输出）。
  const embeddedHit = readEmbeddedOutlineEntries(lightInspector, input.bytes, pageCount);
  sink.emit({ type: 'embedded_outline_checked', elapsedMs: elapsedMs() });
  tocTrace('embedded_outline_checked', { embeddedHit: embeddedHit ? 1 : 0, elapsedMs: elapsedMs() });
  if (embeddedHit) {
    sink.emit({ type: 'scoring', plannedPages, completedPages, elapsedMs: elapsedMs() });
    const output: TocDiscoveryOutput = {
      status: 'not-found',
      candidates: [],
      pageCount,
      pagesScanned: [],
      ocrPages: [],
      embedded: true,
    };
    tocTrace('completed', { completedPages, candidates: 0, elapsedMs: elapsedMs() });
    sink.emit({ type: 'completed', plannedPages, completedPages, elapsedMs: elapsedMs(), result: output });
    return { cancelled: false, result: ok(output) };
  }

  // 前部探测窗（恒非空，≤30），与旧函数同口径。
  const window = rangePages(1, plannedPages);
  let cls: { pagesNeedingOcr?: unknown };
  try {
    cls = lightInspector.processPdf(input.bytes, window);
  } catch {
    return fail(new BusinessError('E_PDF_PARSE', '目录页探测失败，请稍后重试', 'TOOL_EXECUTION'));
  }
  const rawNeeding = Array.isArray(cls.pagesNeedingOcr) ? cls.pagesNeedingOcr : [];
  const windowNeeding = rawNeeding.filter((n): n is number => typeof n === 'number');
  const needsOcr = window.some((p) => windowNeeding.includes(p));

  // OCR 运行时：单次准备（真机走 needOcr 升级，桩注入时复用已有句柄）。
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
      if (aborted(sink.signal)) return cancel();
      return fail(
        e instanceof BusinessError
          ? e
          : new BusinessError('E_PDF_PARSE', '目录页探测失败，请稍后重试', 'TOOL_EXECUTION')
      );
    }
    tocTrace('runtime_ready', { downloaded: sawDownload ? 1 : 0, elapsedMs: elapsedMs() });
  } else {
    tocTrace('runtime_ready', { downloaded: 0, elapsedMs: elapsedMs() });
  }
  sink.emit({ type: 'runtime_ready', elapsedMs: elapsedMs() });

  // 固定小批次 OCR：批间查取消；批次循环内零运行时准备。
  const ocrMarkdownByPage = new Map<number, string>();
  const ocrRouted = new Set<number>();
  for (let i = 0; i < window.length; i += TOC_DISCOVERY_BATCH_PAGES) {
    if (aborted(sink.signal)) return cancel();
    const batch = window.slice(i, i + TOC_DISCOVERY_BATCH_PAGES);
    const batchStart = Date.now();
    let perPage: Array<{ pageNumber?: unknown; markdown?: unknown }>;
    let routed: unknown;
    try {
      const ocr = await ocrInspector.processPdfWithOcr(input.bytes, { pageNumbers: batch });
      perPage = Array.isArray(ocr.pages) ? ocr.pages : [];
      routed = ocr.pagesRoutedToOcr;
    } catch (e) {
      if (aborted(sink.signal)) return cancel();
      return fail(
        e instanceof BusinessError
          ? e
          : new BusinessError('E_PDF_PARSE', '目录页探测失败，请稍后重试', 'TOOL_EXECUTION')
      );
    }
    for (const pg of perPage) {
      if (typeof pg.pageNumber === 'number' && typeof pg.markdown === 'string') {
        ocrMarkdownByPage.set(pg.pageNumber, pg.markdown);
      }
    }
    if (Array.isArray(routed)) {
      for (const n of routed) {
        if (typeof n === 'number') ocrRouted.add(n);
      }
    }
    completedPages += batch.length;
    const batchFrom = batch[0] as number;
    const batchTo = batch[batch.length - 1] as number;
    sink.emit({
      type: 'ocr_batch_completed',
      plannedPages,
      completedPages,
      batchFrom,
      batchTo,
      elapsedMs: elapsedMs(),
    });
    tocTrace('ocr_batch_completed', {
      batchFrom,
      batchTo,
      completedPages,
      plannedPages,
      batchMs: Date.now() - batchStart,
    });
  }

  // 评分前最后一次取消检查：abort 落在末批内时，本批已计入，但不再评分、不发 completed。
  if (aborted(sink.signal)) return cancel();
  sink.emit({ type: 'scoring', plannedPages, completedPages, elapsedMs: elapsedMs() });
  tocTrace('scoring', { plannedPages, completedPages, elapsedMs: elapsedMs() });

  const scored = window.map((p) => scoreTocDiscoveryPage(p, ocrMarkdownByPage.get(p) ?? ''));
  const candidates = mergeTocCandidateRanges(scored);
  const status = candidates.length === 0 ? 'not-found' : candidates.length === 1 ? 'found' : 'ambiguous';
  const output: TocDiscoveryOutput = {
    status,
    candidates,
    pageCount,
    pagesScanned: window,
    ocrPages: [...ocrRouted].sort((a, b) => a - b),
    embedded: false,
  };
  tocTrace('completed', { completedPages, candidates: candidates.length, elapsedMs: elapsedMs() });
  sink.emit({ type: 'completed', plannedPages, completedPages, elapsedMs: elapsedMs(), result: output });
  return { cancelled: false, result: ok(output) };
}
