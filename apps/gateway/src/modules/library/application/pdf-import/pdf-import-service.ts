import { BusinessError, err, generateId, isOk, logger, ok, type Result } from '@study-studio/shared';
import { parseTextbookAST, StructureClassSchema, type DocumentItem, type TextbookAST, type StructureClass } from '@study-studio/protocol';
import { ensurePdfRuntime, type PdfInspectorLike } from './pdf-runtime.js';
import { detectDocScript, markdownToAst, promoteLessonHeadings } from './markdown-to-ast.js';
import { extractHeadingsFromMarkdown, extractTocEntries, type PageHeading, type TocEntry } from './extract-headings.js';
import { collectLayoutCandidates, layoutItemsToCandidates, mergeHeadingCandidates, type LayoutTextItem } from './layout-headings.js';
import { buildPdfConvertReport, buildPdfMapReport, buildOcrOverflowError } from './pdf-import-report.js';
import {
  analyzePagesWithAzure,
  AZURE_FALLBACK_MIN_CHARS,
  type AzureOcrPage,
} from '../ocr/azure-document.js';

/**
 * PDF 导入编排：校验 → 按需运行时 → 分类（文字直提 / 扫描 OCR）→ AST → 入库。
 * 语言与 OCR 覆盖（2026-09-06 spike 实测）：
 * - 文字版：JA/KO/EN 均可直接提取；
 * - 扫描版：JA/EN 走自带 PP-OCRv6；KO 交白卷 → 返回 E_OCR_LANG_UNSUPPORTED，
 *   不臆造、不静默降级。
 */

export const MAX_PDF_BYTES = 200 * 1024 * 1024;
export const MAX_PDF_PAGES = 400;
/** 单次导入最多 OCR 页数（约 0.7s/页；大书请按课分段选页导入） */
export const MAX_OCR_PAGES_PER_IMPORT = 30;
/** 结构预览默认/上限扫描窗口（页） */
export const MAX_MAP_PAGES = 30;
/** 单次云回填上限（页；Azure 按页计费，30 页约几分钱，轮询 120s 内可完成） */
export const MAX_AZURE_PAGES_PER_CALL = 30;

/**
 * 失败页挑选（纯函数，可单测）：本地结果过薄（去空 < 阈值）的页才值得打云。
 * 稀疏但合法的页（练习留白）可能被多打一页，接受（用户显式给了 Key 才触发）。
 */
export function selectFailedPages(pageMarkdown: Map<number, string>): number[] {
  const out: number[] = [];
  for (const [page, md] of pageMarkdown) {
    if ((md ?? '').trim().length < AZURE_FALLBACK_MIN_CHARS) out.push(page);
  }
  return out.sort((a, b) => a - b);
}

/** Azure 行 → 版式条目（云页复活 relSize/居中/独立行；粗体 v1 缺席，见 azure-document）。 */
export function azureLinesToLayoutItems(azure: AzureOcrPage): LayoutTextItem[] {
  return azure.lines
    .filter((l) => l.text.trim().length > 0)
    .map((l) => ({
      text: l.text,
      page: azure.pageNumber,
      x: l.x,
      y: l.y,
      width: l.width,
      height: l.height > 0 ? l.height : 12,
      fontSize: l.height > 0 ? l.height : 12,
      isBold: false,
    }));
}

function detectAzureLocale(sample: string): string {
  const script = detectDocScript(sample);
  if (script === 'KO') return 'ko';
  if (script === 'EN') return 'en';
  return 'ja';
}

export interface PdfImportInput {
  userId: string;
  filename: string;
  bytes: Uint8Array;
  /** 1-based ????????= ?????????????????*/
  pages?: number[];
  /**
   * CMD-01：用户已确认、已接地的结构分类（原样透传，convert 侧 zod 校验后驱动切课）。
   * 缺席/空数组 = 旧正则切课行为。不提供则旧行为。
   */
  classes?: unknown;
  /**
   * Azure 云 OCR 凭据（失败页回填用；随请求内存态传递，网关不落盘、不打日志）。
   * 不提供 = 纯本地链路（行为不变）。
   */
  azure?: { endpoint: string; apiKey: string };
}

