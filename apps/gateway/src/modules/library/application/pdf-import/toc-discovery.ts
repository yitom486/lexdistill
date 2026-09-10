import { BusinessError, err, logger, ok, type Result } from '@study-studio/shared';
import { ensurePdfRuntime, type PdfInspectorLike } from './pdf-runtime.js';
import {
  MAX_OCR_PAGES_PER_IMPORT,
  probePdfPageCount,
  rangePages,
  readEmbeddedOutlineEntries,
  validatePdfInput,
  type PdfImportInput,
  type PdfImportServiceDeps,
} from './pdf-import-service.js';

/**
 * CMD-LINGUA-P2：目录页发现（只读，后端）。
 *
 * 当 PDF 没有可用 embedded outline 时，用受限 OCR 前窗找出“疑似目录页范围”，
 * 返回 found / ambiguous / not-found 供调用方确认。不自动切课、不写 DB/AST/缓存、
 * 不存 OCR 原文（页文本只在内存里过一遍评分函数）。
 *
 * 成本铁律：只看前部窗口（≤ TOC_DISCOVERY_MAX_PAGES = 30，不抬 OCR 上限）；
 * 每一次 processPdf / processPdfWithOcr 必带非空页窗；P1 embedded 可用时零 OCR。
 */

/** 探测窗上限（页）：恒 ≤ 单次 OCR 上限，绝不抬高（跟随 OCR 上限只降不升）。 */
export const TOC_DISCOVERY_MAX_PAGES = Math.min(30, MAX_OCR_PAGES_PER_IMPORT);

/**
 * 日语教材形目录评分权重（纯形证据，无中文章节正则、无水印词表、无出版社特例）。
 * 锚点门（目录标题或课号 token 至少其一）缺席时，即使分数再高也不成候选——
 * 普通表格/习题页没有锚点，天然落 not-found。
 */
export const TOC_DISCOVERY_SCORE = {
  /** 目录标题行（目次/もくじ/目录/CONTENTS，整页只计一次） */
  TITLE: 4,
  /** 课号行（第N課/復習A-B/Lesson N/Unit N），每行计 */
  LESSON_TOKEN: 3,
  LESSON_CAP: 10,
  /** 点线行（…/…/···），每行计 */
  DOT_LEADER: 2,
  DOT_CAP: 12,
  /** 行尾页码形（标题 + 空格 + 数字；纯数字页码行不算），每行计 */
  TRAILING_PAGE: 1,
  TRAILING_CAP: 15,
  /** 表格行（| 形），每行计 */
  TABLE_ROW: 1,
  TABLE_CAP: 6,
  /** 习题行（問N/QN/練習N…），每行扣 */
  EXERCISE: -2,
  EXERCISE_CAP: 5,
  /** 成候选的最低页分（须同时有锚点） */
  CANDIDATE: 6,
} as const;

/** 课号 token：日语教材形 + 通用拉丁形（P3 基线复用，不含中文章节正则）。 */
export const LESSON_TOKEN_RE = /(第\s*\d+\s*課|復習\s*[AB]|LESSON\s*\d+|UNIT\s*\d+)/i;
/** 目录标题：日语形 + 通用词（TABLE OF CONTENTS 含 CONTENTS，一并命中）。 */
const TOC_TITLE_RE = /(目次|もくじ|目录|CONTENTS)/i;
/** 点线：省略号/三点以上圆点/中点/全角点。 */
const DOT_LEADER_RE = /…{2,}|(\.\s?){3,}|・{2,}|．{2,}/;
/** 行尾页码：标题 + 空白 + 1–4 位数字（P3 基线复用；纯数字行不命中）。 */
export const TRAILING_PAGE_RE = /^(.*\S)\s+(\d{1,4})$/;
/** 表格行：半角/全角竖线（P3 基线复用）。 */
export const TABLE_ROW_RE = /[|｜]/;
/** 习题行：问号题号/练习字样 + 数字（P3 基线复用，拒绝习题正文）。 */
export const EXERCISE_RE = /^(問|问)\s*\d+|^Q\s*\d+[\.\)]?|^(練習|练习|EXERCISE)\s*\d+/i;

