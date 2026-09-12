import { BusinessError, err, logger, ok, type Result } from '@study-studio/shared';
import { ensurePdfRuntime, type PdfInspectorLike } from './pdf-runtime.js';
import {
  EXERCISE_RE,
  LESSON_TOKEN_RE,
  TABLE_ROW_RE,
  TRAILING_PAGE_RE,
  stripMarkdownLineMarkers,
} from './toc-discovery.js';
import {
  probePdfPageCount,
  rangePages,
  validatePdfInput,
  MAX_OCR_PAGES_PER_IMPORT,
  type PdfImportServiceDeps,
} from './pdf-import-service.js';
import { classifyEmbeddedOutline, isSemanticOutlineTitle } from './embedded-outline-quality.js';
import { matchTocLayoutBlocks, normalizeTocBlockText } from './toc-layout-blocks.js';

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
/**
 * CMD-LINGUA-P3.2B 条目来源三态（UI 直接展示）：
 * - geometry-block：坐标版式证据（跨行关联/同行 span 验证/黏连拆分），确定性规则；
 * - text-fallback：无坐标时的 markdown 单行文本路径；
 * - ai-draft：仅前端展示 AI 草稿列的标签（网关永不产出）。
 */
export type TocBaselineEntrySource = 'geometry-block' | 'text-fallback';

export interface TocBaselineEntry {
  title: string;
  printedPage: number;
  level: number;
  source: TocBaselineEntrySource;
  kind: TocBaselineEntryKind;
}

export type TocBaselineStatus = 'ok' | 'empty';

/**
 * 未定位候选：标题有效（语义标题或课号 token）但文字层无页码的行。
 * 典型死法：右栏个位页码被 OCR 吞掉（如 `第1課……6` 的 `6`）。
 * title 已剥离 Markdown 行标记、不改写；page 为 PDF 物理页（对应图片附件页）。
 */
export interface TocUnresolvedCandidate {
  title: string;
  page: number;
}

/**
 * 无码有效标题判定（纯函数）：extractTocLineEntry 返回 null 的行里，
 * 带课号 token 的升级为候选（交给 AI 到图上核对）。
 * 只认课号 token、不认宽泛语义标题——普通正文句也可能有语义内容，
 * 放进来会污染候选；前付/总结类无码行由"按图通读"指令覆盖。
 */
export function maybeUnresolvedCandidate(lineText: string, page: number): TocUnresolvedCandidate | null {
  const title = stripMarkdownLineMarkers(lineText).trim();
  if (!title || title.length > 200) return null;
  if (!Number.isInteger(page) || page < 1) return null;
  if (!LESSON_TOKEN_RE.test(title)) return null;
  return { title, page };
}

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

/**
 * 目录审核排障开关（默认关闭）：`STUDY_STUDIO_TOC_DEBUG=1` 时才在网关终端
 * 打印 AI 请求全文、工具调用参数/回执与合并 diff 明细（含基线标题，便于定位
 * 漏项/错页）。输出只到本地控制台，不入库、不随 HTTP 返回、不进测试断言；
 * 日常保持关闭，避免课文标题进日志。
 * 定义在此（而非 toc-review-agent）：基线侧分阶段诊断同样需要，且 agent 已
 * 依赖 baseline，反向 import 会成环。
 */
export const TOC_REVIEW_DEBUG_ENV = 'STUDY_STUDIO_TOC_DEBUG';

export function isTocReviewDebug(): boolean {
  const raw = process.env[TOC_REVIEW_DEBUG_ENV];
  return raw === '1' || raw === 'true';
}

/** 未定位候选上限（条）：封顶防 prompt 膨胀；超出部分不进指令（计数仍在日志）。 */
export const TOC_UNRESOLVED_CANDIDATES_MAX = 50;

/** 右缘判定比（启发式）：右端落在页内最大右端 85% 右侧即算右栏（页码列）。 */
const RIGHT_EDGE_RATIO = 0.85;
/** 右栏数字 span 摘要上限（条/页）：只记形状不记文本，封顶防刷屏。 */
const RIGHT_DIGIT_BOXES_MAX = 100;