export interface PdfImportClassification {
  pdfType: string;
  pageCount: number;
  pagesNeedingOcr: number[];
  ocrUsed: boolean;
  selectedPages: number[];
  /** 云回填命中的页（来源可追溯；无云调用时缺席） */
  azurePages?: number[];
  /**
   * CMD-08 全部页夹持标志：扫描书超单次 OCR 上限时，网关不直接失败，
   * 而对首个 30 页窗真正转换一次并置 true（弹窗据此提示接力）。
   */
  clampedFromAll?: boolean;
}

export interface PdfImportStats {
  lessons: number;
  dialogues: number;
}

export interface PdfImportOutput {
  document: DocumentItem;
  book: TextbookAST;
  classification: PdfImportClassification;
  stats: PdfImportStats;
}

export interface PdfAstOutput {
  book: TextbookAST;
  markdown: string;
  classification: PdfImportClassification;
  stats: PdfImportStats;
}

export interface PdfImportServiceDeps {
  saveDocument: (doc: DocumentItem) => Promise<Result<DocumentItem, BusinessError>>;
  /**
   * 唯一 canonical AST 写入口（必需，无退化）：
   * append/import 必须经此保存（documents 写回 + shred 同一事务），缺失即调用方装配错误。
   * 测试必须显式提供 atomic fake（内存实现或 repo.saveCanonicalAst）。
   */
  saveCanonicalAst: (docBase: Omit<DocumentItem, 'astJson'>, book: TextbookAST) => Promise<Result<DocumentItem, BusinessError>>;
  /** 测试注入：跳过真实下载/原生绑定 */
  loadInspector?: () => Promise<PdfInspectorLike>;
  runtimeDir?: string;
}

function errorMessage(e: unknown): string {
  if (e instanceof BusinessError) return e.userMessage;
  return 'PDF 解析运行时异常，请稍后重试';
}

export interface PdfMapOutput {
  classification: PdfImportClassification;
  window: number[];
  headings: PageHeading[];
  tocEntries: TocEntry[];
}

/**
 * 结构预览（目录感知导入第一步）：扫一个窗口页（默认前 30 页），
 * 返回每页标题 + 目录条目。调用方按标题页选范围，再调 convertPdfToAst 精确导入。
 * 有目录 → 目录条目即 ground truth；无目录 → 分段扫全书标题建地图。
 */
