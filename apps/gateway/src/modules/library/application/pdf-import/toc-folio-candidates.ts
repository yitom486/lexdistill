import { BusinessError, err, logger, ok, type Result } from '@study-studio/shared';
import { ensurePdfRuntime, type PdfInspectorLike } from './pdf-runtime.js';
import {
  probePdfPageCount,
  validatePdfInput,
  type PdfImportServiceDeps,
} from './pdf-import-service.js';
import {
  FOLIO_CANDIDATE_MAX_PAGES,
  FOLIO_OCR_MIN_CONFIDENCE,
  detectFolioCandidates,
  type FolioCandidate,
  type FolioGeometryItem,
} from '@study-studio/content';

/**
 * M8-7：纯检测闭包（detectFolioCandidates 与 Folio* 类型/纯常量）已迁入
 * `@study-studio/content`，本文件保留运行时编排
 *（extractFolioCandidates：页号形状校验 → 运行时 → `[1]` 探页数 → 越界校验 →
 * native（带页窗）→ 无命中页 OCR fallback（同页选择，恒带窗）；输入收窄、
 * 日志只记计数），并具名重导出 canonical 纯规则，既有消费者行为不变。
 *
 * CMD-LINGUA-P5B：受限 folio 候选抽取（只读，从不自动成 anchor）。
 *
 * 输出 candidate 只是弱证据，必须经 P5-C 的双源印证或用户确认才能成为
 * P5-A anchor——类型层面就不产出 anchor 形状（无 printedPage/physicalPage
 * 映射字段），也绝不 import 预览模块。
 */
export {
  FOLIO_CANDIDATE_MAX_PAGES,
  FOLIO_OCR_MIN_CONFIDENCE,
  detectFolioCandidates,
  type FolioCandidate,
  type FolioConfidence,
  type FolioGeometryItem,
  type FolioLocation,
  type FolioNormalized,
  type FolioSource,
} from '@study-studio/content';

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
