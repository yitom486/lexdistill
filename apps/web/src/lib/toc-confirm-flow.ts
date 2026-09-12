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
/** P3.2B 条目来源三态（与网关一致；旧网关 geometry/table 在收窄时映射）。 */
export type TocBaselineEntrySource = 'geometry-block' | 'text-fallback';

export interface TocBaselineEntry {
  title: string;
  printedPage: number;
  level: number;
  source: TocBaselineEntrySource;
  kind: TocBaselineEntryKind;
}

export interface TocBaselineData {
  status: 'ok' | 'empty';
  /** P3.1B 质量 verdict（usable/thin/empty；旧网关缺席按条数回填）。 */
  verdict: 'usable' | 'thin' | 'empty';
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
    /** 无语义标题被拒行数（缺席回填 0）。 */
    badTitle: number;
    /** 版式块产出条目数（旧网关缺席回填 0）。 */
    entriesFromBlocks: number;
    /** 版式块未定位标题数（旧网关缺席回填 0）。 */
    unresolvedBlocks: number;
  };
  /** 每页受限 OCR 证据（只读展示；缺席回填 []）。 */
  pageEvidence: Array<{ page: number; excerpt: string }>;
  embedded: boolean;
}

export type TocDraftConfidence = 'high' | 'medium' | 'low';

export interface TocReviewDraftEntry {
  /** 条目 id（基线 b{index} / 新增 n{counter}；旧网关缺席时按下标回填）。 */
  entryId: string;
  title: string;
  printedPage: number;
  level: 1 | 2;
  kind: TocBaselineEntryKind;
  /** AI 置信度；null = OCR 原文保留、未经 AI 判定（展示为“—”）。 */
  confidence: TocDraftConfidence | null;
  needsReview: boolean;
}

export interface TocReviewDiffSide {
  title: string;
  printedPage: number;
  level: 1 | 2;
  kind: TocBaselineEntryKind;
  confidence: TocDraftConfidence | null;
}

export type TocReviewDiffChange = 'keep' | 'add' | 'update' | 'remove';

export interface TocReviewDiffRow {
  entryId: string;
  change: TocReviewDiffChange;
  before: TocReviewDiffSide | null;
  after: TocReviewDiffSide | null;
  reason: string | null;
  needsReview: boolean;
}

export interface TocReviewDraft {
  entries: TocReviewDraftEntry[];
  warnings: string[];
  /** 按 entryId 对齐的 diff（旧网关缺席回填 []）。 */
  diff: TocReviewDiffRow[];
}