/**
 * 原始 span 数字预统计（纯函数，收窄前调用）：
 * - total：带数字证据的原始 span 数（纯数字，或非纯数字但以 1–4 位数字结尾的行级
 *   span；坐标是否合法不管；含正文题号，只作水位）；
 * - validCoords：其中坐标四元组合法的子集；
 * - rightDigits：合法坐标子集中位于右栏（页码列）的纯数字——独立数字列口径；
 * - trailingDigits：合法坐标子集中以数字结尾的非纯数字行——行内嵌页码口径
 *   （如 `第1課……6` 整行 span；与 rightDigits 互斥）。
 * 定责只用 rightDigits/trailingDigits；total 整页计数会被正文题号污染，
 * 不得作为规范化丢失判据。
 */
export interface RawDigitStats {
  total: number;
  validCoords: number;
  rightDigits: number;
  trailingDigits: number;
}

export function countRawDigits(rawSpans: unknown): RawDigitStats {
  const empty: RawDigitStats = { total: 0, validCoords: 0, rightDigits: 0, trailingDigits: 0 };
  if (!Array.isArray(rawSpans)) return empty;
  // maxRight 必须按全部合法坐标 span 算（含非数字标题行）：只看数字会把
  // 左侧题号误判进右栏（数字永远 ≥ 自身 85%）。
  const items: Array<{ pure: boolean; trailing: boolean; right: number | null }> = [];
  let maxRight = 0;
  for (const raw of rawSpans) {
    if (!raw || typeof raw !== 'object') continue;
    const rec = raw as Record<string, unknown>;
    const text = typeof rec.text === 'string' ? rec.text.trim() : '';
    const pure = text !== '' && /^\d{1,4}$/.test(text);
    const trailing = !pure && text !== '' && /(\d{1,4})\s*$/.test(text);
    let right: number | null = null;
    const nums: number[] = [];
    let coordsOk = true;
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      if (typeof rec[key] !== 'number' || !Number.isFinite(rec[key])) {
        coordsOk = false;
        break;
      }
      nums.push(rec[key] as number);
    }
    if (coordsOk) {
      right = (nums[0] as number) + (nums[2] as number);
      if (right > maxRight) maxRight = right;
    }
    if (!pure && !trailing) continue;
    items.push({ pure, trailing, right });
  }
  const out: RawDigitStats = { total: 0, validCoords: 0, rightDigits: 0, trailingDigits: 0 };
  for (const it of items) {
    out.total++;
    if (it.right === null) continue;
    out.validCoords++;
    if (it.pure && maxRight > 0 && it.right >= maxRight * RIGHT_EDGE_RATIO) out.rightDigits++;
    else if (it.trailing) out.trailingDigits++;
  }
  return out;
}

/** 单页分阶段摘要（纯数据、无文本内容）：数字丢失定责用。 */
export interface TocPageStageSummary {
  page: number;
  /** 引擎原始 spans 总数（收窄前）。 */
  rawSpans: number;
  /** 原始 span 中纯数字文本数（整页口径，含正文题号；只作水位，不定责）。 */
  rawDigitTexts: number;
  /** 原始纯数字中有合法坐标的子集（能进 narrowed 的上限）。 */
  rawDigitValidCoords: number;
  /** 原始纯数字中坐标合法且位于右栏的子集（定责入口之一：独立数字列）。 */
  rawRightDigitTexts: number;
  /** 原始行内嵌页码中坐标合法的子集（定责入口之二：行尾数字行）。 */
  rawTrailingPageSpans: number;
  /** 收窄后 spans 数（非法坐标已弃，含 native 回填）。 */
  narrowedSpans: number;
  /** 右栏纯数字 span 数（来源 OCR；native 回填另计，永不合并）。 */
  ocrRightDigitSpans: number;
  /** 右栏纯数字 span 数（来源 native-fallback；仅说明回填活跃度，不参与 OCR 定责）。 */
  nativeRightDigitSpans: number;
  /**
   * 右栏数字 span 安全摘要（来源 OCR）：[x, y, width, height, 文本长, 是否纯数字]。
   * 只泄露长度与是否全数字，不泄露标题/课文/页码原文。
   */
  ocrRightDigitBoxes: Array<[number, number, number, number, number, boolean]>;
  /** 右栏数字 span 安全摘要（来源 native-fallback，同上形状；仅说明回填活跃）。 */
  nativeRightDigitBoxes: Array<[number, number, number, number, number, boolean]>;
  /** Markdown 行尾数字行数。 */
  markdownTrailingDigits: number;
  /** Markdown 独立数字 token 总数。 */
  markdownDigitTokens: number;
  /** 清洗后保留行数。 */
  keptLines: number;
  /** 本页定责 verdict（优先级决策树已执行，见 resolveDigitLossStage）。 */
  verdict: DigitLossVerdict;
}

