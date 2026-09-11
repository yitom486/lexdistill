import { BusinessError, err, logger, ok, type Result } from '@study-studio/shared';
import { ensurePdfRuntime, type PdfInspectorLike } from './pdf-runtime.js';
import {
  EXERCISE_RE,
  LESSON_TOKEN_RE,
  TABLE_ROW_RE,
  TRAILING_PAGE_RE,
} from './toc-discovery.js';
import {
  probePdfPageCount,
  rangePages,
  validatePdfInput,
  MAX_OCR_PAGES_PER_IMPORT,
  type PdfImportServiceDeps,
} from './pdf-import-service.js';
import { classifyEmbeddedOutline, isSemanticOutlineTitle } from './embedded-outline-quality.js';

/**
 * CMD-LINGUA-P3：已确认目录页范围的本地 OCR 目录基线（只读，后端）。
 *
 * 调用方确认 fromPage/toPage 后，对该范围做本地 OCR，产出可审阅的
 * `title + printedPage + level + source + kind` 草稿。
 * 不写 DB/AST/cache，不切课，不触 Azure/Agent，不存 OCR 原文
 *（页文本与 spans 只在内存里过一遍解析函数）。
 *
 * printedPage 是目录上印刷页码：只取目录行自带的数字，绝不猜成 PDF 物理页，
 * 也不拿 pageCount 去卡它（印刷页 ≠ 物理页）。
 * kind 保守二值：有课号 token 才为 lesson，其余一律 section（绝不把会話/練習伪装成课）。
 * level 扁平两级（lesson=1、section=2），真层级留给 P4/P5 确认。
 */

/** 范围窗上限（页）：恒 ≤ 单次 OCR 上限，绝不抬高（跟随 OCR 上限只降不升）。 */
export const TOC_BASELINE_MAX_PAGES = Math.min(30, MAX_OCR_PAGES_PER_IMPORT);

/** geometry 证据的 span 置信度下限；低于此只降级为文本证据，不直接毙掉条目。 */
export const TOC_BASELINE_MIN_CONFIDENCE = 0.5;

/** 数字汤判定：一行内独立数字 token 达到此数即拒绝（课号+页码正常行为 2 个）。 */
export const TOC_BASELINE_SOUP_NUMBERS = 3;

/** 页眉/页脚位置：行号 <2 为头，行号 ≥ 行数-2 为尾（近似几何位置证据）。 */
const HEAD_TAIL_EDGE = 2;

export type TocBaselineEntryKind = 'lesson' | 'section';
export type TocBaselineEntrySource = 'geometry' | 'text' | 'table';

export interface TocBaselineEntry {
  title: string;
  printedPage: number;
  level: number;
  source: TocBaselineEntrySource;
  kind: TocBaselineEntryKind;
}

export type TocBaselineStatus = 'ok' | 'empty';

/**
 * CMD-LINGUA-P3.1B 基线质量 verdict（显式数据，不只看 entries.length）：
 * - usable：≥2 条有效条目，可采用；
 * - thin：0<有效条目<2，或标题大面积存疑——不可直接采用，下游服务端拒绝；
 * - empty：0 条有效条目。
 * 前端禁用只是辅助，真正保护在服务端各入口。
 */
export type TocBaselineVerdict = 'usable' | 'thin' | 'empty';

/** 可采用下限（条）：低于此为 thin（P2.2 语义门槛的基线版，同等保守）。 */
export const TOC_BASELINE_MIN_USABLE_ENTRIES = 2;

/** 单页 OCR 证据上限（字符）：展示用截断，防大页刷屏；证据只读，不入库不记日志。 */
export const TOC_EVIDENCE_MAX_CHARS_PER_PAGE = 1500;

export interface TocBaselineDiagnostics {
  pagesRequested: number;
  pagesOcr: number;
  linesConsidered: number;
  linesDroppedWash: number;
  entriesAccepted: number;
  entriesRejected: number;
  /** 标题无语义内容被拒的行数（符号-only/Markdown 残留/纯数字形，不记原文）。 */
  badTitle: number;
}

export interface TocBaselineOutput {
  status: TocBaselineStatus;
  /** P3.1B 质量 verdict（下游 review/preview/import 强制消费）。 */
  verdict: TocBaselineVerdict;
  range: { fromPage: number; toPage: number };
  pageCount: number;
  entries: TocBaselineEntry[];
  /** 仅计数：无标题、无正文、无页文本。 */
  diagnostics: TocBaselineDiagnostics;
  /**
   * 每页受限 OCR 证据（只读展示用）：保留行原文按页拼接、每页截断；
   * 不入库、不记日志、不参与判定。embedded 短路时为空。
   */
  pageEvidence: Array<{ page: number; excerpt: string }>;
  /**
   * true = 原生目录可用，本次零 OCR（entries 为空；
   * 调用方应直接用 map 的 embeddedOutline，而非 OCR 找目录）。
   */
  embedded: boolean;
}