export interface TocPageFeatures {
  hasTocTitle: boolean;
  lessonTokenLines: number;
  dotLeaderLines: number;
  trailingPageLines: number;
  tableRowLines: number;
  exerciseLines: number;
}

/** 逐行抽取目录形状特征（纯函数；空行跳过）。 */
export function extractTocPageFeatures(markdown: string): TocPageFeatures {
  const features: TocPageFeatures = {
    hasTocTitle: false,
    lessonTokenLines: 0,
    dotLeaderLines: 0,
    trailingPageLines: 0,
    tableRowLines: 0,
    exerciseLines: 0,
  };
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (!features.hasTocTitle && TOC_TITLE_RE.test(line)) features.hasTocTitle = true;
    if (LESSON_TOKEN_RE.test(line)) features.lessonTokenLines++;
    if (DOT_LEADER_RE.test(line)) features.dotLeaderLines++;
    if (TRAILING_PAGE_RE.test(line)) features.trailingPageLines++;
    if (TABLE_ROW_RE.test(line)) features.tableRowLines++;
    if (EXERCISE_RE.test(line)) features.exerciseLines++;
  }
  return features;
}

/** 特征加权求和（纯函数；阈值与 cap 见 TOC_DISCOVERY_SCORE）。 */
export function scoreTocPageFeatures(features: TocPageFeatures): number {
  const w = TOC_DISCOVERY_SCORE;
  return (
    (features.hasTocTitle ? w.TITLE : 0) +
    w.LESSON_TOKEN * Math.min(features.lessonTokenLines, w.LESSON_CAP) +
    w.DOT_LEADER * Math.min(features.dotLeaderLines, w.DOT_CAP) +
    w.TRAILING_PAGE * Math.min(features.trailingPageLines, w.TRAILING_CAP) +
    w.TABLE_ROW * Math.min(features.tableRowLines, w.TABLE_CAP) +
    w.EXERCISE * Math.min(features.exerciseLines, w.EXERCISE_CAP)
  );
}

export interface TocScoredPage {
  page: number;
  score: number;
  candidate: boolean;
}

/**
 * 单页评分 + 候选判定（纯函数）：有锚点（目录标题或课号 token）且分达标才成候选。
 * 宁可 not-found，不伪造高置信。
 */
export function scoreTocDiscoveryPage(page: number, markdown: string): TocScoredPage {
  const features = extractTocPageFeatures(markdown);
  const score = scoreTocPageFeatures(features);
  const hasAnchor = features.hasTocTitle || features.lessonTokenLines > 0;
  return { page, score, candidate: hasAnchor && score >= TOC_DISCOVERY_SCORE.CANDIDATE };
}

export interface TocDiscoveryCandidate {
  fromPage: number;
  toPage: number;
  score: number;
}

/**
 * 连续候选页合并为范围（纯函数；页码升序，相邻即同窗，score 取窗内最高）。
 * 冲突不裁决——多窗原样返回上游判 ambiguous。
 */
export function mergeTocCandidateRanges(pages: TocScoredPage[]): TocDiscoveryCandidate[] {
  const ordered = pages
    .filter((p) => p.candidate)
    .slice()
    .sort((a, b) => a.page - b.page);
  const ranges: TocDiscoveryCandidate[] = [];
  for (const item of ordered) {
    const last = ranges[ranges.length - 1];
    if (last && item.page === last.toPage + 1) {
      last.toPage = item.page;
      last.score = Math.max(last.score, item.score);
    } else {
      ranges.push({ fromPage: item.page, toPage: item.page, score: item.score });
    }
  }
  return ranges;
}

