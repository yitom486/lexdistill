import { BusinessError, err, logger, ok, type Result } from '@study-studio/shared';
import { ensurePdfRuntime, type PdfInspectorLike } from './pdf-runtime.js';
import {
  probePdfPageCount,
  validatePdfInput,
  type PdfImportServiceDeps,
} from './pdf-import-service.js';

/**
 * CMD-LINGUA-P5B：受限 folio 候选抽取（只读，从不自动成 anchor）。
 *
 * 只回答“PDF 第 N 页的页眉/页脚位置可能看见了什么印刷页码”，绝不回答
 * “这就是 anchor / 全书 offset / 该导哪一课”。输出 candidate 只是弱证据，
 * 必须经 P5-C 的双源印证或用户确认才能成为 P5-A anchor——本模块在类型层面
 * 就不产出 anchor 形状（无 printedPage/physicalPage 映射字段），也绝不
 * import 预览模块。
 *
 * 证据来源（弱→更弱）：
 * - native：`extractTextWithPositions` 行级条目（有坐标；实测 y-up，见下）；
 * - ocr：仅 native 缺失/无命中时对**相同选择页** fallback（spans 同坐标系）。
 */

// y 方向 Verified fact（pdf-lib 探针实测锁定，见单测 `native y 轴向上`）：
// TOPMARK@pdf-lib-y750 → native y=750，BOTMARK@pdf-lib-y50 → native y=50，
// 即 y 越大越靠页顶。header = 高 y 边带，footer = 低 y 边带。

/** 单次页数上限（与 review 材料窗同量级；超限 fail-closed，不截断）。 */
export const FOLIO_CANDIDATE_MAX_PAGES = 8;

/** 上下边带占页面 y 跨度的比例（启发式，见契约文档 §6）。 */
const FOLIO_EDGE_BAND_RATIO = 0.12;

/** 同行合并的 y 容差下限（pt；字高过小/缺失时的保底）。 */
const FOLIO_LINE_TOL_MIN_PT = 2;

/** Arabic folio 上限（启发式：教材印刷页极少超此数；年份 19xx–20xx 一并排除）。 */
const FOLIO_ARABIC_MAX = 1500;

/** OCR span 置信度下限（同 P3 口径；低于此只弃候选，不毙整页）。 */
const FOLIO_OCR_MIN_CONFIDENCE = 0.5;

/** 同页最少文本条目数（证据不足直接无候选，不猜边带）。 */
const FOLIO_MIN_ITEMS_PER_PAGE = 3;

export type FolioNormalized =
  | { kind: 'arabic'; value: number }
  | { kind: 'roman'; value: string };

export type FolioLocation = 'header' | 'footer';
export type FolioSource = 'native' | 'ocr';
export type FolioConfidence = 'low' | 'medium';

export interface FolioCandidate {
  /** 观测到的原始 token（含装饰符，如 `·12`； discrimination 依据）。 */
  raw: string;
  /**
   * 归一化：arabic 给数字，roman **只给大写原形、绝不转数字**
   *（类型层面就没有 roman→number 的位置，误转写不出来）。
   */
  normalized: FolioNormalized;
  location: FolioLocation;
  source: FolioSource;
  /** native → medium；ocr → low（识别链更长一律降级）。 */
  confidence: FolioConfidence;
}

export interface FolioPageCandidates {
  physicalPage: number;
  candidates: FolioCandidate[];
}

export interface FolioCandidatesInput {
  userId: string;
  filename: string;
  bytes: Uint8Array;
  pageNumbers: number[];
}

export interface FolioCandidatesDiagnostics {
  pagesRequested: number;
  nativePages: number;
  ocrPages: number;
  candidatesFound: number;
}

export interface FolioCandidatesOutput {
  pageCount: number;
  pages: FolioPageCandidates[];
  /** 仅计数：无标题、无正文、无 folio 文本。 */
  diagnostics: FolioCandidatesDiagnostics;
}

/** 几何输入最小形状（native 条目与 OCR span 的交集；只取定位需要的字段）。 */
export interface FolioGeometryItem {
  text: string;
  x: number;
  y: number;
  height: number;
  confidence?: number;
}

const ROMAN_RE = /^(?=[MDCLXVI])M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/i;
const ARABIC_RE = /^\d{1,4}$/;
const EDGE_STRIP_RE = /^[\s\-–—·•.。,、()（）[\]]+|[\s\-–—·•.。,、()（）[\]]+$/g;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const high = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) return high;
  return ((sorted[mid - 1] ?? 0) + high) / 2;
}

function normalizeToken(raw: string): FolioNormalized | null {
  const core = raw.replace(EDGE_STRIP_RE, '');
  if (!core || core.length > 20) return null;
  if (ARABIC_RE.test(core)) {
    const value = Number(core);
    if (!Number.isSafeInteger(value) || value < 1 || value > FOLIO_ARABIC_MAX) return null;
    return { kind: 'arabic', value };
  }
  if (ROMAN_RE.test(core)) {
    return { kind: 'roman', value: core.toUpperCase() };
  }
  return null;
}