export interface TocBaselineInput {
  userId: string;
  filename: string;
  bytes: Uint8Array;
  fromPage: number;
  toPage: number;
}

interface WashedLine {
  page: number;
  text: string;
}

interface WashedLine {
  page: number;
  text: string;
}

export interface TocWashResult {
  kept: WashedLine[];
  dropped: number;
}

/**
 * 保守清洗：跨页重复 + 近似几何位置（头/尾）才删。
 * 表格行、尾页码形、课号 token、短标题（<4 字）永不删；位置不一致（头一次尾一次）不删。
 * 纯函数。
 */
export function washRepeatedTocLines(pages: Array<{ page: number; lines: string[] }>): TocWashResult {
  const occurrences = new Map<string, Array<{ page: number; index: number; total: number }>>();
  for (const pg of pages) {
    pg.lines.forEach((raw, index) => {
      const text = raw.trim();
      if (!text) return;
      const list = occurrences.get(text) ?? [];
      list.push({ page: pg.page, index, total: pg.lines.length });
      occurrences.set(text, list);
    });
  }
  const positionOf = (o: { index: number; total: number }): 'head' | 'tail' | 'body' => {
    if (o.index < HEAD_TAIL_EDGE) return 'head';
    if (o.index >= o.total - HEAD_TAIL_EDGE) return 'tail';
    return 'body';
  };
  const droppable = new Set<string>();
  for (const [text, list] of occurrences) {
    if (list.length < 2) continue;
    if (text.length < 4) continue;
    if (LESSON_TOKEN_RE.test(text)) continue;
    if (TRAILING_PAGE_RE.test(text)) continue;
    if (TABLE_ROW_RE.test(text)) continue;
    const positions = new Set(list.map(positionOf));
    if (positions.size === 1 && (positions.has('head') || positions.has('tail'))) {
      droppable.add(text);
    }
  }
  const kept: WashedLine[] = [];
  let dropped = 0;
  for (const pg of pages) {
    for (const raw of pg.lines) {
      const text = raw.trim();
      if (!text) continue;
      if (droppable.has(text)) {
        dropped++;
        continue;
      }
      kept.push({ page: pg.page, text });
    }
  }
  return { kept, dropped };
}

type LineEntry = { title: string; printedPage: number; tableRow: boolean } | { refused: string } | null;

/**
 * Markdown 行标记剥离（纯函数）：OCR markdown 常把大号文字变成 `#` 标题、
 * 列表变成 `- `，这些残留不属于目录标题内容，先剥再做语义判定。
 * 剥后仍无语义才拒绝；判定用 P2.2 唯一语义规则（不复制第二套）。
 */