export async function mapPdfPages(
  deps: Pick<PdfImportServiceDeps, 'loadInspector' | 'runtimeDir'>,
  input: PdfImportInput
): Promise<Result<PdfMapOutput, BusinessError>> {
  const check = validatePdfInput(input);
  if (!check.ok) return err(check.error);
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
  let classification: {
    pdfType?: string;
    pageCount?: number;
    pagesNeedingOcr?: number[];
    confidence?: number;
  };
  try {
    classification = inspector.processPdf(input.bytes);
  } catch (e) {
    logger.warn('[pdf-map] processPdf failed', { message: errorMessage(e) });
    return err(new BusinessError('E_PDF_PARSE', 'PDF 解析失败（文件可能加密或已损坏）', 'TOOL_EXECUTION'));
  }
  const pdfType = String(classification.pdfType ?? 'Unknown');
  const pageCount = Number(classification.pageCount ?? 0);
  if (!Number.isFinite(pageCount) || pageCount < 1) {
    return err(new BusinessError('E_PDF_PARSE', 'PDF 页数识别失败，文件可能已损坏', 'TOOL_EXECUTION'));
  }
  const window: number[] = [];
  if (input.pages !== undefined) {
    const cleaned = [...new Set(input.pages)].filter(
      (n) => Number.isInteger(n) && n >= 1 && n <= pageCount
    );
    if (cleaned.length === 0) {
      return err(new BusinessError('E_INVALID_INPUT', `选页超出范围（本书共 ${pageCount} 页）`, 'VALIDATION'));
    }
    cleaned.sort((a, b) => a - b);
    window.push(...cleaned.slice(0, MAX_MAP_PAGES));
  } else {
    for (let p = 1; p <= Math.min(pageCount, MAX_MAP_PAGES); p++) window.push(p);
  }
  const needing = Array.isArray(classification.pagesNeedingOcr)
    ? classification.pagesNeedingOcr.filter((n): n is number => typeof n === 'number')
    : [];
  try {
    const runtime = await ensurePdfRuntime({
      ...(deps.loadInspector ? { loadInspector: deps.loadInspector } : {}),
      ...(deps.runtimeDir ? { runtimeDir: deps.runtimeDir } : {}),
      needOcr: window.some((p) => needing.includes(p)),
    });
    inspector = runtime.inspector;
    const ocr = await inspector.processPdfWithOcr(input.bytes, { pageNumbers: window });
    const perPage = Array.isArray(ocr.pages) ? ocr.pages : [];
    // Azure 失败页回填（显式给了 Key 才触发；失败只 warn，本地结果不受影响）
    let azurePages: AzureOcrPage[] = [];
    if (input.azure?.apiKey) {
      const perPageMd = new Map<number, string>();
      if (perPage.length > 0) {
        for (const pg of perPage) {
          perPageMd.set(pg.pageNumber, typeof pg.markdown === 'string' ? pg.markdown : '');
        }
      } else {
        perPageMd.set(window[0] ?? 1, typeof ocr.markdown === 'string' ? ocr.markdown : '');
      }
      const failed = selectFailedPages(perPageMd).slice(0, MAX_AZURE_PAGES_PER_CALL);
      if (failed.length > 0) {
        const az = await analyzePagesWithAzure({
          pdfBytes: input.bytes,
          pages: failed,
          credentials: input.azure,
          locale: detectAzureLocale([...perPageMd.values()].join('\n')),
        });
        if (isOk(az)) {
          azurePages = az.value.pages;
          const byPage = new Map(azurePages.map((p) => [p.pageNumber, p]));
          for (const pg of perPage) {
            const hit = byPage.get(pg.pageNumber);
            if (hit && hit.markdown.trim()) pg.markdown = hit.markdown;
          }
          const single = byPage.get(window[0] ?? 1);
          if (perPage.length === 0 && single && single.markdown.trim()) {
            ocr.markdown = single.markdown;
          }
        } else {
          logger.warn('[pdf-map] azure fallback failed', {
            code: az.error.code,
            pages: failed.length,
          });
        }
      }
    }
    let headings: PageHeading[] = [];
    let combined = '';
    if (perPage.length > 0) {
      for (const pg of perPage) {
        const md = typeof pg.markdown === 'string' ? pg.markdown : '';
        headings.push(...extractHeadingsFromMarkdown(md, pg.pageNumber));
      }
      combined = perPage.map((pg) => (typeof pg.markdown === 'string' ? pg.markdown : '')).join('\n');
    } else {
      combined = typeof ocr.markdown === 'string' ? ocr.markdown : '';
      headings.push(...extractHeadingsFromMarkdown(combined, window[0] ?? 1));
    }
    // 版式候选（原生接口 + Azure 云行框，两路都失败就纯正则，不影响主流程）
    const azureItems: LayoutTextItem[] = [];
    for (const ap of azurePages) azureItems.push(...azureLinesToLayoutItems(ap));
    headings = mergeHeadingCandidates(
      headings,
      [
        ...collectLayoutCandidates(inspector, input.bytes, window),
        ...layoutItemsToCandidates(azureItems, []),
      ]
    );
    const azureHitPages = azurePages.filter((p) => p.markdown.trim()).map((p) => p.pageNumber);
    const ocrUsed = window.some((p) => needing.includes(p));
    const tocEntries = extractTocEntries(combined);
    logger.warn(
      '[pdf-map] 结构预览完成',
      buildPdfMapReport({
        pageCount,
        window,
        ocrUsed,
        ocrPages: needing.filter((p) => window.includes(p)),
        headings,
        tocCount: tocEntries.length,
      })
    );
    return ok({
      classification: {
        pdfType,
        pageCount,
        pagesNeedingOcr: needing,
        ocrUsed,
        selectedPages: window,
        ...(azureHitPages.length > 0 ? { azurePages: azureHitPages } : {}),
      },
      window,
      headings,
      tocEntries,
    });
  } catch (e) {
    logger.warn('[pdf-map] map window failed', { message: errorMessage(e) });
    return err(
      e instanceof BusinessError
        ? e
        : new BusinessError('E_PDF_PARSE', '结构预览失败，请稍后重试', 'TOOL_EXECUTION')
    );
  }
}

/**
 * CMD-01：已确认结构分类的信任边界收窄（zod 全量校验）。
 * - 缺席/空数组 = 未提供，走旧正则切课；
 * - 非数组或任一条目非法 = 友好 BusinessError（调用方零写，绝不抛底层栈）。
 */