/** 数字丢失定责 verdict（优先级决策树，见 resolveDigitLossStage）。 */
export type DigitLossVerdict =
  /** 有数字死在坐标收窄门：右栏结论未定，先查收窄/坐标来源，不得继续下判。 */
  | 'coord-gate-undecided'
  /**
   * 未观察到可定位的右栏数字（注意措辞：不是"引擎没有识别数字"，
   * 只是独立数字列 + 行内嵌两种口径都无合法坐标证据）。
   */
  | 'no-locatable-right-digits'
  /** 右栏有数但 Markdown 行尾无数：spans→Markdown 规范化丢失。 */
  | 'normalization-loss'
  /** 数字链完整到达 Markdown；成条与否对照 entries/unresolvedCandidates 另判。 */
  | 'digits-reached-markdown';

/**
 * 数字丢失定责（纯函数）：优先级不可调换——
 * 只要有数字死在坐标门（rawDigitTexts > rawDigitValidCoords），右栏结论一律
 * 未定（例：OCR 给了 `6` 但无合法坐标，它进差值而右栏计数为零，此时若判
 * “右栏数字没从 OCR 出来”就是误判）；仅当坐标齐后才按右栏/Markdown 分流，
 * 右栏证据取独立数字列与行内嵌之和。
 */
export function resolveDigitLossStage(input: {
  rawDigitTexts: number;
  rawDigitValidCoords: number;
  rawRightDigitTexts: number;
  rawTrailingPageSpans: number;
  markdownTrailingDigits: number;
}): DigitLossVerdict {
  if (input.rawDigitTexts > input.rawDigitValidCoords) return 'coord-gate-undecided';
  if (input.rawRightDigitTexts + input.rawTrailingPageSpans === 0) return 'no-locatable-right-digits';
  if (input.markdownTrailingDigits === 0) return 'normalization-loss';
  return 'digits-reached-markdown';
}

/**
 * 单页分阶段摘要（纯函数）：三阶段计数的唯一口径，verdict 由
 * resolveDigitLossStage 按优先级判定后直接写入，日志只读不二次解读。
 */
export function summarizePageStage(
  page: number,
  rawSpans: number,
  digit: RawDigitStats,
  spans: TocGeometrySpan[],
  markdown: string,
  keptLines: number
): TocPageStageSummary {
  let maxRight = 0;
  for (const s of spans) {
    const right = s.x + s.width;
    if (right > maxRight) maxRight = right;
  }
  const ocrRightDigitBoxes: TocPageStageSummary['ocrRightDigitBoxes'] = [];
  const nativeRightDigitBoxes: TocPageStageSummary['nativeRightDigitBoxes'] = [];
  let ocrRightDigitSpans = 0;
  let nativeRightDigitSpans = 0;
  for (const s of spans) {
    const text = s.text.trim();
    if (!/^\d{1,4}$/.test(text)) continue;
    if (maxRight > 0 && s.x + s.width < maxRight * RIGHT_EDGE_RATIO) continue;
    const digest: [number, number, number, number, number, boolean] = [
      s.x,
      s.y,
      s.width,
      s.height,
      text.length,
      true,
    ];
    if (s.source === 'native-fallback') {
      nativeRightDigitSpans++;
      if (nativeRightDigitBoxes.length < RIGHT_DIGIT_BOXES_MAX) nativeRightDigitBoxes.push(digest);
    } else {
      ocrRightDigitSpans++;
      if (ocrRightDigitBoxes.length < RIGHT_DIGIT_BOXES_MAX) ocrRightDigitBoxes.push(digest);
    }
  }
  const lines = markdown.split('\n');
  let markdownTrailingDigits = 0;
  let markdownDigitTokens = 0;
  for (const line of lines) {
    if (/(\d+)\s*$/.test(line)) markdownTrailingDigits++;
    const tokens = line.match(/\b\d{1,4}\b/g);
    if (tokens) markdownDigitTokens += tokens.length;
  }
  return {
    page,
    rawSpans,
    rawDigitTexts: digit.total,
    rawDigitValidCoords: digit.validCoords,
    rawRightDigitTexts: digit.rightDigits,
    rawTrailingPageSpans: digit.trailingDigits,
    narrowedSpans: spans.length,
    ocrRightDigitSpans,
    nativeRightDigitSpans,
    ocrRightDigitBoxes,
    nativeRightDigitBoxes,
    markdownTrailingDigits,
    markdownDigitTokens,
    keptLines,
    verdict: resolveDigitLossStage({
      rawDigitTexts: digit.total,
      rawDigitValidCoords: digit.validCoords,
      rawRightDigitTexts: digit.rightDigits,
      rawTrailingPageSpans: digit.trailingDigits,
      markdownTrailingDigits,
    }),
  };
}