export function stripMarkdownLineMarkers(title: string): string {
  return title
    .replace(/^[#>\-*+\s]+/, '')
    .replace(/[#*]+$/, '')
    .trim();
}

/**
 * 单行目录候选抽取（纯函数）：表格行取末格数字为页、余格为题；
 * 否则取行尾页码形；习题正文/数字汤/无题表格/无语义标题直接拒绝；
 * 其余返回 null（非条目行）。
 */
export function extractTocLineEntry(line: string): LineEntry {
  const text = line.trim();
  if (!text) return null;
  if (EXERCISE_RE.test(text)) return { refused: 'exercise' };
  const numbers = text.match(/\d+/g) ?? [];
  if (numbers.length >= TOC_BASELINE_SOUP_NUMBERS) return { refused: 'digit-soup' };
  if (TABLE_ROW_RE.test(text)) {
    const cells = text
      .split(/[|｜]/)
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    const last = cells[cells.length - 1] ?? '';
    const pageMatch = /^(\d{1,4})$/.exec(last);
    if (!pageMatch || cells.length < 2) return { refused: 'no-title' };
    const title = cells.slice(0, -1).join(' ');
    if (!isSemanticOutlineTitle(stripMarkdownLineMarkers(title))) return { refused: 'bad-title' };
    return { title, printedPage: Number(pageMatch[1]), tableRow: true };
  }
  const trailing = TRAILING_PAGE_RE.exec(text);
  if (trailing) {
    const title = (trailing[1] ?? '').trim();
    if (!title) return { refused: 'no-title' };
    if (!isSemanticOutlineTitle(stripMarkdownLineMarkers(title))) return { refused: 'bad-title' };
    return { title, printedPage: Number(trailing[2]), tableRow: false };
  }
  return null;
}

/** kind 判定（纯函数）：有课号 token 才为 lesson，其余一律 section。 */
export function classifyTocEntryKind(title: string): TocBaselineEntryKind {
  return LESSON_TOKEN_RE.test(title) ? 'lesson' : 'section';
}

export interface TocGeometrySpan {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence?: number;
}

function narrowSpan(raw: unknown): TocGeometrySpan | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.text !== 'string') return null;
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    if (typeof rec[key] !== 'number' || !Number.isFinite(rec[key])) return null;
  }
  const confidence = typeof rec.confidence === 'number' ? rec.confidence : undefined;
  return {
    text: rec.text,
    x: rec.x as number,
    y: rec.y as number,
    width: rec.width as number,
    height: rec.height as number,
    ...(confidence === undefined ? {} : { confidence }),
  };
}

/**
 * 几何验证（纯函数）：同页 spans 里是否存在一行，其规范化文本同时包含标题、
 * 以该页码结尾，且 span 置信度达标。span 即行，不再做行聚类。
 * 低置信返回 false（调用方降级为文本/表格证据，不毙条目）。
 */
export function verifyTocGeometry(
  spans: TocGeometrySpan[],
  title: string,
  printedPage: number
): boolean {
  const norm = (s: string): string => s.replace(/[|｜]/g, ' ').replace(/\s+/g, ' ').trim();
  const wantedTitle = norm(title);
  const wantedPage = String(printedPage);
  if (!wantedTitle) return false;
  for (const span of spans) {
    if (span.confidence !== undefined && span.confidence < TOC_BASELINE_MIN_CONFIDENCE) continue;
    const text = norm(span.text);
    if (text.includes(wantedTitle) && text.endsWith(wantedPage)) return true;
  }
  return false;
}

/**
 * 已确认范围 OCR 目录基线编排（只读）：范围校验 → 探页数 → 越界校验 →
 * embedded 短路 → OCR 该范围 → 清洗 → 逐行抽取 → 几何定级。
 * 不写 DB/AST/cache；OCR 原文不出本函数；日志只记计数。
 */
export async function extractTocBaseline(
  deps: Pick<PdfImportServiceDeps, 'loadInspector' | 'runtimeDir'>,
  input: TocBaselineInput
): Promise<Result<TocBaselineOutput, BusinessError>> {
  const valid = validatePdfInput({ userId: input.userId, filename: input.filename, bytes: input.bytes });
  if (!valid.ok) return err(valid.error);
  const { fromPage, toPage } = input;
  if (
    !Number.isInteger(fromPage) ||
    !Number.isInteger(toPage) ||
    fromPage < 1 ||
    toPage < fromPage
  ) {
    return err(new BusinessError('E_INVALID_INPUT', '请提供已确认的目录页范围（fromPage/toPage，非空且 fromPage ≤ toPage）', 'VALIDATION'));
  }
  if (toPage - fromPage + 1 > TOC_BASELINE_MAX_PAGES) {
    return err(
      new BusinessError(
        'E_INVALID_INPUT',
        `确认范围共 ${toPage - fromPage + 1} 页（单次上限 ${TOC_BASELINE_MAX_PAGES} 页），请缩小后重试`,
        'VALIDATION'
      )
    );
  }
  let inspector: PdfInspectorLike;
  try {
    const runtime = await ensurePdfRuntime({
      ...(deps.loadInspector ? { loadInspector: deps.loadInspector } : {}),
      ...(deps.runtimeDir ? { runtimeDir: deps.runtimeDir } : {}),
      needOcr: false,
    });
    inspector = runtime.inspector;
  } catch (e) {
    return err(
      e instanceof BusinessError
        ? e
        : new BusinessError('E_RUNTIME_LOAD', 'PDF 解析运行时准备失败，请检查网络后重试', 'NETWORK')
    );
  }
  // 诚实页数（[1] 轻探针，不扫全书），再验范围越界——都在 OCR 之前。
  const pageCount = probePdfPageCount(inspector, input.bytes);
  if (!Number.isFinite(pageCount) || pageCount < 1) {
    return err(new BusinessError('E_PDF_PARSE', 'PDF 页数识别失败，文件可能已损坏', 'TOOL_EXECUTION'));
  }
  if (toPage > pageCount) {
    return err(
      new BusinessError('E_INVALID_INPUT', `确认范围超出本书（本书共 ${pageCount} 页）`, 'VALIDATION')
    );
  }
  // P2.2 唯一质量门：usable 才短路；none/unusable 走 OCR（日志只记状态/reason/计数）。
  const outlineQuality = classifyEmbeddedOutline(inspector, input.bytes, pageCount);
  if (outlineQuality.quality === 'usable') {
    return ok({
      status: 'empty',
      verdict: 'empty',
      range: { fromPage, toPage },
      pageCount,
      entries: [],
      diagnostics: {
        pagesRequested: toPage - fromPage + 1,
        pagesOcr: 0,
        linesConsidered: 0,
        linesDroppedWash: 0,
        entriesAccepted: 0,
        entriesRejected: 0,
        badTitle: 0,
      },
      pageEvidence: [],
      embedded: true,
    });
  }
  const window = rangePages(fromPage, toPage);
  // 先窗分类看是否需要 OCR runtime（与 map/discovery 同口径，不多花一次模型下载）。
  const cls = inspector.processPdf(input.bytes, window);
  const windowNeeding = Array.isArray(cls.pagesNeedingOcr)
    ? cls.pagesNeedingOcr.filter((n): n is number => typeof n === 'number')
    : [];
  let ocrPages: number[] = [];
  const markdownByPage = new Map<number, string>();
  const spansByPage = new Map<number, TocGeometrySpan[]>();
  try {
    const runtime = await ensurePdfRuntime({
      ...(deps.loadInspector ? { loadInspector: deps.loadInspector } : {}),
      ...(deps.runtimeDir ? { runtimeDir: deps.runtimeDir } : {}),
      needOcr: window.some((p) => windowNeeding.includes(p)),
    });
    inspector = runtime.inspector;
    const ocr = await inspector.processPdfWithOcr(input.bytes, { pageNumbers: window });
    const perPage = Array.isArray(ocr.pages) ? ocr.pages : [];
    for (const pg of perPage) {
      if (typeof pg.pageNumber !== 'number' || typeof pg.markdown !== 'string') continue;
      markdownByPage.set(pg.pageNumber, pg.markdown);
      const spans: TocGeometrySpan[] = [];
      const rawSpans: unknown = (pg as { spans?: unknown }).spans;
      if (Array.isArray(rawSpans)) {
        for (const raw of rawSpans) {
          const narrowed = narrowSpan(raw);
          if (narrowed) spans.push(narrowed);
        }
      }
      spansByPage.set(pg.pageNumber, spans);
    }
    ocrPages = Array.isArray(ocr.pagesRoutedToOcr)
      ? ocr.pagesRoutedToOcr.filter((n): n is number => typeof n === 'number')
      : [];
  } catch (e) {
    return err(
      e instanceof BusinessError
        ? e
        : new BusinessError('E_PDF_PARSE', '目录基线 OCR 失败，请稍后重试', 'TOOL_EXECUTION')
    );
  }
  const washed = washRepeatedTocLines(
    window.map((p) => ({ page: p, lines: (markdownByPage.get(p) ?? '').split('\n') }))
  );
  const entries: TocBaselineEntry[] = [];
  let rejected = 0;
  let badTitle = 0;
  const keptByPage = new Map<number, WashedLine[]>();
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
  for (const page of window) {
    for (const line of keptByPage.get(page) ?? []) {
      const parsed = extractTocLineEntry(line.text);
      if (parsed === null) continue;
      if ('refused' in parsed) {
        rejected++;
        if (parsed.refused === 'bad-title') badTitle++;
        continue;
      }
      const spans = spansByPage.get(page) ?? [];
      const geometry = verifyTocGeometry(spans, parsed.title, parsed.printedPage);
      const kind = classifyTocEntryKind(parsed.title);
      entries.push({
        title: parsed.title,
        printedPage: parsed.printedPage,
        level: kind === 'lesson' ? 1 : 2,
        source: geometry ? 'geometry' : parsed.tableRow ? 'table' : 'text',
        kind,
      });
    }
  }
  // 只记计数：不记标题、不记正文、不记 spans、不记 evidence。
  logger.warn('[toc-baseline] 完成', {
    range: `${fromPage}-${toPage}`,
    entries: entries.length,
    rejected,
    badTitle,
    washed: washed.dropped,
    ocrPages: ocrPages.length,
  });
  const verdict: TocBaselineVerdict =
    entries.length === 0 ? 'empty' : entries.length < TOC_BASELINE_MIN_USABLE_ENTRIES ? 'thin' : 'usable';
  const pageEvidence = window.map((page) => {
    const excerpt = (evidenceByPage.get(page) ?? []).join('\n');
    return {
      page,
      excerpt:
        excerpt.length > TOC_EVIDENCE_MAX_CHARS_PER_PAGE
          ? `${excerpt.slice(0, TOC_EVIDENCE_MAX_CHARS_PER_PAGE)}…(已截断)`
          : excerpt,
    };
  });
  return ok({
    status: entries.length > 0 ? 'ok' : 'empty', verdict,
    range: { fromPage, toPage },
    pageCount,
    entries,
    diagnostics: {
      pagesRequested: window.length,
      pagesOcr: ocrPages.length,
      linesConsidered: washed.kept.length + washed.dropped,
      linesDroppedWash: washed.dropped,
      entriesAccepted: entries.length,
      entriesRejected: rejected,
      badTitle,
    },
    pageEvidence,
    embedded: false,
  });
}