function parseStructureClasses(raw: unknown): Result<StructureClass[] | undefined, BusinessError> {
  if (raw === undefined) return ok(undefined);
  if (!Array.isArray(raw)) {
    return err(new BusinessError('E_INVALID_INPUT', '结构分类格式不正确，请重新分类后导入', 'VALIDATION'));
  }
  if (raw.length === 0) return ok(undefined);
  const out: StructureClass[] = [];
  for (const item of raw.slice(0, 200)) {
    const parsed = StructureClassSchema.safeParse(item);
    if (!parsed.success) {
      return err(new BusinessError('E_INVALID_INPUT', '结构分类含非法条目，请重新分类后导入', 'VALIDATION'));
    }
    out.push(parsed.data);
  }
  return ok(out);
}

function validatePdfInput(input: PdfImportInput): Result<void, BusinessError> {
  if (!input.filename.toLowerCase().endsWith('.pdf')) {
    return err(new BusinessError('E_INVALID_INPUT', '只支持 .pdf 文件导入', 'VALIDATION'));
  }
  if (input.bytes.length === 0 || input.bytes.length > MAX_PDF_BYTES) {
    return err(
      new BusinessError('E_INVALID_INPUT', 'PDF 文件过大（上限 200MB），请检查文件', 'VALIDATION')
    );
  }
  const magic = Buffer.from(input.bytes.subarray(0, 5)).toString('latin1');
  if (magic !== '%PDF-') {
    return err(new BusinessError('E_INVALID_INPUT', '文件头不是合法 PDF，请确认文件未损坏', 'VALIDATION'));
  }
  return ok(undefined);
}

