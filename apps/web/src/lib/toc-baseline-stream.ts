import { narrowTocBaseline, type TocBaselineData } from './toc-confirm-flow.js';

/**
 * CMD-LINGUA-P3.3：基线提取流式进度纯逻辑（无 React、无 fetch、无存储）。
 *
 * - 事件收窄：网关 NDJSON 每行 → 白名单事件或 null；未知 type、缺数字、
 *   含禁用键（路径/文件名/userId/正文/标题/模型输出）一律 null。
 * - 进度只记录服务端上报的真实 completedPages/plannedPages 与字节数，
 *   绝不插值、不估算；取消/失败为终态。
 * - 世代守门：取消即换代，迟到事件丢弃（与 discover 流同原则）。
 */

export type TocBaselineStreamEventType =
  | 'started'
  | 'input_read_started'
  | 'input_read_progress'
  | 'input_read_ready'
  | 'page_count_ready'
  | 'embedded_outline_checked'
  | 'runtime_check'
  | 'runtime_download_started'
  | 'runtime_ready'
  | 'ocr_batch_completed'
  | 'parsing'
  | 'completed'
  | 'cancelled'
  | 'failed';

const STREAM_TYPES: ReadonlySet<string> = new Set([
  'started',
  'input_read_started',
  'input_read_progress',
  'input_read_ready',
  'page_count_ready',
  'embedded_outline_checked',
  'runtime_check',
  'runtime_download_started',
  'runtime_ready',
  'ocr_batch_completed',
  'parsing',
  'completed',
  'cancelled',
  'failed',
]);

/** 事件负载禁用键：出现任一即整行丢弃（服务端永不发送，双向锁定）。 */
const FORBIDDEN_STREAM_KEYS: ReadonlySet<string> = new Set([
  'filePath',
  'filename',
  'fileName',
  'path',
  'userId',
  'markdown',
  'text',
  'title',
  'folio',
  'entries',
  'model',
  'anchor',
  'anchors',
  'prompt',
  'url',
  'downloadUrl',
  'bytes',
  'pdf',
  'embeddedOutline',
  'outlineSource',
]);

export interface NarrowedTocBaselineStreamEvent {
  type: TocBaselineStreamEventType;
  plannedPages: number | null;
  completedPages: number | null;
  batchFrom: number | null;
  batchTo: number | null;
  readBytes: number | null;
  totalBytes: number | null;
  /** completed 的基线结果（窄化失败即整行 null）。 */
  data: TocBaselineData | null;
  code: string | null;
  userMessage: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNonNegativeInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

function asPositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) return null;
  return value;
}

/** 流式事件收窄（纯函数）：形状不对/含禁用键返回 null。 */
export function narrowTocBaselineStreamEvent(payload: unknown): NarrowedTocBaselineStreamEvent | null {
  if (!isRecord(payload)) return null;
  const { type } = payload;
  if (typeof type !== 'string' || !STREAM_TYPES.has(type)) return null;
  const eventType = type as TocBaselineStreamEventType;
  for (const key of Object.keys(payload)) {
    if (FORBIDDEN_STREAM_KEYS.has(key)) return null;
  }
  const plannedPages = 'plannedPages' in payload ? asNonNegativeInt(payload.plannedPages) : null;
  const completedPages = 'completedPages' in payload ? asNonNegativeInt(payload.completedPages) : null;
  const batchFrom = 'batchFrom' in payload ? asPositiveInt(payload.batchFrom) : null;
  const batchTo = 'batchTo' in payload ? asPositiveInt(payload.batchTo) : null;
  const readBytes = 'readBytes' in payload ? asNonNegativeInt(payload.readBytes) : null;
  const totalBytes =
    !('totalBytes' in payload) || payload.totalBytes === null ? null : asNonNegativeInt(payload.totalBytes);
  if ('plannedPages' in payload && plannedPages === null) return null;
  if ('completedPages' in payload && completedPages === null) return null;
  if ('batchFrom' in payload && batchFrom === null) return null;
  if ('batchTo' in payload && batchTo === null) return null;
  if ('readBytes' in payload && readBytes === null) return null;
  if ('totalBytes' in payload && payload.totalBytes !== null && totalBytes === null) return null;
  if (eventType === 'input_read_progress') {
    if (readBytes === null) return null;
    if (totalBytes !== null && readBytes > totalBytes) return null;
  }
  if (eventType === 'input_read_ready') {
    if (readBytes === null) return null;
  }
  if (eventType === 'ocr_batch_completed') {
    if (plannedPages === null || completedPages === null || batchFrom === null || batchTo === null) return null;
    if (completedPages > plannedPages || batchTo < batchFrom) return null;
  }
  if (eventType === 'completed') {
    if (plannedPages === null || completedPages === null) return null;
    if (!('result' in payload)) return null;
    const data = narrowTocBaseline(payload.result);
    if (!data) return null;
    return { type: eventType, plannedPages, completedPages, batchFrom, batchTo, readBytes, totalBytes, data, code: null, userMessage: null };
  }
  if (eventType === 'failed') {
    const { code, userMessage } = payload;
    if (typeof code !== 'string' || !code || typeof userMessage !== 'string' || !userMessage) return null;
    return { type: eventType, plannedPages, completedPages, batchFrom, batchTo, readBytes, totalBytes, data: null, code, userMessage };
  }
  return { type: eventType, plannedPages, completedPages, batchFrom, batchTo, readBytes, totalBytes, data: null, code: null, userMessage: null };
}

export type TocExtractPhase =
  | 'preparing'
  | 'input_read'
  | 'page_count'
  | 'embedded'
  | 'runtime'
  | 'ocr'
  | 'parsing'
  | 'done'
  | 'cancelled'
  | 'failed';

