import { BusinessError, err, logger, ok, type Result } from '@study-studio/shared';
import { ensurePdfRuntime, type PdfInspectorLike } from './pdf-runtime.js';
import {
  probePdfPageCount,
  rangePages,
  readEmbeddedOutlineEntries,
  validatePdfInput,
  type PdfImportServiceDeps,
} from './pdf-import-service.js';

/**
 * CMD-LINGUA-P4A-2：已确认目录页范围的 review material（只读，内部服务）。
 *
 * 为“已确认的目录页范围”生成受限 PNG，供未来 P4B Agent attachment 使用。
 * 只在内存返回 `pageNumber + PNG Buffer + width + height`：
 * 不经 HTTP 返回原始 PDF，不写文件/DB/AST/cache，不记录图片、标题、OCR 原文、PDF 路径，
 * 不做模型调用。页数超过 8 明确拒绝，绝不静默截断。
 */

/**
 * 范围窗上限（页）：与 fork 原生上限对齐（单测锁死 == 8），绝不抬高。
 * 注：Gateway 不能引用 fork 常量（异仓），此处镜像并用单测双向锁定。
 */
export const TOC_REVIEW_MAX_PAGES = 8;

export interface TocReviewPage {
  /** 1-based PDF 页码（与去重后请求顺序对应）。 */
  pageNumber: number;
  /** PNG 编码字节（内存态，调用方用完即弃）。 */
  png: Uint8Array;
  /** 像素宽（原生报告的真实值）。 */
  width: number;
  /** 像素高（原生报告的真实值）。 */
  height: number;
}

export interface TocReviewMaterialInput {
  userId: string;
  filename: string;
  bytes: Uint8Array;
  fromPage: number;
  toPage: number;
}

export interface TocReviewMaterialOutput {
  range: { fromPage: number; toPage: number };
  pageCount: number;
  pages: TocReviewPage[];
  /**
   * true = 原生目录可用，本次零渲染（pages 为空）；
   * 调用方应直接用 map 的 embeddedOutline，而非渲染目录页。
   */
  embedded: boolean;
}

/**
 * 目录页 review 材料编排（只读）：范围形状校验 → 运行时（PDFium-only）→
 * 探页数 → 范围越界校验 → embedded 短路 → 受限渲染。日志只记计数。
 */
export async function prepareTocReviewMaterial(
  deps: Pick<PdfImportServiceDeps, 'loadInspector' | 'runtimeDir'>,
  input: TocReviewMaterialInput
): Promise<Result<TocReviewMaterialOutput, BusinessError>> {
  const valid = validatePdfInput({ userId: input.userId, filename: input.filename, bytes: input.bytes });
  if (!valid.ok) return err(valid.error);
  const { fromPage, toPage } = input;
  if (!Number.isInteger(fromPage) || !Number.isInteger(toPage) || fromPage < 1 || toPage < fromPage) {
    return err(
      new BusinessError('E_INVALID_INPUT', '请提供已确认的目录页范围（fromPage/toPage，非空且 fromPage ≤ toPage）', 'VALIDATION')
    );
  }
  if (toPage - fromPage + 1 > TOC_REVIEW_MAX_PAGES) {
    return err(
      new BusinessError(
        'E_INVALID_INPUT',
        `确认范围共 ${toPage - fromPage + 1} 页（ review 材料单次上限 ${TOC_REVIEW_MAX_PAGES} 页），请缩小后重试`,
        'VALIDATION'
      )
    );
  }
  let inspector: PdfInspectorLike;
  try {
    // 页面渲染只要 PDFium（不要 ORT/模型）；PDFIUM_LIB_PATH 在此就绪。
    const runtime = await ensurePdfRuntime({
      ...(deps.loadInspector ? { loadInspector: deps.loadInspector } : {}),
      ...(deps.runtimeDir ? { runtimeDir: deps.runtimeDir } : {}),
      needPdfium: true,
    });
    inspector = runtime.inspector;
  } catch (e) {
    return err(
      e instanceof BusinessError
        ? e
        : new BusinessError('E_RUNTIME_LOAD', 'PDF 解析运行时准备失败，请检查网络后重试', 'NETWORK')
    );
  }
  // 诚实页数（[1] 轻探针，不扫全书），再验范围越界——都在渲染之前。
  const pageCount = probePdfPageCount(inspector, input.bytes);
  if (!Number.isFinite(pageCount) || pageCount < 1) {
    return err(new BusinessError('E_PDF_PARSE', 'PDF 页数识别失败，文件可能已损坏', 'TOOL_EXECUTION'));
  }
  if (toPage > pageCount) {
    return err(new BusinessError('E_INVALID_INPUT', `确认范围超出本书（本书共 ${pageCount} 页）`, 'VALIDATION'));
  }
  // P1 embedded 可用 → 零渲染，直接返回可解释的空结果（不伪造图片）。
  if (readEmbeddedOutlineEntries(inspector, input.bytes, pageCount)) {
    return ok({
      range: { fromPage, toPage },
      pageCount,
      pages: [],
      embedded: true,
    });
  }
  if (typeof inspector.renderPdfPages !== 'function') {
    return err(
      new BusinessError('E_RUNTIME_LOAD', '当前 PDF 运行时不支持页面渲染，请重启网关以下载新运行时', 'TOOL_EXECUTION')
    );
  }
  const window = rangePages(fromPage, toPage);
  let rendered: Array<{ pageNumber: number; png: Uint8Array; width: number; height: number }>;
  try {
    rendered = await inspector.renderPdfPages(input.bytes, window);
  } catch (e) {
    return err(
      e instanceof BusinessError
        ? e
        : new BusinessError('E_PDF_PARSE', '目录页渲染失败，请稍后重试', 'TOOL_EXECUTION')
    );
  }
  const pages: TocReviewPage[] = [];
  for (const page of rendered) {
    if (
      !page ||
      typeof page !== 'object' ||
      typeof (page as { pageNumber?: unknown }).pageNumber !== 'number' ||
      !((page as { png?: unknown }).png instanceof Uint8Array) ||
      typeof (page as { width?: unknown }).width !== 'number' ||
      typeof (page as { height?: unknown }).height !== 'number'
    ) {
      return err(new BusinessError('E_PDF_PARSE', '目录页渲染返回异常，请稍后重试', 'TOOL_EXECUTION'));
    }
    const typed = page as { pageNumber: number; png: Uint8Array; width: number; height: number };
    pages.push({ pageNumber: typed.pageNumber, png: typed.png, width: typed.width, height: typed.height });
  }
  // 只记计数：不记图片、标题、原文、路径。
  logger.warn('[toc-review-material] 完成', {
    range: `${fromPage}-${toPage}`,
    pages: pages.length,
    bytes: pages.reduce((acc, p) => acc + p.png.length, 0),
  });
  return ok({ range: { fromPage, toPage }, pageCount, pages, embedded: false });
}