export interface TocReviewData {
  embedded: boolean;
  range: { fromPage: number; toPage: number };
  pageCount: number;
  baseline: TocBaselineData;
  draft: TocReviewDraft | null;
  /** P3.1B 审核可用态（ok/unavailable；旧网关缺席回填 ok）。 */
  reviewStatus: 'ok' | 'unavailable';
  /** unavailable 时的安全错误（缺席回填 null；永不含模型原文）。 */
  reviewError: { code: string; userMessage: string } | null;
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
 * P3.2A thin/empty 一律放行：证据是否充足由服务端 reviewable 门判定，前端不猜
 * （证据不足服务端会返回可读错误，零模型调用）。
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
  // 旧网关兼容：geometry→geometry-block、text/table→text-fallback（混合部署不断线）。
  const mappedSource =
    source === 'geometry' || source === 'geometry-block'
      ? 'geometry-block'
      : source === 'text' || source === 'table' || source === 'text-fallback'
        ? 'text-fallback'
        : null;
  if (!mappedSource) return null;
  if (kind !== 'lesson' && kind !== 'section') return null;
  return { title, printedPage, level, source: mappedSource, kind };
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
  const badTitleRaw = (diagnostics as Record<string, unknown>).badTitle;
  const badTitle = typeof badTitleRaw === 'number' && Number.isSafeInteger(badTitleRaw) && badTitleRaw >= 0 ? badTitleRaw : 0;
  // P3.2B 新增计数缺席（旧网关）回填 0；非法值同样回填 0（只读展示，不影响守门）。
  const extra = (key: 'entriesFromBlocks' | 'unresolvedBlocks'): number => {
    const raw = (diagnostics as Record<string, unknown>)[key];
    return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : 0;
  };
  const entriesFromBlocks = extra('entriesFromBlocks');
  const unresolvedBlocks = extra('unresolvedBlocks');
  // verdict 缺席（旧网关）按条数回填；非法值回填 none→按规则重算
  const verdictRaw = (payload as Record<string, unknown>).verdict;
  const verdict: TocBaselineData['verdict'] =
    verdictRaw === 'usable' || verdictRaw === 'thin' || verdictRaw === 'empty'
      ? verdictRaw
      : narrowedEntries.length === 0
        ? 'empty'
        : narrowedEntries.length < 2
          ? 'thin'
          : 'usable';
  // pageEvidence 缺席回填 []；逐项收窄（page 正整数 + excerpt 字符串，上限 4k 防刷屏）
  const pageEvidence: TocBaselineData['pageEvidence'] = [];
  const evidenceRaw = (payload as Record<string, unknown>).pageEvidence;
  if (evidenceRaw !== undefined) {
    if (!Array.isArray(evidenceRaw)) return null;
    for (const item of evidenceRaw) {
      if (!isRecord(item)) return null;
      const { page, excerpt } = item;
      if (typeof page !== 'number' || !Number.isSafeInteger(page) || page < 1) return null;
      if (typeof excerpt !== 'string' || excerpt.length > 4096) return null;
      pageEvidence.push({ page, excerpt });
    }
  }
  return {
    status,
    verdict,
    range: narrowedRange,
    pageCount,
    entries: narrowedEntries,
    diagnostics: { pagesRequested, pagesOcr, linesConsidered, linesDroppedWash, entriesAccepted, entriesRejected, badTitle, entriesFromBlocks, unresolvedBlocks },
    pageEvidence,
    embedded: embedded === true,
  };
}

function narrowDraftEntry(value: unknown, fallbackId: string): TocReviewDraftEntry | null {
  if (!isRecord(value)) return null;
  const { entryId, title, printedPage, level, kind, confidence, needsReview } = value;
  if (typeof title !== 'string' || !title) return null;
  if (typeof printedPage !== 'number' || !Number.isSafeInteger(printedPage) || printedPage < 1) return null;
  if (level !== 1 && level !== 2) return null;
  if (kind !== 'lesson' && kind !== 'section') return null;
  // confidence：新契约可为 null（OCR 保留行）；旧网关恒有值；非法值收敛为 null 不整包丢弃。
  const narrowedConfidence: TocDraftConfidence | null =
    confidence === 'high' || confidence === 'medium' || confidence === 'low' ? confidence : null;
  return {
    entryId: typeof entryId === 'string' && entryId ? entryId : fallbackId,
    title,
    printedPage,
    level,
    kind,
    confidence: narrowedConfidence,
    needsReview: needsReview === true,
  };
}

function narrowDiffSide(value: unknown): TocReviewDiffSide | null {
  if (!isRecord(value)) return null;
  const { title, printedPage, level, kind, confidence } = value;
  if (typeof title !== 'string' || !title) return null;
  if (typeof printedPage !== 'number' || !Number.isSafeInteger(printedPage) || printedPage < 1) return null;
  if (level !== 1 && level !== 2) return null;
  if (kind !== 'lesson' && kind !== 'section') return null;
  return {
    title,
    printedPage,
    level,
    kind,
    confidence: confidence === 'high' || confidence === 'medium' || confidence === 'low' ? confidence : null,
  };
}