export interface TocBaselineDiagnostics {
  pagesRequested: number;
  pagesOcr: number;
  linesConsidered: number;
  linesDroppedWash: number;
  entriesAccepted: number;
  entriesRejected: number;
  /** 标题无语义内容被拒的行数（符号-only/Markdown 残留/纯数字形，不记原文）。 */
  badTitle: number;
  /** 版式块匹配产出的条目数（坐标证据，确定性规则）。 */
  entriesFromBlocks: number;
  /** 版式块未定位的标题数（只记数，不猜页码）。 */
  unresolvedBlocks: number;
}

export interface TocBaselineOutput {
  status: TocBaselineStatus;
  /** P3.1B 质量 verdict（下游 review/preview/import 强制消费）。 */
  verdict: TocBaselineVerdict;
  range: { fromPage: number; toPage: number };
  pageCount: number;
  entries: TocBaselineEntry[];
  /**
   * 未定位候选（只读快照）：标题有效但文字层无页码的行（如 `第1課` 丢了右栏
   * 个位页码）。基线不臆造页码，但也不静默丢弃——随指令交给 AI 到对应
   * 目录页图上核对（找不到/看不清就跳过）。前端窄化时忽略本字段。
   */
  unresolvedCandidates: TocUnresolvedCandidate[];
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

export type { WashedLine as TocWashedLine };

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
 * Markdown 行标记剥离（re-export：实现已迁 toc-discovery，版式块与行抽取共用同一口径）。
 */
export { stripMarkdownLineMarkers } from './toc-discovery.js';

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
  /**
   * span 来源（定责用，不可缺席）：
   * - ocr：OCR 引擎原始输出（经 narrowSpan 收窄）；
   * - native-fallback：OCR 无 spans 时 PDF 原生文本坐标回填。
   * 两者在诊断计数中永不合并（混入 native 会伪造 OCR 归因）。
   */
  source: 'ocr' | 'native-fallback';
}

type NarrowedSpan = Omit<TocGeometrySpan, 'source'>;