export async function convertPdfToAst(
  deps: Pick<PdfImportServiceDeps, 'loadInspector' | 'runtimeDir'>,
  input: PdfImportInput
): Promise<Result<PdfAstOutput, BusinessError>> {
  const valid = validatePdfInput(input);
  if (!valid.ok) return err(valid.error);
  // CMD-01：classes 非法直接友好失败（运行时准备之前，零副作用）。
  const classesRes = parseStructureClasses(input.classes);
  if (!classesRes.ok) return err(classesRes.error);

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

  let classification: {
    pdfType?: string;
    pageCount?: number;
    markdown?: string | null;
    pagesNeedingOcr?: number[];
    confidence?: number;
  };
  try {
    classification = inspector.processPdf(input.bytes);
  } catch (e) {
    logger.warn('[pdf-import] processPdf failed', { message: errorMessage(e) });
    return err(new BusinessError('E_PDF_PARSE', 'PDF 解析失败（文件可能加密或已损坏）', 'TOOL_EXECUTION'));
  }

  const pdfType = String(classification.pdfType ?? 'Unknown');
  const pageCount = Number(classification.pageCount ?? 0);
  const pagesNeedingOcr = Array.isArray(classification.pagesNeedingOcr)
    ? classification.pagesNeedingOcr.filter((n): n is number => typeof n === 'number')
    : [];
  if (!Number.isFinite(pageCount) || pageCount < 1) {
    return err(new BusinessError('E_PDF_PARSE', 'PDF 页数识别失败，文件可能已损坏', 'TOOL_EXECUTION'));
  }
  if (pageCount > MAX_PDF_PAGES) {
    return err(
      new BusinessError(
        'E_INVALID_INPUT',
        `PDF 共 ${pageCount} 页（上限 ${MAX_PDF_PAGES} 页），请按课分段选页导入`,
        'VALIDATION'
      )
    );
  }

  // 选页校验（1-based；不传 = 全书）
  let selectedPages: number[] | null = null;
  if (input.pages !== undefined) {
    const cleaned = [...new Set(input.pages)].filter(
      (n) => Number.isInteger(n) && n >= 1 && n <= pageCount
    );
    if (cleaned.length === 0) {
      return err(
        new BusinessError('E_INVALID_INPUT', `选页超出范围（本书共 ${pageCount} 页）`, 'VALIDATION')
      );
    }
    if (cleaned.length > MAX_PDF_PAGES) {
      return err(
        new BusinessError('E_INVALID_INPUT', `一次最多导入 ${MAX_PDF_PAGES} 页，请缩小范围`, 'VALIDATION')
      );
    }
    cleaned.sort((a, b) => a - b);
    selectedPages = cleaned;
  }
  const inScope = (n: number) => !selectedPages || selectedPages.includes(n);

  let markdown = '';
  let ocrUsed = false;
  // CMD-08：全部页扫描超限不先失败——夹持到首个 30 页窗真正转换一次（上限仍 30）。
  let clampedFromAll = false;
  if (
    !selectedPages &&
    typeof classification.markdown === 'string' &&
    !classification.markdown.trim() &&
    pagesNeedingOcr.length > MAX_OCR_PAGES_PER_IMPORT
  ) {
    clampedFromAll = true;
    selectedPages = Array.from(
      { length: Math.min(MAX_OCR_PAGES_PER_IMPORT, pageCount) },
      (_, i) => i + 1
    );
  }
  if (selectedPages) {
    // 选页导入：文字页直提 + 扫描页 OCR（Auto 只路由需 OCR 页）
    try {
      const selectedNeeding = pagesNeedingOcr.filter(inScope);
      if (selectedNeeding.length > MAX_OCR_PAGES_PER_IMPORT) {
        return err(
          buildOcrOverflowError({
            scope: 'range',
            pageCount,
            ocrPages: selectedNeeding,
            limit: MAX_OCR_PAGES_PER_IMPORT,
          })
        );
      }
      const runtime = await ensurePdfRuntime({
        ...(deps.loadInspector ? { loadInspector: deps.loadInspector } : {}),
        ...(deps.runtimeDir ? { runtimeDir: deps.runtimeDir } : {}),
        needOcr: selectedNeeding.length > 0,
      });
      inspector = runtime.inspector;
      if (selectedNeeding.length > 0) {
        const ocr = await inspector.processPdfWithOcr(input.bytes, { pageNumbers: selectedPages });
        markdown = typeof ocr.markdown === 'string' ? ocr.markdown : '';
        ocrUsed = true;
      } else {
        const part = await inspector.processPdf(input.bytes, selectedPages);
        markdown = typeof part.markdown === 'string' ? part.markdown : '';
      }
    } catch (e) {
      logger.warn('[pdf-import] selected pages failed', { message: errorMessage(e) });
      return err(
        e instanceof BusinessError
          ? e
          : new BusinessError('E_PDF_PARSE', '选页提取失败，请稍后重试', 'TOOL_EXECUTION')
      );
    }
  } else {
    markdown = typeof classification.markdown === 'string' ? classification.markdown : '';
    if (!markdown.trim() && pagesNeedingOcr.length > 0) {
      if (pagesNeedingOcr.length > MAX_OCR_PAGES_PER_IMPORT) {
        return err(
          buildOcrOverflowError({
            scope: 'all',
            pageCount,
            ocrPages: pagesNeedingOcr,
            limit: MAX_OCR_PAGES_PER_IMPORT,
          })
        );
      }
      // 扫描页：按需准备 OCR 运行时（PDFium + ORT + 模型，不进安装包）
      try {
        const runtime = await ensurePdfRuntime({
          ...(deps.loadInspector ? { loadInspector: deps.loadInspector } : {}),
          ...(deps.runtimeDir ? { runtimeDir: deps.runtimeDir } : {}),
          needOcr: true,
        });
        inspector = runtime.inspector;
        const ocr = await inspector.processPdfWithOcr(input.bytes);
        markdown = typeof ocr.markdown === 'string' ? ocr.markdown : '';
        ocrUsed = true;
        const hosted = Array.isArray(ocr.pagesRecommendingHosted) ? ocr.pagesRecommendingHosted.length : 0;
        if (hosted > 0) {
          logger.info('[pdf-import] 部分页面 OCR 置信度低，建议改用文字版 PDF', { hosted });
        }
      } catch (e) {
        return err(
          e instanceof BusinessError
            ? e
            : new BusinessError('E_OCR_FAILED', 'OCR 运行时准备失败，请检查网络后重试', 'NETWORK')
        );
      }
    }
  }

  // 本地零产出且无云钥：直接报错（有钥则落到下面的云回填，不在此提前 return）。
  // 注意：零产出≠韩语——空白页/纯图页同样零产出，文案不得断言具体语种（实测：无字形状页也走这里）。
  if (!markdown.trim() && !input.azure?.apiKey) {
    return err(
      new BusinessError(
        'E_OCR_LANG_UNSUPPORTED',
        '未能从 PDF 中识别出文字：可能是纯图片页/空白页，或扫描语种暂无本地模型覆盖。请改用文字版 PDF，或在设置页填入 Azure Key 走云端识别',
        'TOOL_EXECUTION'
      )
    );
  }

  // Azure 失败页回填（convert 侧：整窗过薄才整窗打云；给了 Key 才触发）
  let azureHitPages: number[] = [];
  let azureItems: LayoutTextItem[] = [];
  if (input.azure?.apiKey) {
    const windowPages =
      selectedPages ??
      Array.from({ length: Math.min(pageCount, MAX_AZURE_PAGES_PER_CALL) }, (_, i) => i + 1);
    const thin =
      markdown.trim().length < AZURE_FALLBACK_MIN_CHARS * windowPages.length;
    if (thin && !selectedPages && pageCount > MAX_AZURE_PAGES_PER_CALL) {
      logger.warn('[pdf-import] azure skipped (whole-book convert too wide)', { pageCount });
    } else if (thin) {
      const az = await analyzePagesWithAzure({
        pdfBytes: input.bytes,
        pages: windowPages,
        credentials: input.azure,
        locale: detectAzureLocale(markdown),
      });
      if (isOk(az)) {
        const got = [...az.value.pages]
          .sort((a, b) => a.pageNumber - b.pageNumber)
          .filter((p) => p.markdown.trim());
        if (got.length > 0) {
          markdown = got.map((p) => p.markdown).join('\n');
          azureHitPages = got.map((p) => p.pageNumber);
          for (const p of got) azureItems.push(...azureLinesToLayoutItems(p));
          ocrUsed = true;
        }
      } else {
        logger.warn('[pdf-import] azure fallback failed', { code: az.error.code });
      }
    }
  }

  const title = input.filename.replace(/\.pdf$/i, '');
  if (!markdown.trim()) {
    return err(
      new BusinessError(
        'E_OCR_FAILED',
        '本地与云端均未识别出文字（云端可能配额不足或页窗过大），请缩小选页范围后重试',
        'TOOL_EXECUTION'
      )
    );
  }
  // CMD-02：与 mapPdfPages 同源的标题候选（markdown 抽取 + layout 版式；Azure 行框有则一并）。
  // 无模型：只把“像课标题的行”提升为 `#` 切课点，再交现有 markdownToAst（可带 classes）。
  // layout 接口缺席/异常时 collect 内部降级为空，纯 markdown 规则照常工作。
  const layoutWindow = selectedPages ?? Array.from({ length: pageCount }, (_, i) => i + 1);
  const promoted = promoteLessonHeadings(markdown, {
    headings: mergeHeadingCandidates(
      extractHeadingsFromMarkdown(markdown, layoutWindow[0] ?? 1),
      [
        ...collectLayoutCandidates(inspector, input.bytes, layoutWindow),
        ...layoutItemsToCandidates(azureItems, []),
      ]
    ),
    tocEntries: extractTocEntries(markdown),
  });
  const astRes = markdownToAst(
    promoted,
    { title, ...(classesRes.value ? { classes: classesRes.value } : {}) }
  );
  if (!astRes.ok) return err(astRes.error);
  // 协议层再验一次：服务绝不向外吐出非法 AST
  const checked = parseTextbookAST(astRes.value);
  if (!checked.ok) return err(checked.error);
  const book = checked.value;

  const stats: PdfImportStats = {
    lessons: book.lessons.length,
    dialogues: book.lessons.reduce((acc, l) => acc + l.dialogues.length, 0),
  };
  const outClassification = {
    pdfType,
    pageCount,
    pagesNeedingOcr: pagesNeedingOcr.filter(inScope),
    ocrUsed,
    selectedPages: selectedPages ?? [],
    ...(azureHitPages.length > 0 ? { azurePages: azureHitPages } : {}),
    ...(clampedFromAll ? { clampedFromAll: true } : {}),
  };
  logger.warn(
    '[pdf-import] 转换完成',
    buildPdfConvertReport({
      title: book.title,
      pdfType: outClassification.pdfType,
      pageCount: outClassification.pageCount,
      selectedPages: outClassification.selectedPages,
      ocrUsed: outClassification.ocrUsed,
      ocrPages: outClassification.pagesNeedingOcr,
      ...(outClassification.azurePages ? { azurePages: outClassification.azurePages } : {}),
      lessons: stats.lessons,
      dialogues: stats.dialogues,
      lessonTitles: book.lessons.map((l) => l.title),
      ...(clampedFromAll ? { clampedFromAll: true } : {}),
    })
  );
  return ok({
    book,
    markdown,
    classification: outClassification,
    stats,
  });
}

