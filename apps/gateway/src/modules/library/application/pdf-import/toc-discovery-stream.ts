import { BusinessError, err, isOk, ok, logger, type Result } from '@study-studio/shared';
import { ensurePdfRuntime, type PdfInspectorLike } from './pdf-runtime.js';
import {
  readLocalPdfFileStreamed,
  type LocalPdfStreamedOutcome,
  type LocalPdfStreamedHooks,
} from './local-file.js';
import {
  probePdfPageCount,
  rangePages,
  validatePdfInput,
  type PdfImportInput,
  type PdfImportServiceDeps,
} from './pdf-import-service.js';
import { classifyEmbeddedOutline } from './embedded-outline-quality.js';
import {
  TOC_DISCOVERY_MAX_PAGES,
  mergeTocCandidateRanges,
  scoreTocDiscoveryPage,
  type TocDiscoveryOutput,
} from './toc-discovery.js';

/**
 * CMD-LINGUA-P2.1 / P2.1a：目录探测流式编排（只读，NDJSON 事件）。
 *
 * 旧 `discoverTocPages` 对前窗一次 `processPdfWithOcr(30页)`，UI 只能干等；
 * 本模块把同一窗口拆成固定小批次（每批 5 页），每批完成后才上报真实
 * completedPages/plannedPages，不伪造百分比。评分规则、found/ambiguous/
 * not-found 语义与旧函数逐行一致（同纯函数、同合并判定），只改“怎么跑”，
 * 不改“怎么判”；不提前停扫（最坏仍看满 30 页）。
 *
 * P2.1a：JSON `filePath` 路径的文件 IO 也在流内——`started` 先于读取发出，
 * 分块读取上报真实字节进度（`input_read_*`），abort 在分块间停读。
 * multipart 上传体到达网关前无读取进度可言，不伪造（无 input_read 事件）。
 *
 * 只读铁律：不写 DB/AST/缓存；OCR 原文不出本函数；事件与日志只含白名单
 * 字段（阶段、页数/字节数、批次范围、耗时、错误 code），绝无路径/文件名/
 * 正文/标题/userId/模型输出/下载 URL。
 *
 * 取消：调用方传 request AbortSignal；native OCR 当前批不可中断时如实处理——
 * 当前批可跑完，但批之间/评分前必查 signal，abort 后只发 cancelled，永不
 * 再发 completed，后续批次一个都不跑。读取阶段 abort 则连运行时都不碰。
 *
 * 运行时准备：轻量 inspector（探页数/embedded/分类）与 OCR 运行时各准备
 * 最多一次，批次循环内零准备、零下载；注入桩（单测）时只准备一次。
 */

/** OCR 批次大小（页）：恒 ≤ 探测窗且恒 ≤ OCR 总上限；调大必须重审取消粒度。 */
export const TOC_DISCOVERY_BATCH_PAGES = 5;

/**
 * CMD-LINGUA-P2.2 读取进度采样（字节，真实已读值，不插值）：
 * - 底层分块仍 64KB（见 local-file），取消粒度不变；
 * - UI `input_read_progress` 每 4MB 一次（171MB ≈ 42 次 + ready，不刷屏）；
 * - trace `input_read_progress` 每 16MB 一次（started/ready/cancelled/failed
 *   恒在，取消与失败不采样）；
 * - 小于阈值的文件可零 progress、直接 ready（不伪造）。
 */
export const TOC_READ_UI_SAMPLE_BYTES = 4 * 1024 * 1024;
export const TOC_READ_TRACE_SAMPLE_BYTES = 16 * 1024 * 1024;

export type TocDiscoveryStreamEvent =
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

/** P2.1a：文件读取器注入点（默认真机分块读取；单测注入慢速/可门控 fake）。 */
export type TocDiscoveryFileReader = (
  filePath: string,
  hooks: LocalPdfStreamedHooks
) => Promise<LocalPdfStreamedOutcome>;