/**
 * 单页 folio 候选检测（纯函数）：边带孤立 token → 归一化候选。
 * - 边带按本页 y 跨度相对划分（无页尺寸 API，只能相对，见契约 §6）；
 * - 同行条目按 y 容差合并后仍须**恰好一个 token**（多 token 行如目录/表格/正文直接弃）；
 * - header/footer 冲突并列保留，绝不仲裁；同位置同归一值去重。
 */
export function detectFolioCandidates(
  items: FolioGeometryItem[],
  source: FolioSource
): FolioCandidate[] {
  const usable = items.filter(
    (item) =>
      item &&
      typeof item.text === 'string' &&
      item.text.trim() &&
      Number.isFinite(item.x) &&
      Number.isFinite(item.y) &&
      Number.isFinite(item.height)
  );
  if (usable.length < FOLIO_MIN_ITEMS_PER_PAGE) return [];
  const ys = usable.map((item) => item.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = maxY - minY;
  if (!Number.isFinite(span) || span <= 0) return [];
  const band = span * FOLIO_EDGE_BAND_RATIO;
  // y-up：高 y 为 header，低 y 为 footer。
  const headerItems = usable.filter((item) => item.y >= maxY - band);
  const footerItems = usable.filter((item) => item.y <= minY + band);
  const lineTol = Math.max(
    FOLIO_LINE_TOL_MIN_PT,
    median(usable.map((item) => (item.height > 0 ? item.height : 0))) * 0.5
  );
  const out: FolioCandidate[] = [];
  const seen = new Set<string>();
  const collect = (zone: FolioGeometryItem[], location: FolioLocation): void => {
    const ordered = [...zone].sort((a, b) => a.y - b.y || a.x - b.x);
    let current: FolioGeometryItem[] = [];
    const flush = (): void => {
      if (current.length > 0) emitLine(current, location);
      current = [];
    };
    for (const item of ordered) {
      const last = current[current.length - 1];
      if (last && Math.abs(item.y - last.y) <= lineTol) {
        current.push(item);
      } else {
        flush();
        current = [item];
      }
    }
    flush();
  };
  const emitLine = (line: FolioGeometryItem[], location: FolioLocation): void => {
    const text = line
      .map((item) => item.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const tokens = text.split(' ').filter((t) => t.length > 0);
    // 孤立 token：整行恰好一个词（目录行/表格行/正文行天然多词，直接弃）。
    if (tokens.length !== 1) return;
    const raw = tokens[0] as string;
    const normalized = normalizeToken(raw);
    if (!normalized) return;
    const core = raw.replace(EDGE_STRIP_RE, '');
    const key = `${location}｜${core}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      raw,
      normalized,
      location,
      source,
      confidence: source === 'native' ? 'medium' : 'low',
    });
  };
  collect(headerItems, 'header');
  collect(footerItems, 'footer');
  return out;
}

function narrowGeometryItem(raw: unknown): FolioGeometryItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.text !== 'string' || !rec.text.trim()) return null;
  if (typeof rec.x !== 'number' || typeof rec.y !== 'number' || typeof rec.height !== 'number') return null;
  if (!Number.isFinite(rec.x) || !Number.isFinite(rec.y) || !Number.isFinite(rec.height)) return null;
  const confidence = typeof rec.confidence === 'number' ? rec.confidence : undefined;
  return {
    text: rec.text,
    x: rec.x,
    y: rec.y,
    height: rec.height,
    ...(confidence === undefined ? {} : { confidence }),
  };
}

/**
 * folio 候选编排（只读）：页号形状校验 → 运行时 → `[1]` 探页数 → 越界校验 →
 * native（带页窗）→ 无命中页 OCR fallback（同页选择，恒带窗）。
 * 不调 Agent/渲染/模型，不写 DB/AST/cache；日志只记计数。
 */
export async function extractFolioCandidates(
  deps: Pick<PdfImportServiceDeps, 'loadInspector' | 'runtimeDir'>,
  input: FolioCandidatesInput
): Promise<Result<FolioCandidatesOutput, BusinessError>> {
  const valid = validatePdfInput({ userId: input.userId, filename: input.filename, bytes: input.bytes });
  if (!valid.ok) return err(valid.error);
  const requested = input.pageNumbers;
  if (!Array.isArray(requested) || requested.length === 0) {
    return err(new BusinessError('E_INVALID_INPUT', '请提供要查看的 PDF 物理页号（非空数组）', 'VALIDATION'));
  }
  const unique: number[] = [];
  for (const page of requested) {
    if (typeof page !== 'number' || !Number.isSafeInteger(page) || page < 1) {
      return err(new BusinessError('E_INVALID_INPUT', '页号须为 1-based 正整数', 'VALIDATION'));
    }
    if (!unique.includes(page)) unique.push(page);
  }
  unique.sort((a, b) => a - b);
  if (unique.length > FOLIO_CANDIDATE_MAX_PAGES) {
    return err(
      new BusinessError(
        'E_INVALID_INPUT',
        `一次最多查看 ${FOLIO_CANDIDATE_MAX_PAGES} 页（当前 ${unique.length} 页），请缩小后重试`,
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
  // 诚实页数（[1] 轻探针），再验越界——都在 native/OCR 之前。
  const pageCount = probePdfPageCount(inspector, input.bytes);
  if (!Number.isFinite(pageCount) || pageCount < 1) {
    return err(new BusinessError('E_PDF_PARSE', 'PDF 页数识别失败，文件可能已损坏', 'TOOL_EXECUTION'));
  }
  for (const page of unique) {
    if (page > pageCount) {
      return err(new BusinessError('E_INVALID_INPUT', `页号超出本书（本书共 ${pageCount} 页）`, 'VALIDATION'));
    }
  }

  const byPage = new Map<number, FolioCandidate[]>();
  for (const page of unique) byPage.set(page, []);
  let nativePages = 0;
  const missing: number[] = [];
  if (typeof inspector.extractTextWithPositions === 'function') {
    let rawItems: unknown[] = [];
    try {
      const raw: unknown = inspector.extractTextWithPositions(input.bytes, unique);
      if (Array.isArray(raw)) rawItems = raw;
    } catch {
      rawItems = [];
    }
    const itemsByPage = new Map<number, FolioGeometryItem[]>();
    for (const raw of rawItems) {
      const item = narrowGeometryItem(raw);
      if (!item) continue;
      const rec = raw as Record<string, unknown>;
      const page = typeof rec.page === 'number' ? Math.trunc(rec.page) : NaN;
      if (!Number.isSafeInteger(page) || !byPage.has(page)) continue;
      const list = itemsByPage.get(page) ?? [];
      list.push(item);
      itemsByPage.set(page, list);
    }
    for (const page of unique) {
      const found = detectFolioCandidates(itemsByPage.get(page) ?? [], 'native');
      byPage.set(page, found);
      if (found.length > 0) nativePages++;
      else missing.push(page);
    }
  } else {
    for (const page of unique) missing.push(page);
  }

  let ocrPages = 0;
  if (missing.length > 0) {
    // 先窗分类看是否需要 OCR runtime（与 P3 同口径，不多花一次模型下载）。
    const cls = inspector.processPdf(input.bytes, missing);
    const windowNeeding = Array.isArray(cls.pagesNeedingOcr)
      ? cls.pagesNeedingOcr.filter((n): n is number => typeof n === 'number')
      : [];
    const needsOcr = missing.some((p) => windowNeeding.includes(p));
    try {
      const runtime = await ensurePdfRuntime({
        ...(deps.loadInspector ? { loadInspector: deps.loadInspector } : {}),
        ...(deps.runtimeDir ? { runtimeDir: deps.runtimeDir } : {}),
        needOcr: needsOcr,
      });
      inspector = runtime.inspector;
      const ocr = await inspector.processPdfWithOcr(input.bytes, { pageNumbers: missing });
      const routed = Array.isArray(ocr.pagesRoutedToOcr)
        ? ocr.pagesRoutedToOcr.filter((n): n is number => typeof n === 'number')
        : [];
      ocrPages = routed.filter((p) => missing.includes(p)).length;
      const spansByPage = new Map<number, FolioGeometryItem[]>();
      for (const pg of Array.isArray(ocr.pages) ? ocr.pages : []) {
        if (typeof pg.pageNumber !== 'number' || !missing.includes(pg.pageNumber)) continue;
        const spans: FolioGeometryItem[] = [];
        const rawSpans: unknown = (pg as { spans?: unknown }).spans;
        if (Array.isArray(rawSpans)) {
          for (const raw of rawSpans) {
            const item = narrowGeometryItem(raw);
            if (!item) continue;
            if (item.confidence !== undefined && item.confidence < FOLIO_OCR_MIN_CONFIDENCE) continue;
            spans.push(item);
          }
        }
        spansByPage.set(pg.pageNumber, spans);
      }
      for (const page of missing) {
        byPage.set(page, detectFolioCandidates(spansByPage.get(page) ?? [], 'ocr'));
      }
    } catch (e) {
      return err(
        e instanceof BusinessError
          ? e
          : new BusinessError('E_PDF_PARSE', 'folio 候选 OCR 失败，请稍后重试', 'TOOL_EXECUTION')
      );
    }
  }

  const pages: FolioPageCandidates[] = unique.map((page) => ({
    physicalPage: page,
    candidates: byPage.get(page) ?? [],
  }));
  const candidatesFound = pages.reduce((acc, p) => acc + p.candidates.length, 0);
  // 只记计数：不记 folio 文本、不记标题、不记路径。
  logger.warn('[folio-candidates] 完成', {
    pages: unique.length,
    native: nativePages,
    ocr: ocrPages,
    candidates: candidatesFound,
  });
  return ok({
    pageCount,
    pages,
    diagnostics: {
      pagesRequested: unique.length,
      nativePages,
      ocrPages,
      candidatesFound,
    },
  });
}