export async function importPdfDocument(
  deps: PdfImportServiceDeps,
  input: PdfImportInput
): Promise<Result<PdfImportOutput, BusinessError>> {
  const converted = await convertPdfToAst(deps, input);
  if (!converted.ok) return err(converted.error);
  const { book, markdown, classification, stats } = converted.value;

  const now = new Date().toISOString();
  // 唯一 canonical 写入口：AST + shred 同一事务（shred 失败整体回滚并 err）。
  const saved = await deps.saveCanonicalAst(
    {
      id: generateId('doc'),
      userId: input.userId,
      title: book.title,
      sourceKind: 'user_import',
      language: book.language.toLowerCase(),
      content: markdown.slice(0, 2000),
      sourcePublisher: 'PDF导入（自有资料）',
      createdAt: now,
      updatedAt: now,
    },
    book
  );
  if (!isOk(saved)) return err(saved.error);
  return ok({ document: saved.value, book, classification, stats });
}

export interface PdfAppendInput extends PdfImportInput {
  documentId: string;
}

export interface PdfAppendOutput {
  document: DocumentItem;
  addedLessons: number;
  addedDialogues: number;
  totalLessons: number;
}

/**
 * 接力追加：把新页段的课接在已有教材后面（大书分段导入）。
 * - lessonNumber 按现有最大值续排；课 id 取自新 AST（pdf-<时间戳> 前缀天然不撞）；
 * - 标题重复不去重（用户可能故意重导覆盖？不——重复导入由用户负责，提示即可）；
 * - 目标文档必须属于该用户且含合法 AST。
 */
