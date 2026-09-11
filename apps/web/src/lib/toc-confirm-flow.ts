/**
 * CMD-LINGUA-P4C：目录确认流程纯逻辑（无 React、无 fetch、无存储）。
 *
 * - 范围校验：正整数、start ≤ end、extract/基线最多 30 页，AI 审核最多 8 页；
 *   超限一律在前端拦下，绝不发请求（后端仍是最终事实源）。
 * - 后端负载收窄：discover/extract/review 三个只读端点的 unknown JSON → 强类型或 null。
 * - 确认状态机：reducer 持有纯 UI 状态（选中候选、采纳来源、本地编辑、已确认），
 *   不落 localStorage、不调任何写接口；刷新/重挂载即回到初始态。
 */

/** extract-toc / 目录基线单次上限（页；与网关 TOC_BASELINE_MAX_PAGES 同值，前端镜像）。 */
export const TOC_CONFIRM_MAX_PAGES = 30;

/** review-toc / AI 审核单次上限（页；与网关 TOC_REVIEW_MAX_PAGES 同值，前端镜像）。 */
export const TOC_REVIEW_MAX_PAGES_UI = 8;

export interface TocDiscoveryCandidate {
  fromPage: number;
  toPage: number;
  score: number;
}

export type TocDiscoveryStatus = 'found' | 'ambiguous' | 'not-found';

export interface TocDiscoveryData {
  status: TocDiscoveryStatus;
  candidates: TocDiscoveryCandidate[];
  pageCount: number;
  /** 实际看过的前窗页数（展示用计数，不含页码明细）。 */
  pagesScannedCount: number;
  embedded: boolean;
  /**
   * CMD-LINGUA-P2.2 内嵌目录质量：unusable =“有书签但不足以构成教材目录，
   * 已回退 OCR”，UI 据此解释（旧网关无此字段时按 embedded 回填）。
   */
  outlineQuality: 'none' | 'usable' | 'unusable';
}

export type TocBaselineEntryKind = 'lesson' | 'section';
export type TocBaselineEntrySource = 'geometry' | 'text' | 'table';

export interface TocBaselineEntry {
  title: string;
  printedPage: number;
  level: number;
  source: TocBaselineEntrySource;
  kind: TocBaselineEntryKind;
}

export interface TocBaselineData {
  status: 'ok' | 'empty';
  range: { fromPage: number; toPage: number };
  pageCount: number;
  entries: TocBaselineEntry[];
  diagnostics: {
    pagesRequested: number;
    pagesOcr: number;
    linesConsidered: number;
    linesDroppedWash: number;
    entriesAccepted: number;
    entriesRejected: number;
  };
  embedded: boolean;
}

export type TocDraftConfidence = 'high' | 'medium' | 'low';

export interface TocReviewDraftEntry {
  title: string;
  printedPage: number;
  level: 1 | 2;
  kind: TocBaselineEntryKind;
  confidence: TocDraftConfidence;
}

export interface TocReviewDraft {
  entries: TocReviewDraftEntry[];
  warnings: string[];
}

export interface TocReviewData {
  embedded: boolean;
  range: { fromPage: number; toPage: number };
  pageCount: number;
  baseline: TocBaselineData;
  draft: TocReviewDraft | null;
  diagnostics: {
    pagesRequested: number;
    pagesRendered: number;
    baselineEntries: number;
    draftEntries: number;
  };
}

export type TocRangeValidation = { ok: true; from: number; to: number } | { ok: false; message: string };

function parsePositiveInt(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < 1) return undefined;
  return value;
}

/**
 * 目录确认范围校验（纯函数）：正整数、start ≤ end、最多 30 页。
 * 返回 ok:false 时调用方必须直接展示 message，绝不发请求。
 */
export function validateTocConfirmRange(startText: string, endText: string): TocRangeValidation {
  const from = parsePositiveInt(startText);
  const to = parsePositiveInt(endText);
  if (from === undefined || to === undefined) {
    return { ok: false, message: '请填写正整数页码（起始页与结束页都要填）' };
  }
  if (from > to) {
    return { ok: false, message: '起始页不能大于结束页' };
  }
  if (to - from + 1 > TOC_CONFIRM_MAX_PAGES) {
    return {
      ok: false,
      message: `一次最多确认 ${TOC_CONFIRM_MAX_PAGES} 页（当前 ${to - from + 1} 页），请缩小范围`,
    };
  }
  return { ok: true, from, to };
}

