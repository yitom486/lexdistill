import { BusinessError, err, generateId, isOk, logger, ok, type Result } from '@study-studio/shared';
import { StructureClassSchema, type DocumentItem, type StructureClass } from '@study-studio/protocol';
import { parseTextbookAST, type TextbookAST } from '@study-studio/document-model';
import { ensurePdfRuntime, type PdfInspectorLike } from '../../../../infrastructure/pdf-runtime/pdf-runtime.js';
import { classifyEmbeddedOutline, type EmbeddedOutlineEntry } from '@study-studio/content';
import { markdownToAst, promoteLessonHeadings } from '@study-studio/content';
import { extractHeadingsFromMarkdown, extractTocEntries, type PageHeading, type TocEntry } from '@study-studio/content';
import { collectLayoutCandidates } from './layout-headings.js';
import { fireLinesProjection, type LinesProjectionHook } from '../lines-projection-hook.js';
import { mergeHeadingCandidates } from '@study-studio/content';
export const MAX_PDF_BYTES = 200 * 1024 * 1024;
export const MAX_PDF_PAGES = 400;
export const MAX_MAP_PAGES = 30;
export interface PdfImportInput {
  userId: string;
  filename: string;
  bytes: Uint8Array;
  /** 1-based PDF 物理页；未指定时读取原生文字。 */
  pages?: number[];
  /**
   * CMD-01：用户已确认、已接地的结构分类（原样透传，convert 侧 zod 校验后驱动切课）。
   * 缺席/空数组 = 旧正则切课行为。不提供则旧行为。
   */
  classes?: unknown;
}

export interface PdfImportClassification {
  pdfType: string;
  pageCount: number;

  selectedPages: number[];
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
   * 唯一 canonical AST 写入口（必需，无退化）。
   * append/import 必须经此保存（documents 写回 + shred 同一事务），缺失即调用方装配错误。
   * 测试必须显式提供 atomic fake（内存实现或 repo.saveCanonicalAst）。
   */
  saveCanonicalAst: (docBase: Omit<DocumentItem, 'astJson'>, book: TextbookAST) => Promise<Result<DocumentItem, BusinessError>>;
  /**
   * lines 投影钩子（必需，无静默跳过；P2-2a）。
   * 生产装配 repo.projectLinesSegments；测试显式提供 recorder 或真实现。
   */
  projectLinesSegments: LinesProjectionHook;
  /** 测试注入：跳过真实下载/原生绑定 */
  loadInspector?: () => Promise<PdfInspectorLike>;
  runtimeDir?: string;
}

/** 1-based 连续页窗 [start, end]（首尾收敛，end < start 即空窗；P2 发现模块复用）。 */
export function rangePages(start: number, end: number): number[] {
  const pages: number[] = [];
  for (let p = Math.max(1, Math.floor(start)); p <= Math.floor(end); p++) pages.push(p);
  return pages;
}

/**
 * CMD-10 轻量探页数：processPdf(bytes,[1]) 仍返回全书 pageCount（探针实测），
 * 不扫全书内容。失败/非法回 0，调用方回退常规错误（不静默成功）。
 */