export async function appendPdfToDocument(
  deps: PdfImportServiceDeps & {
    getDocument: (documentId: string) => Promise<Result<DocumentItem | null, BusinessError>>;
  },
  input: PdfAppendInput
): Promise<Result<PdfAppendOutput, BusinessError>> {
  const got = await deps.getDocument(input.documentId);
  if (!got.ok) return err(got.error);
  const doc = got.value;
  if (!doc || doc.userId !== input.userId) {
    return err(new BusinessError('E_NOT_FOUND', '未找到指定的教材或文档', 'LEARNER_STATE'));
  }
  if (!doc.astJson) {
    return err(new BusinessError('E_INVALID_INPUT', '该文档没有结构化课文，无法接力', 'VALIDATION'));
  }
  let astRaw: unknown;
  try {
    astRaw = JSON.parse(doc.astJson);
  } catch {
    return err(new BusinessError('E_INVALID_INPUT', '该文档课文结构已损坏，无法接力', 'VALIDATION'));
  }
  const base = parseTextbookAST(astRaw);
  if (!base.ok) return err(base.error);

  const converted = await convertPdfToAst(deps, input);
  if (!converted.ok) return err(converted.error);
  const fresh = converted.value.book;

  const maxNo = base.value.lessons.reduce((m, l) => Math.max(m, l.lessonNumber), 0);
  const appended = fresh.lessons.map((l, i) => ({ ...l, lessonNumber: maxNo + i + 1 }));
  const merged: TextbookAST = { ...base.value, lessons: [...base.value.lessons, ...appended] };
  const rechecked = parseTextbookAST(merged);
  if (!rechecked.ok) return err(rechecked.error);

  // 唯一 canonical 写入口：合并 AST + shred 同一事务（shred 失败整体回滚并 err，
  // 杜绝“AST 已更新、shred 失败仅 WARN”双源漂移；依赖必需，不退化）。
  const { astJson: _dropped, ...docBase } = doc;
  void _dropped;
  const saved = await deps.saveCanonicalAst(
    { ...docBase, updatedAt: new Date().toISOString() },
    rechecked.value
  );
  if (!isOk(saved)) return err(saved.error);
  const addedDialogues = appended.reduce((acc, l) => acc + l.dialogues.length, 0);
  logger.warn('[pdf-import] 接力完成', {
    documentId: input.documentId,
    addedLessons: appended.length,
    addedDialogues,
    totalLessons: rechecked.value.lessons.length,
    addedTitles: appended.map((l) => l.title),
  });
  return ok({
    document: saved.value,
    addedLessons: appended.length,
    addedDialogues,
    totalLessons: rechecked.value.lessons.length,
  });
}
