import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { BusinessError, err, logger, ok, translateToBusinessError, type Result } from '@lexdistill/shared';
import { classifyEmbeddedOutline } from '@lexdistill/content';
import { defaultRuntimeDir, ensurePdfRuntime, type PdfInspectorLike } from '../../../../infrastructure/pdf-runtime/pdf-runtime.js';

/** Agent 工作区稳定父目录：池子 cwd 与任务临时目录都落在这下面，备料前可先建。 */
export function agentWorkspaceParent(): string {
  return resolve(defaultRuntimeDir(), 'agent-workspace');
}

export interface PdfTaskPageImage {
  /** 切片文件内页码（1 起）。 */
  page: number;
  /** 对应原 PDF 物理页码。 */
  originalPage: number;
  path: string;
}

export interface PdfTaskFile {
  path: string; pageCount: number; originalPages: number[];
  workingDirectory: string;
  /** 仅文字层为空时存在：本轮图片，按切片页序排列。 */
  images: PdfTaskPageImage[];
}

/** 扫描页转图片阈值：文字层空白才烘图，网关只备料、不教模型怎么读。 */
const RENDER_DPI = 150;

/** 内置书签定位目录页（物理页）：走内容层统一判定，无命中/截断/组件缺失时返回 null，不抛错。 */
export function directoryWindow(pageCount: number, physicalPage: number): number[] {
  const start = Math.max(1, physicalPage - 2);
  const end = Math.min(pageCount, physicalPage + 4);
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);
}