/** AI 审核可用性（纯函数）：范围合法且 ≤ 8 页；更大范围请先做基线再分段审核。 */
export function canRequestTocReview(from: number, to: number): boolean {
  return (
    Number.isSafeInteger(from) &&
    Number.isSafeInteger(to) &&
    from >= 1 &&
    to >= from &&
    to - from + 1 <= TOC_REVIEW_MAX_PAGES_UI
  );
}

export type TocRequestDecision =
  | { ok: true; from: number; to: number }
  | { ok: false; message: string };

/**
 * 提取守门（纯函数）：无源 / 范围非法（含超 30 页）一律 ok:false，
 * 调用方此时必须直接展示 message，绝不发请求。
 */
export function decideExtractRequest(
  hasSource: boolean,
  startText: string,
  endText: string
): TocRequestDecision {
  if (!hasSource) return { ok: false, message: '先选择 PDF 文件或填写本机路径' };
  return validateTocConfirmRange(startText, endText);
}

/**
 * 审核守门（纯函数）：无源 / 无基线 / embedded / 范围非法 / 超 8 页一律 ok:false。
 * embedded=true 时明确拒绝触发 AI（不需要 AI 审核）。
 */
export function decideReviewRequest(
  hasSource: boolean,
  startText: string,
  endText: string,
  baseline: { embedded: boolean } | null
): TocRequestDecision {
  if (!hasSource) return { ok: false, message: '先选择 PDF 文件或填写本机路径' };
  if (!baseline) return { ok: false, message: '先提取目录基线' };
  if (baseline.embedded) return { ok: false, message: '原生目录可用，无需 AI 审核' };
  const range = validateTocConfirmRange(startText, endText);
  if (!range.ok) return range;
  if (!canRequestTocReview(range.from, range.to)) {
    return { ok: false, message: `AI 审核单次最多 ${TOC_REVIEW_MAX_PAGES_UI} 页，请缩小范围或只看基线` };
  }
  return { ok: true, from: range.from, to: range.to };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function narrowCandidate(value: unknown): TocDiscoveryCandidate | null {
  if (!isRecord(value)) return null;
  const { fromPage, toPage, score } = value;
  if (typeof fromPage !== 'number' || typeof toPage !== 'number' || typeof score !== 'number') return null;
  if (!Number.isSafeInteger(fromPage) || !Number.isSafeInteger(toPage) || !Number.isFinite(score)) return null;
  if (fromPage < 1 || toPage < fromPage) return null;
  return { fromPage, toPage, score };
}

/** discover-toc 负载收窄（纯函数）：形状不对返回 null（调用方转中性错误，不崩溃）。 */
export function narrowTocDiscovery(payload: unknown): TocDiscoveryData | null {
  if (!isRecord(payload)) return null;
  const { status, candidates, pageCount, pagesScanned, embedded } = payload;
  if (status !== 'found' && status !== 'ambiguous' && status !== 'not-found') return null;
  if (!Array.isArray(candidates) || typeof pageCount !== 'number' || !Number.isSafeInteger(pageCount)) return null;
  if (!Array.isArray(pagesScanned)) return null;
  const narrowed: TocDiscoveryCandidate[] = [];
  for (const item of candidates) {
    const candidate = narrowCandidate(item);
    if (!candidate) return null;
    narrowed.push(candidate);
  }
  if (status === 'found' && narrowed.length !== 1) return null;
  if (status === 'ambiguous' && narrowed.length < 2) return null;
  if (status === 'not-found' && narrowed.length !== 0) return null;
  const qualityRaw = (payload as { outlineQuality?: unknown }).outlineQuality;
  const outlineQuality: TocDiscoveryData['outlineQuality'] =
    qualityRaw === 'usable' || qualityRaw === 'unusable' || qualityRaw === 'none'
      ? qualityRaw
      : embedded === true
        ? 'usable'
        : 'none';
  return { status, candidates: narrowed, pageCount, pagesScannedCount: pagesScanned.length, embedded: embedded === true, outlineQuality };
}

function narrowBaselineEntry(value: unknown): TocBaselineEntry | null {
  if (!isRecord(value)) return null;
  const { title, printedPage, level, source, kind } = value;
  if (typeof title !== 'string' || !title) return null;
  if (typeof printedPage !== 'number' || !Number.isSafeInteger(printedPage) || printedPage < 1) return null;
  if (typeof level !== 'number' || !Number.isSafeInteger(level) || level < 1) return null;
  if (source !== 'geometry' && source !== 'text' && source !== 'table') return null;
  if (kind !== 'lesson' && kind !== 'section') return null;
  return { title, printedPage, level, source, kind };
}

function narrowRange(value: unknown): { fromPage: number; toPage: number } | null {
  if (!isRecord(value)) return null;
  const { fromPage, toPage } = value;
  if (typeof fromPage !== 'number' || typeof toPage !== 'number') return null;
  if (!Number.isSafeInteger(fromPage) || !Number.isSafeInteger(toPage)) return null;
  if (fromPage < 1 || toPage < fromPage) return null;
  return { fromPage, toPage };
}

/** extract-toc 负载收窄（纯函数）。 */
export function narrowTocBaseline(payload: unknown): TocBaselineData | null {
  if (!isRecord(payload)) return null;
  const { status, range, pageCount, entries, diagnostics, embedded } = payload;
  if (status !== 'ok' && status !== 'empty') return null;
  const narrowedRange = narrowRange(range);
  if (!narrowedRange || typeof pageCount !== 'number' || !Number.isSafeInteger(pageCount)) return null;
  if (!Array.isArray(entries) || !isRecord(diagnostics)) return null;
  const narrowedEntries: TocBaselineEntry[] = [];
  for (const item of entries) {
    const entry = narrowBaselineEntry(item);
    if (!entry) return null;
    narrowedEntries.push(entry);
  }
  const counts = ['pagesRequested', 'pagesOcr', 'linesConsidered', 'linesDroppedWash', 'entriesAccepted', 'entriesRejected'].map(
    (key) => (diagnostics as Record<string, unknown>)[key]
  );
  if (counts.some((c) => typeof c !== 'number' || !Number.isSafeInteger(c))) return null;
  const [pagesRequested, pagesOcr, linesConsidered, linesDroppedWash, entriesAccepted, entriesRejected] = counts as [
    number, number, number, number, number, number,
  ];
  return {
    status,
    range: narrowedRange,
    pageCount,
    entries: narrowedEntries,
    diagnostics: { pagesRequested, pagesOcr, linesConsidered, linesDroppedWash, entriesAccepted, entriesRejected },
    embedded: embedded === true,
  };
}

function narrowDraftEntry(value: unknown): TocReviewDraftEntry | null {
  if (!isRecord(value)) return null;
  const { title, printedPage, level, kind, confidence } = value;
  if (typeof title !== 'string' || !title) return null;
  if (typeof printedPage !== 'number' || !Number.isSafeInteger(printedPage) || printedPage < 1) return null;
  if (level !== 1 && level !== 2) return null;
  if (kind !== 'lesson' && kind !== 'section') return null;
  if (confidence !== 'high' && confidence !== 'medium' && confidence !== 'low') return null;
  return { title, printedPage, level, kind, confidence };
}

/** review-toc 负载收窄（纯函数；draft 为 null 仅 embedded 时合法）。 */
export function narrowTocReview(payload: unknown): TocReviewData | null {
  if (!isRecord(payload)) return null;
  const { embedded, range, pageCount, baseline, draft, diagnostics } = payload;
  const narrowedRange = narrowRange(range);
  if (!narrowedRange || typeof pageCount !== 'number' || !Number.isSafeInteger(pageCount)) return null;
  const narrowedBaseline = narrowTocBaseline(baseline);
  if (!narrowedBaseline || !isRecord(diagnostics)) return null;
  const diagCounts = ['pagesRequested', 'pagesRendered', 'baselineEntries', 'draftEntries'].map(
    (key) => (diagnostics as Record<string, unknown>)[key]
  );
  if (diagCounts.some((c) => typeof c !== 'number' || !Number.isSafeInteger(c))) return null;
  const [pagesRequested, pagesRendered, baselineEntries, draftEntries] = diagCounts as [number, number, number, number];
  if (embedded === true) {
    if (draft !== null) return null;
    return {
      embedded: true,
      range: narrowedRange,
      pageCount,
      baseline: narrowedBaseline,
      draft: null,
      diagnostics: { pagesRequested, pagesRendered, baselineEntries, draftEntries },
    };
  }
  if (!isRecord(draft) || !Array.isArray(draft.entries) || !Array.isArray(draft.warnings)) return null;
  const entries: TocReviewDraftEntry[] = [];
  for (const item of draft.entries) {
    const entry = narrowDraftEntry(item);
    if (!entry) return null;
    entries.push(entry);
  }
  const warnings: string[] = [];
  for (const item of draft.warnings) {
    if (typeof item !== 'string') return null;
    warnings.push(item);
  }
  return {
    embedded: false,
    range: narrowedRange,
    pageCount,
    baseline: narrowedBaseline,
    draft: { entries, warnings },
    diagnostics: { pagesRequested, pagesRendered, baselineEntries, draftEntries },
  };
}

/** 本地可编辑条目（仅浏览器 state；key 为行号派生，不做持久化 id）。 */
export interface EditableTocEntry {
  key: string;
  title: string;
  printedPage: string;
  level: 1 | 2;
  kind: TocBaselineEntryKind;
  confidence: TocDraftConfidence | null;
}

export function toEditableEntries(
  entries: Array<{ title: string; printedPage: number; level: number; kind: TocBaselineEntryKind }>,
  confidences?: Array<TocDraftConfidence | null>
): EditableTocEntry[] {
  return entries.map((entry, index) => ({
    key: `toc-edit-${index}`,
    title: entry.title,
    printedPage: String(entry.printedPage),
    level: entry.level === 1 ? 1 : 2,
    kind: entry.kind,
    confidence: confidences?.[index] ?? null,
  }));
}

export type TocAdoptSource = 'ocr' | 'ai';

/** 确认摘要（纯函数）：只描述本地状态，不触网络，不写存储。 */
export function summarizeConfirmedEntries(
  source: TocAdoptSource,
  range: { fromPage: number; toPage: number },
  entries: EditableTocEntry[]
): string {
  const lessons = entries.filter((e) => e.kind === 'lesson').length;
  const sections = entries.length - lessons;
  const sourceLabel = source === 'ocr' ? 'OCR 基线' : 'AI 草稿';
  return `已确认${entries.length} 条（${lessons} 课 · ${sections} 节），来源：${sourceLabel}，目录页第 ${range.fromPage}–${range.toPage} 页。`;
}

export interface TocConfirmState {
  /** 用户手选的候选下标；null = 未选（绝不自动选）。 */
  selectedIndex: number | null;
  startText: string;
  endText: string;
  adopted: TocAdoptSource | null;
  editing: boolean;
  editedEntries: EditableTocEntry[];
  confirmed: boolean;
  confirmedSummary: string | null;
}

export const initialTocConfirmState: TocConfirmState = {
  selectedIndex: null,
  startText: '',
  endText: '',
  adopted: null,
  editing: false,
  editedEntries: [],
  confirmed: false,
  confirmedSummary: null,
};

export type TocConfirmAction =
  | { type: 'select-candidate'; index: number; candidate: TocDiscoveryCandidate }
  | { type: 'set-range'; start: string; end: string }
  | { type: 'adopt'; source: TocAdoptSource; entries: EditableTocEntry[] }
  | { type: 'start-edit' }
  | { type: 'update-entry'; key: string; patch: Partial<EditableTocEntry> }
  | { type: 'confirm'; range: { fromPage: number; toPage: number } }
  | { type: 'clear-results' }
  | { type: 'reset-flow' };

/**
 * 确认流程 reducer（纯函数）：选择/采纳/编辑/确认只改本地 state。
 * - select-candidate：下标越界直接忽略（不崩溃、不猜）。
 * - confirm：只生成摘要置 confirmed，不发任何请求（零写的另一半由组件保证：onConfirm 不调 mutation）。
 */
export function tocConfirmReducer(state: TocConfirmState, action: TocConfirmAction): TocConfirmState {
  switch (action.type) {
    case 'select-candidate':
      if (!Number.isSafeInteger(action.index) || action.index < 0) return state;
      return {
        ...state,
        selectedIndex: action.index,
        startText: String(action.candidate.fromPage),
        endText: String(action.candidate.toPage),
        confirmed: false,
        confirmedSummary: null,
      };
    case 'set-range':
      return { ...state, startText: action.start, endText: action.end, confirmed: false, confirmedSummary: null };
    case 'adopt':
      return {
        ...state,
        adopted: action.source,
        editing: false,
        editedEntries: action.entries.map((entry) => ({ ...entry })),
        confirmed: false,
        confirmedSummary: null,
      };
    case 'start-edit':
      if (!state.adopted || state.editedEntries.length === 0) return state;
      return { ...state, editing: true, confirmed: false, confirmedSummary: null };
    case 'update-entry':
      return {
        ...state,
        editedEntries: state.editedEntries.map((entry) =>
          entry.key === action.key ? { ...entry, ...action.patch, key: entry.key } : entry
        ),
        confirmed: false,
        confirmedSummary: null,
      };
    case 'confirm': {
      if (!state.adopted || state.editedEntries.length === 0) return state;
      return {
        ...state,
        editing: false,
        confirmed: true,
        confirmedSummary: summarizeConfirmedEntries(state.adopted, action.range, state.editedEntries),
      };
    }
    case 'reset-flow':
      return { ...initialTocConfirmState };
    case 'clear-results':
      return {
        ...state,
        adopted: null,
        editing: false,
        editedEntries: [],
        confirmed: false,
        confirmedSummary: null,
      };
    default:
      return state;
  }
}