export type TocDiscoveryStatus = 'found' | 'ambiguous' | 'not-found';

export interface TocDiscoveryOutput {
  status: TocDiscoveryStatus;
  /** found 恰 1 个；ambiguous ≥2 个（不替用户选）；not-found 空。 */
  candidates: TocDiscoveryCandidate[];
  pageCount: number;
  /** 实际看过的前窗页（恒非空，长度 ≤30）。 */
  pagesScanned: number[];
  /** 实际走 OCR 的页（本地 Auto 路由；embedded 命中时为空）。 */
  ocrPages: number[];
  /**
   * true = 原生目录可用，本次零 OCR（candidates 为空；
   * 调用方应直接用 map 的 embeddedOutline，而非 OCR 找目录）。
   */
  embedded: boolean;
}

/**
 * 目录页发现编排（只读）：探页数 → embedded 短路 → 前窗 OCR → 逐页评分 → 合并判定。
 * 不写 DB/AST/缓存；OCR 原文不出本函数；日志只记计数。
 */
export async function discoverTocPages(
  deps: Pick<PdfImportServiceDeps, 'loadInspector' | 'runtimeDir'>,
  input: PdfImportInput
): Promise<Result<TocDiscoveryOutput, BusinessError>> {
  const valid = validatePdfInput(input);
  if (!valid.ok) return err(valid.error);
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
  // 诚实页数（[1] 轻探针，不扫全书）。
  const pageCount = probePdfPageCount(inspector, input.bytes);
  if (!Number.isFinite(pageCount) || pageCount < 1) {
    return err(new BusinessError('E_PDF_PARSE', 'PDF 页数识别失败，文件可能已损坏', 'TOOL_EXECUTION'));
  }
  // P1 embedded 可用 → 零 OCR，直接返回（不伪造候选）。
  if (readEmbeddedOutlineEntries(inspector, input.bytes, pageCount)) {
    return ok({
      status: 'not-found',
      candidates: [],
      pageCount,
      pagesScanned: [],
      ocrPages: [],
      embedded: true,
    });
  }
  // 前部探测窗（恒非空，≤30）。
  const window = rangePages(1, Math.min(pageCount, TOC_DISCOVERY_MAX_PAGES));
  // 先窗分类看是否需要 OCR runtime（与 map 同口径，不多花一次模型下载）。
  const cls = inspector.processPdf(input.bytes, window);
  const windowNeeding = Array.isArray(cls.pagesNeedingOcr)
    ? cls.pagesNeedingOcr.filter((n): n is number => typeof n === 'number')
    : [];
  const ocrMarkdownByPage = new Map<number, string>();
  let ocrPages: number[] = [];
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
      if (typeof pg.pageNumber === 'number' && typeof pg.markdown === 'string') {
        ocrMarkdownByPage.set(pg.pageNumber, pg.markdown);
      }
    }
    ocrPages = Array.isArray(ocr.pagesRoutedToOcr)
      ? ocr.pagesRoutedToOcr.filter((n): n is number => typeof n === 'number')
      : [];
  } catch (e) {
    return err(
      e instanceof BusinessError
        ? e
        : new BusinessError('E_PDF_PARSE', '目录页探测失败，请稍后重试', 'TOOL_EXECUTION')
    );
  }
  const scored = window.map((p) => scoreTocDiscoveryPage(p, ocrMarkdownByPage.get(p) ?? ''));
  const candidates = mergeTocCandidateRanges(scored);
  const status: TocDiscoveryStatus =
    candidates.length === 0 ? 'not-found' : candidates.length === 1 ? 'found' : 'ambiguous';
  // 只记计数：不记标题、不记正文。
  logger.warn('[toc-discovery] 完成', {
    status,
    candidates: candidates.length,
    pagesScanned: window.length,
    ocrPages: ocrPages.length,
  });
  return ok({ status, candidates, pageCount, pagesScanned: window, ocrPages, embedded: false });
}