async function removeOwnedWorkspace(directory: string, parent: string): Promise<void> {
  const target = resolve(directory);
  if (dirname(target) !== resolve(parent) || !basename(target).startsWith('import-')) throw new BusinessError('E_PDF_CLEANUP_SCOPE', '教材临时目录归属异常，已停止清理', 'TOOL_EXECUTION');
  await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

/** One task owns all slices. Worker cwd is the stable parent, never the removable task dir. */
export class PdfTaskWorkspace {
  private readonly materialized = new Map<string, PdfTaskFile>();
  private constructor(readonly directory: string, readonly workingDirectory: string, private readonly source: PDFDocument, private readonly inspector: PdfInspectorLike, private readonly bytes: Uint8Array) {}
  static async create(pdf: Uint8Array, signal?: AbortSignal): Promise<Result<PdfTaskWorkspace, BusinessError>> {
    let directory: string | undefined;
    const workingDirectory = agentWorkspaceParent();
    try {
      if (signal?.aborted) return err(new BusinessError('E_CANCELLED', '教材处理已取消', 'TOOL_EXECUTION'));
      const source = await PDFDocument.load(pdf);
      if (signal?.aborted) return err(new BusinessError('E_CANCELLED', '教材处理已取消', 'TOOL_EXECUTION'));
      const runtime = await ensurePdfRuntime({ needPdfium: true, ...(signal ? { signal } : {}) });
      if (signal?.aborted) return err(new BusinessError('E_CANCELLED', '教材处理已取消', 'TOOL_EXECUTION'));
      await mkdir(workingDirectory, { recursive: true });
      directory = await mkdtemp(join(workingDirectory, 'import-'));
      return ok(new PdfTaskWorkspace(directory, workingDirectory, source, runtime.inspector, pdf));
    } catch (cause) {
      if (directory) await removeOwnedWorkspace(directory, workingDirectory).catch(cleanup => logger.warn('PDF preparation cleanup failed', { cause: String(cleanup) }));
      return err(translateToBusinessError(cause, { category: 'TOOL_EXECUTION', fallbackMessage: '教材 PDF 阅读环境准备失败，请重试' }));
    }
  }
  get pageCount(): number { return this.source.getPageCount(); }
  /**
   * 原 PDF 指定页逐页取字（ACP 文本内嵌用；与切片页序一一对应，空页给空串）。
   * 无提取方法/异常一律回 null（调用方大声报错，不静默降级）。
   * 逐页单调：item.page 口径各实现不一，单页请求下全量归属该页，无歧义。
   */
  extractOriginalPageTexts(originalPages: number[], signal?: AbortSignal): string[] | null {
    const extract = this.inspector.extractTextWithPositions;
    if (!extract) return null;
    try {
      return originalPages.map((page) => {
        if (signal?.aborted) throw new Error('aborted');
        const items = extract(this.bytes, [page]) ?? [];
        return items.map(item => item.text).join('\n').trim();
      });
    } catch { return null; }
  }
  /** 内置书签定位目录页（物理页）：无书签、无命中或组件缺失时返回 null，不抛错。 */
  findDirectoryPage(): number | null {
    try {
      return classifyEmbeddedOutline(this.inspector, this.bytes, this.pageCount).directoryPage;
    } catch { return null; }
  }
  async slice(filename: string, pages: number[], signal?: AbortSignal): Promise<Result<PdfTaskFile, BusinessError>> {
    if (signal?.aborted) return err(new BusinessError('E_CANCELLED', '教材处理已取消', 'TOOL_EXECUTION'));
    if (!/^\d+\.pdf$/.test(filename) || !pages.length || pages.some(page => !Number.isSafeInteger(page) || page < 1 || page > this.pageCount) || new Set(pages).size !== pages.length)
      return err(new BusinessError('E_PDF_PAGE_RANGE_INVALID', '章节页码超出教材范围，请核对目录', 'VALIDATION'));
    try {
      const sliced = await PDFDocument.create();
      for (const page of await sliced.copyPages(this.source, pages.map(page => page - 1))) sliced.addPage(page);
      if (signal?.aborted) return err(new BusinessError('E_CANCELLED', '教材处理已取消', 'TOOL_EXECUTION'));
      const path = join(this.directory, filename);
      const bytes = await sliced.save();
      await writeFile(path, bytes);
      // 只切 PDF（毫秒级）；烘图推迟到章节开工时，首轮不被扫描版拖住。
      const file: PdfTaskFile = { path, pageCount: pages.length, originalPages: [...pages], workingDirectory: this.workingDirectory, images: [] };
      return ok(file);
    } catch (cause) { return err(translateToBusinessError(cause, { category: 'TOOL_EXECUTION', fallbackMessage: '章节 PDF 裁剪失败，请核对教材文件' })); }
  }
  /**
   * 章节开工时备图（幂等）：有字版直接返回，扫描版烘图后返回带图文件。
   * 由执行循环在取到章节后调用，与模型轮次重叠，不挡首轮启动。
   */
  async prepareImages(file: PdfTaskFile, signal?: AbortSignal): Promise<Result<PdfTaskFile, BusinessError>> {
    const done = this.materialized.get(file.path);
    if (done) return ok(done);
    try {
      const bytes = await Bun.file(file.path).bytes();
      const images = await this.renderWhenScanned(file.path.split(/[\\/]/).at(-1)!, bytes, file.originalPages, signal);
      const ready: PdfTaskFile = { ...file, images };
      this.materialized.set(file.path, ready);
      return ok(ready);
    } catch (cause) { return err(translateToBusinessError(cause, { category: 'TOOL_EXECUTION', fallbackMessage: '章节配图准备失败，请重试' })); }
  }
  /** 文字层为空才烘图：有字版零图片，扫描版按切片页序给图。 */
  private async renderWhenScanned(filename: string, bytes: Uint8Array, originalPages: number[], signal?: AbortSignal): Promise<PdfTaskPageImage[]> {
    const filePages = originalPages.map((_, index) => index + 1);
    if (!this.inspector.processPdf || !this.inspector.renderPdfPages) throw new BusinessError('E_PDF_READER_RUNTIME', '本机 PDF 组件缺失文字提取或页面烘图能力，请更新后重试', 'TOOL_EXECUTION');
    const text = this.inspector.processPdf(bytes, filePages);
    if (text.markdown?.trim()) return [];
    if (signal?.aborted) throw new BusinessError('E_CANCELLED', '教材处理已取消', 'TOOL_EXECUTION');
    // 烘图引擎单次调用有页数上限（11 页会被拒），按 8 页分批循环：章节再大也烘得完。
    const images: PdfTaskPageImage[] = [];
    for (let offset = 0; offset < filePages.length; offset += 8) {
      if (signal?.aborted) throw new BusinessError('E_CANCELLED', '教材处理已取消', 'TOOL_EXECUTION');
      const rendered = await this.inspector.renderPdfPages(bytes, filePages.slice(offset, offset + 8), { dpi: RENDER_DPI });
      for (const image of rendered) {
        const output = join(this.directory, `${filename}.page-${image.pageNumber}.png`);
        await writeFile(output, image.png);
        images.push({ page: image.pageNumber, originalPage: originalPages[image.pageNumber - 1]!, path: output });
      }
    }
    return images.sort((a, b) => a.page - b.page);
  }
  async close(): Promise<void> {
    await removeOwnedWorkspace(this.directory, this.workingDirectory);
  }
}

export function pdfReadingInstructions(file: PdfTaskFile): string {
  const mapping = file.originalPages.join('、');
  if (!file.images.length) return `当前文件：${file.path}\n文件内共 ${file.pageCount} 页，依次对应原 PDF 物理页 ${mapping}。自行读取该文件，只读本轮文件。`;
  const list = file.images.map(image => `切片第 ${image.page} 页（原 PDF 第 ${image.originalPage} 页）：${image.path}`).join('\n');
  return `当前文件：${file.path}\n文件内共 ${file.pageCount} 页，依次对应原 PDF 物理页 ${mapping}。本轮为扫描版，直接查看下列图片（不需读 PDF）：\n${list}\n只读本轮文件。`;
}