export type TocDiscoveryFileDeps = TocDiscoveryStreamDeps & {
  readLocalFile?: TocDiscoveryFileReader;
};

/** 开发诊断总开关（显式 opt-in，不改全局日志级别，不影响其他模块）。 */
export function isTocTraceEnabled(): boolean {
  return process.env.LINGUA_PDF_TRACE === '1';
}

/**
 * TOC 诊断白名单日志：只走项目 logger（warn 级，保证默认级别下终端可见，
 * 又不触全局 setLogLevel）；payload 只允许阶段、页数/字节数、批次范围、
 * 耗时、错误 code（均为固定枚举形短串/数字，无正文、无路径、无标识）。
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

interface StreamRun {
  sink: TocDiscoveryStreamSink;
  startedAt: number;
  plannedPages: number;
  completedPages: number;
}

function elapsedMsOf(run: StreamRun): number {
  return Date.now() - run.startedAt;
}

function failRun(run: StreamRun, error: BusinessError): TocDiscoveryStreamOutcome {
  tocTrace('failed', { code: error.code, elapsedMs: elapsedMsOf(run) });
  run.sink.emit({ type: 'failed', elapsedMs: elapsedMsOf(run), code: error.code, userMessage: error.userMessage });
  return { cancelled: false, result: err(error) };
}

function cancelRun(run: StreamRun): TocDiscoveryStreamOutcome {
  tocTrace('cancelled', { plannedPages: run.plannedPages, completedPages: run.completedPages, elapsedMs: elapsedMsOf(run) });
  run.sink.emit({ type: 'cancelled', plannedPages: run.plannedPages, completedPages: run.completedPages, elapsedMs: elapsedMsOf(run) });
  return { cancelled: true };
}

/**
 * 共享探测 core：运行时准备 → 探页数 → embedded 短路 → 批次 OCR → 评分。
 * 调用方（内存字节 / 流内文件读取）均先发 `started` 再进此函数。
 */
async function runDiscoveryPhases(
  deps: TocDiscoveryStreamDeps,
  input: PdfImportInput,
  run: StreamRun
): Promise<TocDiscoveryStreamOutcome> {
  const { sink } = run;
  const elapsedMs = (): number => elapsedMsOf(run);

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
    if (aborted(sink.signal)) return cancelRun(run);
    return failRun(
      run,
      e instanceof BusinessError
        ? e
        : new BusinessError('E_RUNTIME_LOAD', 'PDF 解析运行时准备失败，请检查网络后重试', 'NETWORK')
    );
  }

  // 诚实页数（[1] 轻探针，不扫全书）。
  const pageCount = probePdfPageCount(lightInspector, input.bytes);
  if (!Number.isFinite(pageCount) || pageCount < 1) {
    return failRun(run, new BusinessError('E_PDF_PARSE', 'PDF 页数识别失败，文件可能已损坏', 'TOOL_EXECUTION'));
  }
  run.plannedPages = Math.min(pageCount, TOC_DISCOVERY_MAX_PAGES);
  sink.emit({ type: 'page_count_ready', plannedPages: run.plannedPages, elapsedMs: elapsedMs() });
  tocTrace('page_count_ready', { pageCount, plannedPages: run.plannedPages, elapsedMs: elapsedMs() });

  // P2.2 唯一质量门：usable 才短路；none/unusable 一律走 OCR 前窗。
  // unusable 会继续跑 OCR，并在 completed 里带回质量供 UI 解释。
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
    sink.emit({ type: 'scoring', plannedPages: run.plannedPages, completedPages: run.completedPages, elapsedMs: elapsedMs() });
    const output: TocDiscoveryOutput = {
      status: 'not-found',
      candidates: [],
      pageCount,
      pagesScanned: [],
      ocrPages: [],
      embedded: true,
      outlineQuality: 'usable',
    };
    tocTrace('completed', { completedPages: run.completedPages, candidates: 0, elapsedMs: elapsedMs() });
    sink.emit({ type: 'completed', plannedPages: run.plannedPages, completedPages: run.completedPages, elapsedMs: elapsedMs(), result: output });
    return { cancelled: false, result: ok(output) };
  }

  // 前部探测窗（恒非空，≤30），与旧函数同口径。
  const window = rangePages(1, run.plannedPages);
  let cls: { pagesNeedingOcr?: unknown };
  try {
    cls = lightInspector.processPdf(input.bytes, window);
  } catch {
    return failRun(run, new BusinessError('E_PDF_PARSE', '目录页探测失败，请稍后重试', 'TOOL_EXECUTION'));
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
      if (aborted(sink.signal)) return cancelRun(run);
      return failRun(
        run,
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
    if (aborted(sink.signal)) return cancelRun(run);
    const batch = window.slice(i, i + TOC_DISCOVERY_BATCH_PAGES);
    const batchStart = Date.now();
    let perPage: Array<{ pageNumber?: unknown; markdown?: unknown }>;
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

  // 评分前最后一次取消检查：abort 落在末批内时，本批已计入，但不再评分、不发 completed。
  if (aborted(sink.signal)) return cancelRun(run);
  sink.emit({ type: 'scoring', plannedPages: run.plannedPages, completedPages: run.completedPages, elapsedMs: elapsedMs() });
  tocTrace('scoring', { plannedPages: run.plannedPages, completedPages: run.completedPages, elapsedMs: elapsedMs() });

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
    outlineQuality: outlineQuality.quality,
  };
  tocTrace('completed', { completedPages: run.completedPages, candidates: candidates.length, elapsedMs: elapsedMs() });
  sink.emit({ type: 'completed', plannedPages: run.plannedPages, completedPages: run.completedPages, elapsedMs: elapsedMs(), result: output });
  return { cancelled: false, result: ok(output) };
}