function narrowDiffRow(value: unknown): TocReviewDiffRow | null {
  if (!isRecord(value)) return null;
  const { entryId, change, before, after, reason, needsReview } = value;
  if (typeof entryId !== 'string' || !entryId) return null;
  if (change !== 'keep' && change !== 'add' && change !== 'update' && change !== 'remove') return null;
  let narrowedBefore: TocReviewDiffSide | null = null;
  if (before !== null && before !== undefined) {
    narrowedBefore = narrowDiffSide(before);
    if (!narrowedBefore) return null;
  }
  let narrowedAfter: TocReviewDiffSide | null = null;
  if (after !== null && after !== undefined) {
    narrowedAfter = narrowDiffSide(after);
    if (!narrowedAfter) return null;
  }
  return {
    entryId,
    change,
    before: narrowedBefore,
    after: narrowedAfter,
    reason: typeof reason === 'string' && reason ? reason : null,
    needsReview: needsReview === true,
  };
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
  // reviewStatus 缺席（旧网关）回填 ok；reviewError 缺席回填 null
  const statusRaw = (payload as Record<string, unknown>).reviewStatus;
  const reviewStatus: TocReviewData['reviewStatus'] = statusRaw === 'unavailable' ? 'unavailable' : 'ok';
  let reviewError: TocReviewData['reviewError'] = null;
  const errorRaw = (payload as Record<string, unknown>).reviewError;
  if (errorRaw !== undefined && errorRaw !== null) {
    if (!isRecord(errorRaw) || typeof errorRaw.code !== 'string' || !errorRaw.code || typeof errorRaw.userMessage !== 'string' || !errorRaw.userMessage) {
      return null;
    }
    reviewError = { code: errorRaw.code, userMessage: errorRaw.userMessage };
  }
  if (embedded === true) {
    if (draft !== null) return null;
    return {
      embedded: true,
      range: narrowedRange,
      pageCount,
      baseline: narrowedBaseline,
      draft: null,
      reviewStatus,
      reviewError,
      diagnostics: { pagesRequested, pagesRendered, baselineEntries, draftEntries },
    };
  }
  if (draft === null) {
    // P3.1B unavailable 态：draft 为 null 合法（基线保留可编辑）；其他情况仍拒绝。
    if (reviewStatus !== 'unavailable') return null;
    return {
      embedded: false,
      range: narrowedRange,
      pageCount,
      baseline: narrowedBaseline,
      draft: null,
      reviewStatus,
      reviewError,
      diagnostics: { pagesRequested, pagesRendered, baselineEntries, draftEntries },
    };
  }
  if (!isRecord(draft) || !Array.isArray(draft.entries) || !Array.isArray(draft.warnings)) return null;  const entries: TocReviewDraftEntry[] = [];
  for (let index = 0; index < draft.entries.length; index++) {
    const entry = narrowDraftEntry(draft.entries[index], `draft-${index}`);
    if (!entry) return null;
    entries.push(entry);
  }
  const warnings: string[] = [];
  for (const item of draft.warnings) {
    if (typeof item !== 'string') return null;
    warnings.push(item);
  }
  // diff 缺席（旧网关）回填 []；存在则逐行收窄（坏行整包拒绝，与条目同口径）。
  const diff: TocReviewDiffRow[] = [];
  const diffRaw = (draft as Record<string, unknown>).diff;
  if (diffRaw !== undefined) {
    if (!Array.isArray(diffRaw)) return null;
    for (const item of diffRaw) {
      const row = narrowDiffRow(item);
      if (!row) return null;
      diff.push(row);
    }
  }
  return {
    embedded: false,
    range: narrowedRange,
    pageCount,
    baseline: narrowedBaseline,
    draft: { entries, warnings, diff },
    reviewStatus,
    reviewError,
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

/** diff 侧快照 → 可编辑行（remove 快照展示 / add 回退值用；key 取 entryId）。 */
export function diffSideToEditable(entryId: string, side: TocReviewDiffSide): EditableTocEntry {
  return {
    key: entryId,
    title: side.title,
    printedPage: String(side.printedPage),
    level: side.level === 1 ? 1 : 2,
    kind: side.kind,
    confidence: side.confidence,
  };
}

function baselineEntryToEditable(entryId: string, entry: TocBaselineEntry): EditableTocEntry {
  return {
    key: entryId,
    title: entry.title,
    printedPage: String(entry.printedPage),
    level: entry.level === 1 ? 1 : 2,
    kind: entry.kind,
    confidence: null,
  };
}

/**
 * P3.5-FIX2：编辑行是否实质偏离基线（标题/印刷页/层级/类型任一不同即脏）。
 * 纯函数：父级据此把“已选中但值未变”的 keep 当无操作，把“选中且变脏”的 keep
 * 当人工 update（Dialog 侧编辑即自动标记，此处双保险，绝不静默丢编辑）。
 */
export function isEditedAgainstBaseline(edited: EditableTocEntry, baseline: TocBaselineEntry): boolean {
  return (
    edited.title !== baseline.title ||
    edited.printedPage !== String(baseline.printedPage) ||
    edited.level !== (baseline.level === 1 ? 1 : 2) ||
    edited.kind !== baseline.kind
  );
}

export interface AiAdoptBuildInput {
  baselineEntries: TocBaselineEntry[];
  diff: TocReviewDiffRow[];
  /** 用户在结果 Dialog 内确认的操作 id（entryId 集合）。 */
  selectedIds: string[];
  /** 用户在结果 Dialog 内的当前编辑（entryId → 行）。 */
  editedById: Record<string, EditableTocEntry>;
}

/**
 * P3.5-FIX 父级采用链（纯函数）：以 baseline + 已确认操作构造完整有序 entries。
 * - keep → 基线原值；selected update → 当前编辑覆盖（缺编辑回退草稿 after）；
 *   selected add → 当前编辑插入（缺编辑回退草稿 after）；selected remove → 真正移除；
 * - 未选中操作一律保持基线（update 不覆盖、add 不插入、remove 不移除）；
 * - 顺序跟随 diff 顺序；绝不把 remove 的 diff.before 当作最终 entries；
 * - 未知 id 忽略（fail-closed，不捏造）。
 */
export function buildAiAdoptedEntries(input: AiAdoptBuildInput): EditableTocEntry[] {
  const selected = new Set(input.selectedIds);
  const out: EditableTocEntry[] = [];
  for (const row of input.diff) {
    const baselineMatch = /^b(\d+)$/.exec(row.entryId);
    const baselineEntry =
      baselineMatch === null ? undefined : input.baselineEntries[Number(baselineMatch[1])];
    const isSelected = selected.has(row.entryId);
    if (row.change === 'keep') {
      if (!baselineEntry) continue;
      const edited = input.editedById[row.entryId];
      // P3.5-FIX2：选中且变脏的 keep 视为人工 update（编辑即标记，值进最终 entries）；
      // 选中但未变脏 = 无操作；未选中 = 基线原值。三种情况都不丢编辑、不捏造。
      if (isSelected && edited && isEditedAgainstBaseline(edited, baselineEntry)) {
        out.push({ ...edited, key: row.entryId });
        continue;
      }
      out.push(baselineEntryToEditable(row.entryId, baselineEntry));
      continue;
    }
    if (row.change === 'update') {
      if (!baselineEntry) continue;
      if (!isSelected) {
        out.push(baselineEntryToEditable(row.entryId, baselineEntry));
        continue;
      }
      const edited = input.editedById[row.entryId];
      if (edited) {
        out.push({ ...edited, key: row.entryId });
        continue;
      }
      if (row.after) {
        out.push(diffSideToEditable(row.entryId, row.after));
        continue;
      }
      out.push(baselineEntryToEditable(row.entryId, baselineEntry));
      continue;
    }
    if (row.change === 'add') {
      if (!isSelected) continue;
      const edited = input.editedById[row.entryId];
      if (edited) {
        out.push({ ...edited, key: row.entryId });
        continue;
      }
      if (row.after) out.push(diffSideToEditable(row.entryId, row.after));
      continue;
    }
    // remove：选中才真正移除；未选中保持基线。before 永远只是证据快照，不进 entries。
    if (!isSelected && baselineEntry) {
      out.push(baselineEntryToEditable(row.entryId, baselineEntry));
    }
  }
  return out;
}

export interface TocReviewModelRequest {
  model?: string;
  effort?: string;
}

/** P3.5-FIX2 模型取值模式：跟随已保存偏好 / 强制默认 / 本次显式指定。 */
export type TocReviewModelMode = 'inherit' | 'default' | 'explicit';

export interface TocReviewModelSession {
  model: string;
  modelMode: TocReviewModelMode;
  effort: string;
  effortMode: TocReviewModelMode;
}

/**
 * P3.5-FIX2 配置优先级（纯函数）：inherit-saved / force-default / explicit。
 * - inherit → 用已保存偏好（空则缺席）；
 * - default → 强制默认：绝不回退已保存值，直接缺席；
 * - explicit → 用本次值（空白视为未填，按默认处理，同样缺席）。
 * 双缺席返回 {}（调用方不传，后端走环境变量 > 适配器默认）。
 */
export function resolveTocReviewModelRequest(options: {
  session: TocReviewModelSession;
  saved: TocReviewModelRequest;
}): TocReviewModelRequest {
  const pick = (
    mode: TocReviewModelMode,
    sessionValue: string | undefined,
    savedValue: string | undefined
  ): string | undefined => {
    if (mode === 'default') return undefined;
    if (mode === 'explicit') {
      const text = sessionValue?.trim();
      return text ? text : undefined;
    }
    const saved = savedValue?.trim();
    return saved ? saved : undefined;
  };
  const model = pick(options.session.modelMode, options.session.model, options.saved.model);
  const effort = pick(options.session.effortMode, options.session.effort, options.saved.effort);
  return {
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
  };
}

export interface TocRememberConfig {
  remember: boolean;
  model: string;
  modelMode: TocReviewModelMode;
  effort: string;
  effortMode: TocReviewModelMode;
}

/**
 * P3.5-FIX2-A1 remember 写语义（纯函数）：静默覆盖用户偏好是 P1 缺陷。
 * - explicit → 保存本次指定值；
 * - default → 清空已保存值（本次用服务端默认，下次亦然）；
 * - inherit → 缺席：不得写入、不得清空任何既有偏好（返回对象缺该键）。
 * 调用方只写返回对象中出现的键；remember 未勾选返回 {}。
 */
export function resolveRememberWrite(config: TocRememberConfig): { model?: string; effort?: string } {
  if (!config.remember) return {};
  const out: { model?: string; effort?: string } = {};
  if (config.modelMode === 'explicit') out.model = config.model;
  else if (config.modelMode === 'default') out.model = '';
  if (config.effortMode === 'explicit') out.effort = config.effort;
  else if (config.effortMode === 'default') out.effort = '';
  return out;
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

export type TocAdoptSource = 'ocr' | 'ai' | 'manual';

/** 确认摘要（纯函数）：只描述本地状态，不触网络，不写存储。 */
export function summarizeConfirmedEntries(
  source: TocAdoptSource,
  range: { fromPage: number; toPage: number },
  entries: EditableTocEntry[]
): string {
  const lessons = entries.filter((e) => e.kind === 'lesson').length;
  const sections = entries.length - lessons;
  const sourceLabel = source === 'ocr' ? 'OCR 基线' : source === 'ai' ? 'AI 草稿' : '手动填写';
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
  | { type: 'start-manual' }
  | { type: 'add-entry' }
  | { type: 'remove-entry'; key: string }
  | { type: 'start-edit' }
  | { type: 'update-entry'; key: string; patch: Partial<EditableTocEntry> }
  | { type: 'confirm'; range: { fromPage: number; toPage: number } }
  | { type: 'clear-results' }
  | { type: 'reset-flow' };

/** 空白手填行（纯函数）：保守默认 section/2 级，用户逐行改；绝不预填猜测。 */
export function blankEditableEntry(key: string): EditableTocEntry {
  return { key, title: '', printedPage: '', level: 2, kind: 'section', confidence: null };
}

/** 下一个手动行 key（纯函数）：扫描现有 toc-manual-N 取 max+1，不依赖外部计数。 */
export function nextManualKey(entries: EditableTocEntry[]): string {
  let max = -1;
  for (const entry of entries) {
    const match = /^toc-manual-(\d+)$/.exec(entry.key);
    if (match) {
      const n = Number(match[1]);
      if (Number.isSafeInteger(n) && n > max) max = n;
    }
  }
  return `toc-manual-${max + 1}`;
}

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
    case 'start-manual':
      // P3.1B thin/empty 手动建草稿：从空白行开始手填，不复制任何垃圾基线。
      return {
        ...state,
        adopted: 'manual',
        editing: true,
        editedEntries: [blankEditableEntry(nextManualKey(state.editedEntries))],
        confirmed: false,
        confirmedSummary: null,
      };
    case 'add-entry':
      if (!state.adopted || !state.editing) return state;
      return {
        ...state,
        editedEntries: [...state.editedEntries, blankEditableEntry(nextManualKey(state.editedEntries))],
        confirmed: false,
        confirmedSummary: null,
      };
    case 'remove-entry':
      if (!state.adopted || !state.editing) return state;
      return {
        ...state,
        editedEntries: state.editedEntries.filter((entry) => entry.key !== action.key),
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