export interface TocExtractProgress {
  started: boolean;
  phase: TocExtractPhase;
  /** 真实计划页（page_count_ready 上报前为 0，不猜）。 */
  plannedPages: number;
  /** 真实完成页（仅批次完成累加，不插值）。 */
  completedPages: number;
  batchFrom: number | null;
  batchTo: number | null;
  readBytes: number;
  totalBytes: number | null;
  runtimeDownloading: boolean;
  error: string | null;
}

export const initialTocExtractProgress: TocExtractProgress = {
  started: false,
  phase: 'preparing',
  plannedPages: 0,
  completedPages: 0,
  batchFrom: null,
  batchTo: null,
  readBytes: 0,
  totalBytes: null,
  runtimeDownloading: false,
  error: null,
};

/** 本地用户取消后的终态（不经过服务端事件，立刻解除 busy）。 */
export const cancelledTocExtractProgress: TocExtractProgress = {
  ...initialTocExtractProgress,
  started: true,
  phase: 'cancelled',
};

/** 流式进度 reducer（纯函数）：事件只推进真实数字，终态后忽略后续事件。 */
export function applyTocExtractStreamEvent(
  state: TocExtractProgress,
  event: NarrowedTocBaselineStreamEvent
): TocExtractProgress {
  if (state.phase === 'done' || state.phase === 'cancelled' || state.phase === 'failed') return state;
  switch (event.type) {
    case 'started':
      return { ...state, started: true, phase: 'preparing' };
    case 'input_read_started':
      return { ...state, started: true, phase: 'input_read' };
    case 'input_read_progress':
      return {
        ...state,
        started: true,
        phase: 'input_read',
        readBytes: event.readBytes ?? state.readBytes,
        totalBytes: event.totalBytes,
      };
    case 'input_read_ready':
      return {
        ...state,
        started: true,
        phase: 'input_read',
        readBytes: event.readBytes ?? state.readBytes,
        totalBytes: event.totalBytes,
      };
    case 'page_count_ready':
      return { ...state, started: true, phase: 'page_count', plannedPages: event.plannedPages ?? state.plannedPages };
    case 'embedded_outline_checked':
      return { ...state, started: true, phase: 'embedded' };
    case 'runtime_check':
      return { ...state, started: true, phase: 'runtime' };
    case 'runtime_download_started':
      return { ...state, started: true, phase: 'runtime', runtimeDownloading: true };
    case 'runtime_ready':
      return { ...state, started: true, phase: 'runtime' };
    case 'ocr_batch_completed':
      return {
        ...state,
        started: true,
        phase: 'ocr',
        plannedPages: event.plannedPages ?? state.plannedPages,
        completedPages: event.completedPages ?? state.completedPages,
        batchFrom: event.batchFrom,
        batchTo: event.batchTo,
      };
    case 'parsing':
      return { ...state, started: true, phase: 'parsing' };
    case 'completed':
      return {
        ...state,
        started: true,
        phase: 'done',
        plannedPages: event.plannedPages ?? state.plannedPages,
        completedPages: event.completedPages ?? state.completedPages,
      };
    case 'cancelled':
      return { ...cancelledTocExtractProgress, plannedPages: state.plannedPages, completedPages: state.completedPages };
    case 'failed':
      return { ...state, started: true, phase: 'failed', error: event.userMessage ?? '提取目录基线失败，请稍后重试' };
    default:
      return state;
  }
}

/** 是否仍在跑（取消按钮/禁用态用；done/cancelled/failed 均不在跑）。 */
export function isTocExtractPending(progress: TocExtractProgress | null): boolean {
  if (!progress || !progress.started) return false;
  return progress.phase !== 'done' && progress.phase !== 'cancelled' && progress.phase !== 'failed';
}

/**
 * 迟到事件守门（纯函数）：只有同代且未终结才接受。
 * 取消即换代，之后到达的 completed 一律丢弃、不采纳。
 */
export function shouldAcceptExtractStreamEvent(runId: number, currentRunId: number, settled: boolean): boolean {
  return runId === currentRunId && !settled;
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function phaseLabel(phase: TocExtractPhase): string {
  switch (phase) {
    case 'preparing':
      return '准备提取…';
    case 'input_read':
      return '正在读取本地 PDF';
    case 'page_count':
      return '已探页数，检查内置目录…';
    case 'embedded':
      return '内置目录检查完成…';
    case 'runtime':
      return '准备本地 OCR 运行时…';
    case 'ocr':
      return 'OCR 识别目录页…';
    case 'parsing':
      return '正在解析…';
    case 'done':
      return '提取完成';
    case 'cancelled':
      return '已取消提取';
    case 'failed':
      return '提取失败';
    default:
      return '提取中…';
  }
}

/**
 * 进度文案（纯函数）：页数/字节只用服务端上报的真实数字；
 * 未知分母时不编造，只给阶段名；从不输出百分比。
 */
export function tocExtractStageLabel(progress: TocExtractProgress): string {
  const base = phaseLabel(progress.phase);
  if (progress.phase === 'input_read') {
    const read = formatMegabytes(progress.readBytes);
    if (progress.totalBytes === null) return `${base}：已读 ${read}`;
    return `${base}：${read} / ${formatMegabytes(progress.totalBytes)}`;
  }
  if (progress.phase === 'ocr' && progress.plannedPages > 0) {
    const batch =
      progress.batchFrom !== null && progress.batchTo !== null
        ? `（第 ${progress.batchFrom}–${progress.batchTo} 页批次完成）`
        : '';
    return `${base}${progress.completedPages}/${progress.plannedPages}${batch}`;
  }
  return base;
}