export function probePdfPageCount(inspector: PdfInspectorLike, bytes: Uint8Array): number {
  try {
    const probe = inspector.processPdf(bytes, [1]);
    const n = Number(probe.pageCount ?? 0);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

export interface PdfMapOutput {
  classification: PdfImportClassification;
  window: number[];
  headings: PageHeading[];
  tocEntries: TocEntry[];
  /** CMD-LINGUA-P1A：目录来源（embedded = 原生目录命中且可用，none = 走既有原生信息窗口）。 */
  outlineSource: 'embedded' | 'none';
  /**
   * 校验后的原生目录条目（仅可用项：title 非空、level ≥1 整数、
   * physicalPage 为落在真实页数内的 1-based 页；不可解析/越界项丢弃不猜）。
   * none 时为空数组；绝不混入 TocEntry.printedPage 语义。
   */
  embeddedOutline: EmbeddedOutlineEntry[];
  detectedTocRange?: null;
}

/** 校验后的单条原生目录（M8-5 起由 canonical 出口定义，此处仅兼容重导出）。 */
export type { EmbeddedOutlineEntry } from '@study-studio/content';

/**
 * CMD-LINGUA-P2.2：旧内置目录读取已收归 `embedded-outline-quality.ts` 的
 * `classifyEmbeddedOutline`（唯一判定：none/usable/unusable），本模块不再
 * 保留旧函数。5 处 consumer（map/discover/stream/baseline/material）全部
 * 显式走 classifier，日志统一只记状态/reason/计数。
 */

/**
 * 结构预览（目录感知导入第一步）：扫一个窗口页（默认前 30 页），
 * 返回每页标题 + 目录条目。调用方按标题页选范围，再调 convertPdfToAst 精确导入。
 * 有目录 → 目录条目即 ground truth；无目录 → 分段扫全书标题建地图。
 */
export async function mapPdfPages(deps: Pick<PdfImportServiceDeps, 'loadInspector' | 'runtimeDir'>, input: PdfImportInput): Promise<Result<PdfMapOutput, BusinessError>> {
  const valid = validatePdfInput(input); if (!valid.ok) return valid;
  try {
    const { inspector } = await ensurePdfRuntime(deps);
    const pageCount = probePdfPageCount(inspector, input.bytes);
    if (!pageCount) return err(new BusinessError('E_PDF_PARSE', 'PDF 页数识别失败，请检查文件', 'TOOL_EXECUTION'));
    const window = input.pages ?? rangePages(1, Math.min(MAX_MAP_PAGES, pageCount));
    if (!window.length || window.some(page => !Number.isSafeInteger(page) || page < 1 || page > pageCount)) return err(new BusinessError('E_INVALID_INPUT', '目录页范围超出教材页数', 'VALIDATION'));
    const classified = inspector.processPdf(input.bytes, window);
    const markdown = classified.markdown ?? '';
    const outline = classifyEmbeddedOutline(inspector, input.bytes, pageCount);
    return ok({ classification: { pdfType: classified.pdfType ?? 'Unknown', pageCount, selectedPages: window }, window,
      headings: mergeHeadingCandidates(extractHeadingsFromMarkdown(markdown, window[0] ?? 1), collectLayoutCandidates(inspector, input.bytes, window)),
      tocEntries: extractTocEntries(markdown), outlineSource: outline.quality === 'usable' ? 'embedded' : 'none', embeddedOutline: outline.quality === 'usable' ? outline.entries : [], detectedTocRange: null });
  } catch (cause) { return err(cause instanceof BusinessError ? cause : new BusinessError('E_PDF_PARSE', 'PDF 信息读取失败，请检查文件后重试', 'TOOL_EXECUTION')); }
}

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

export function validatePdfInput(input: PdfImportInput): Result<void, BusinessError> {
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

/** Native text conversion for existing text-document commands. Scans use the chapter Agent flow. */
export async function convertPdfToAst(deps: Pick<PdfImportServiceDeps, 'loadInspector' | 'runtimeDir'>, input: PdfImportInput): Promise<Result<PdfAstOutput, BusinessError>> {
  const valid = validatePdfInput(input); if (!valid.ok) return valid;
  const classes = parseStructureClasses(input.classes); if (!classes.ok) return classes;
  try {
    const { inspector } = await ensurePdfRuntime(deps);
    const pageCount = probePdfPageCount(inspector, input.bytes);
    if (!pageCount) return err(new BusinessError('E_PDF_PARSE', 'PDF 页数识别失败，请检查文件', 'TOOL_EXECUTION'));
    const pages = input.pages ?? rangePages(1, pageCount);
    if (pageCount > MAX_PDF_PAGES) return err(new BusinessError('E_INVALID_INPUT', '此文字直提入口仅支持 400 页内文件；大教材请使用按章整理', 'VALIDATION'));
    if (!pages.length || pages.some(page => !Number.isSafeInteger(page) || page < 1 || page > pageCount)) return err(new BusinessError('E_INVALID_INPUT', '选页超出教材范围', 'VALIDATION'));
    const classified = inspector.processPdf(input.bytes, pages);
    const markdown = classified.markdown ?? '';
    if (!markdown.trim()) return err(new BusinessError('E_PDF_TEXT_EMPTY', '这些页面没有文字层，请通过教材按章整理让模型读取 PDF', 'TOOL_EXECUTION'));
    const promoted = promoteLessonHeadings(markdown, { headings: mergeHeadingCandidates(extractHeadingsFromMarkdown(markdown, pages[0] ?? 1), collectLayoutCandidates(inspector, input.bytes, pages)), tocEntries: extractTocEntries(markdown) });
    const ast = markdownToAst(promoted, { title: input.filename.replace(/\.pdf$/i, ''), ...(classes.value ? { classes: classes.value } : {}) });
    if (!ast.ok) return ast;
    const checked = parseTextbookAST(ast.value); if (!checked.ok) return checked;
    const book = checked.value;
    return ok({ book, markdown, classification: { pdfType: classified.pdfType ?? 'Unknown', pageCount, selectedPages: pages }, stats: { lessons: book.lessons.length, dialogues: book.lessons.reduce((sum, lesson) => sum + lesson.dialogues.length, 0) } });
  } catch (cause) { return err(cause instanceof BusinessError ? cause : new BusinessError('E_PDF_PARSE', 'PDF 文字读取失败，请检查文件后重试', 'TOOL_EXECUTION')); }
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
  // P2-2a：提交后显式 lines 投影（失败只 warn，不挡导入）。
  await fireLinesProjection(deps.projectLinesSegments, 'pdf-import', input.userId, saved.value.id);
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
  // P2-2a：接力追加后显式 lines 投影（整单事务化，hash 幂等覆盖新增课）。
  await fireLinesProjection(deps.projectLinesSegments, 'pdf-append', input.userId, saved.value.id);
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