/**
 * 目录探测流式编排（内存字节输入：multipart 上传 / 旧 JSON 全量读取路径）。
 * 字节已在手，无读取进度可言，不发 input_read 事件（不伪造）。
 */
export async function discoverTocPagesStream(
  deps: TocDiscoveryStreamDeps,
  input: PdfImportInput,
  sink: TocDiscoveryStreamSink
): Promise<TocDiscoveryStreamOutcome> {
  const run: StreamRun = { sink, startedAt: Date.now(), plannedPages: 0, completedPages: 0 };
  const valid = validatePdfInput(input);
  if (!valid.ok) return failRun(run, valid.error);
  if (aborted(sink.signal)) return cancelRun(run);
  sink.emit({ type: 'started', elapsedMs: elapsedMsOf(run) });
  tocTrace('started', { elapsedMs: elapsedMsOf(run) });
  return runDiscoveryPhases(deps, input, run);
}

/**
 * P2.1a：目录探测流式编排（JSON `filePath` 输入：读取也在流内）。
 * `started` 先于文件 IO 发出；分块读取上报真实字节进度；abort 在分块间
 * 停读（只发 cancelled，不碰运行时/OCR）；读完后走同一 core（同 200MB
 * 内容校验、同批次、同评分，语义与字节路径完全一致）。
 */
export async function discoverTocPagesStreamFromFile(
  deps: TocDiscoveryFileDeps,
  fileInput: { userId: string; filePath: string },
  sink: TocDiscoveryStreamSink
): Promise<TocDiscoveryStreamOutcome> {
  const run: StreamRun = { sink, startedAt: Date.now(), plannedPages: 0, completedPages: 0 };
  if (!fileInput.userId) {
    return failRun(run, new BusinessError('E_INVALID_INPUT', '缺少用户标识', 'VALIDATION'));
  }
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
        // 采样：只转发跨过阈值的真实已读值；取消仍在 64KB 边界生效（reader 侧）。
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
  return runDiscoveryPhases(deps, { userId: fileInput.userId, filename, bytes }, run);
}