function narrowSpan(raw: unknown): NarrowedSpan | null {
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
  logger.warn('[toc-baseline] embedded 门', {
    quality: outlineQuality.quality,
    reason: outlineQuality.reason,
    totalItems: outlineQuality.totalItems,
    validEntries: outlineQuality.validEntries,
    semanticEntries: outlineQuality.semanticEntries,
  });
  if (outlineQuality.quality === 'usable') {
    return ok(embeddedBaselineResult(fromPage, toPage, pageCount));
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
  const rawSpanCountByPage = new Map<number, number>();
  const rawDigitByPage = new Map<number, RawDigitStats>();
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
      rawSpanCountByPage.set(pg.pageNumber, Array.isArray(rawSpans) ? rawSpans.length : 0);
      rawDigitByPage.set(pg.pageNumber, countRawDigits(rawSpans));
      if (Array.isArray(rawSpans)) {
        for (const raw of rawSpans) {
          const narrowed = narrowSpan(raw);
          if (narrowed) spans.push({ ...narrowed, source: 'ocr' });
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
  // P3.2B：OCR 无 spans 的页回填 native 定位（不占 OCR 预算；失败即文本降级）。
  const positioned = fillPositionedSpans(inspector, input.bytes, window, spansByPage);
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
  const assembled = assembleTocBaseline({
    window,
    keptByPage,
    evidenceByPage,
    spansByPage,
    ocrPages,
    washedKept: washed.kept.length,
    washedDropped: washed.dropped,
  });
  // 只记计数：不记标题、不记正文、不记 spans、不记 evidence。
  logger.warn('[toc-baseline] 完成', {
    range: `${fromPage}-${toPage}`,
    entries: assembled.entries.length,
    unresolved: assembled.unresolvedCandidates.length,
    rejected: assembled.diagnostics.entriesRejected,
    badTitle: assembled.diagnostics.badTitle,
    washed: washed.dropped,
    ocrPages: ocrPages.length,
    positioned,
  });
  if (isTocReviewDebug()) {
    // 数字丢失定责三阶段（只记形状与计数，不记文本内容；verdict 已由
    // resolveDigitLossStage 按优先级写入，此处注释仅为读数指南）：
    // rawDigitTexts > rawDigitValidCoords → 有数字死在坐标收窄门，右栏未定；
    // 右栏两口径（独立数字列 + 行内嵌）皆零 → 未观察到可定位右栏数字；
    // 任一口径有数但 Markdown 行尾无数 → spans→Markdown 规范化丢失；
    // Markdown 有对应右栏数字但未成条目 → 行抽取/配对问题；
    // native* 仅说明回填活跃，永不作为 OCR 定责依据
    // （对照同页 pageEvidence 原文与 unresolvedCandidates 即可定位）。
    logger.warn(
      '[toc-review-debug] 基线分阶段计数',
      window.map((p) => {
        const digit = rawDigitByPage.get(p) ?? { total: 0, validCoords: 0, rightDigits: 0, trailingDigits: 0 };
        return summarizePageStage(
          p,
          rawSpanCountByPage.get(p) ?? 0,
          digit,
          spansByPage.get(p) ?? [],
          markdownByPage.get(p) ?? '',
          (keptByPage.get(p) ?? []).length
        );
      })
    );
  }
  return ok({
    status: assembled.status,
    verdict: assembled.verdict,
    range: { fromPage, toPage },
    pageCount,
    entries: assembled.entries,
    unresolvedCandidates: assembled.unresolvedCandidates,
    diagnostics: assembled.diagnostics,
    pageEvidence: assembled.pageEvidence,
    embedded: false,
  });
}

/**
 * CMD-LINGUA-P3.2B native 坐标回填（只读）：OCR 未给 spans 的页，用
 * `extractTextWithPositions` 原生定位条目补齐（同坐标系；纯 native 解析，
 * 不占 OCR 预算、不新增模型下载）。OCR spans 优先，只填空页；失败即降级
 * （该页走文本路径）。无坐标方法时静默返回 0，不抛。
 */
export function fillPositionedSpans(
  inspector: PdfInspectorLike,
  bytes: Uint8Array,
  window: number[],
  spansByPage: Map<number, TocGeometrySpan[]>
): number {
  if (typeof inspector.extractTextWithPositions !== 'function') return 0;
  const missing = window.filter((p) => (spansByPage.get(p) ?? []).length === 0);
  if (missing.length === 0) return 0;
  let raw: unknown[];
  try {
    const out = inspector.extractTextWithPositions(bytes, missing);
    raw = Array.isArray(out) ? out : [];
  } catch {
    return 0;
  }
  const wanted = new Set(missing);
  // OCR spans 优先：调用前已有 spans 的页整页跳过（OCR 与 native 同页不混用）。
  for (const p of [...wanted]) {
    if ((spansByPage.get(p) ?? []).length > 0) wanted.delete(p);
  }
  if (wanted.size === 0) return 0;
  let filled = 0;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.text !== 'string' || !rec.text.trim()) continue;
    if (typeof rec.page !== 'number' || !wanted.has(Math.trunc(rec.page))) continue;
    let coordsOk = true;
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      if (typeof rec[key] !== 'number' || !Number.isFinite(rec[key] as number)) coordsOk = false;
    }
    if (!coordsOk) continue;
    const page = Math.trunc(rec.page as number);
    const list = spansByPage.get(page) ?? [];
    list.push({
      text: rec.text as string,
      x: rec.x as number,
      y: rec.y as number,
      width: rec.width as number,
      height: rec.height as number,
      source: 'native-fallback',
    });
    spansByPage.set(page, list);
    filled++;
  }
  return filled;
}

/**
 * CMD-LINGUA-P3.3 基线组装（清洗→抽取→几何→verdict→证据）：JSON 与流式
 * 共用同一函数，保证两端输出逐字节一致。只读，无日志无 IO。
 */
export interface BaselineAssemblyInput {
  window: number[];
  keptByPage: Map<number, WashedLine[]>;
  evidenceByPage: Map<number, string[]>;
  spansByPage: Map<number, TocGeometrySpan[]>;
  ocrPages: number[];
  washedKept: number;
  washedDropped: number;
}

export function assembleTocBaseline(
  input: BaselineAssemblyInput
): Pick<TocBaselineOutput, 'status' | 'verdict' | 'entries' | 'unresolvedCandidates' | 'diagnostics' | 'pageEvidence'> {
  const { window, keptByPage, evidenceByPage, spansByPage, ocrPages, washedKept, washedDropped } = input;
  const entries: TocBaselineEntry[] = [];
  let rejected = 0;
  let badTitle = 0;
  let entriesFromBlocks = 0;
  let unresolvedBlocks = 0;
  // P3.2B：文本路径先行（行为与旧版逐字节一致），版式块只补缺口：
  // 同页内文本条目在前、块条目在后；块侧经 satisfied 集合跳过文本已认领标题
  // （不产出、不计 unresolved）；文本键同样归一化，双计不可能。
  // 无坐标页 matcher 即返回空，旧行为自然保留（降级）。
  const normTitle = (s: string): string => normalizeTocBlockText(s);
  const rawCandidates: TocUnresolvedCandidate[] = [];
  for (const page of window) {
    const satisfied = new Set<string>();
    for (const line of keptByPage.get(page) ?? []) {
      const parsed = extractTocLineEntry(line.text);
      if (parsed === null) {
        // 标题有效但无页码：不静默丢弃，升级为未定位候选（AI 到图上核对）。
        const candidate = maybeUnresolvedCandidate(line.text, page);
        if (candidate) rawCandidates.push(candidate);
        continue;
      }
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
        source: geometry ? 'geometry-block' : 'text-fallback',
        kind,
      });
      satisfied.add(normTitle(parsed.title));
    }
    const blockRes = matchTocLayoutBlocks(spansByPage.get(page) ?? [], satisfied);
    unresolvedBlocks += blockRes.unresolved;
    const seenBlock = new Set<string>();
    for (const block of blockRes.entries) {
      const key = `${normTitle(block.title)}｜${block.printedPage}`;
      if (satisfied.has(normTitle(block.title)) || seenBlock.has(key)) continue;
      seenBlock.add(key);
      const kind = classifyTocEntryKind(block.title);
      entries.push({
        title: block.title,
        printedPage: block.printedPage,
        level: 1,
        source: 'geometry-block',
        kind,
      });
      entriesFromBlocks++;
    }
  }
  const verdict: TocBaselineVerdict =
    entries.length === 0 ? 'empty' : entries.length < TOC_BASELINE_MIN_USABLE_ENTRIES ? 'thin' : 'usable';
  // 候选收敛：已转正（任一页接受）的标题不再候选；同标题同页去重；封顶。
  const acceptedTitles = new Set(entries.map((e) => normTitle(e.title)));
  const seenCandidate = new Set<string>();
  const unresolvedCandidates: TocUnresolvedCandidate[] = [];
  for (const c of rawCandidates) {
    const key = `${normTitle(c.title)}｜${c.page}`;
    if (seenCandidate.has(key) || acceptedTitles.has(normTitle(c.title))) continue;
    seenCandidate.add(key);
    if (unresolvedCandidates.length >= TOC_UNRESOLVED_CANDIDATES_MAX) break;
    unresolvedCandidates.push(c);
  }
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
  return {
    status: entries.length > 0 ? 'ok' : 'empty',
    verdict,
    entries,
    unresolvedCandidates,
    diagnostics: {
      pagesRequested: window.length,
      pagesOcr: ocrPages.length,
      linesConsidered: washedKept + washedDropped,
      linesDroppedWash: washedDropped,
      entriesAccepted: entries.length,
      entriesRejected: rejected,
      badTitle,
      entriesFromBlocks,
      unresolvedBlocks,
    },
    pageEvidence,
  };
}

/**
 * CMD-LINGUA-P3.3 embedded 短路输出（JSON 与流式共用，逐字节一致）。
 */
export function embeddedBaselineResult(
  fromPage: number,
  toPage: number,
  pageCount: number
): TocBaselineOutput {
  return {
    status: 'empty',
    verdict: 'empty',
    range: { fromPage, toPage },
    pageCount,
    entries: [],
    unresolvedCandidates: [],
    diagnostics: {
      pagesRequested: toPage - fromPage + 1,
      pagesOcr: 0,
      linesConsidered: 0,
      linesDroppedWash: 0,
      entriesAccepted: 0,
      entriesRejected: 0,
      badTitle: 0,
      entriesFromBlocks: 0,
      unresolvedBlocks: 0,
    },
    pageEvidence: [],
    embedded: true,
  };
}
