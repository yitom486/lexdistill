import { BusinessError, translateToBusinessError } from '@study-studio/shared';
import type { TocEntry } from '@study-studio/document-model';
import type { PdfInspectorLike } from '../../../../infrastructure/pdf-runtime/pdf-runtime.js';
import { MAX_OCR_PAGES_PER_IMPORT } from './pdf-import-service.js';

export interface ProducePdfLessonsOptions {
  pdf: Uint8Array; inspector: PdfInspectorLike; lessons: readonly TocEntry[];
  concurrency: number; retries: number; signal: AbortSignal;
  onStart: (lesson: TocEntry) => void;
  onText: (lesson: TocEntry, text: string) => Promise<void>;
  onFailure: (lesson: TocEntry, error: BusinessError) => void;
}

/** 原生层已有 Rayon 识别池。首个真实扫描批次负责冷启动，其结果保留，后续共享缓存。 */
export async function producePdfLessons(options: ProducePdfLessonsOptions): Promise<void> {
  const { pdf, inspector, signal } = options;
  const pageCount = inspector.processPdf(pdf, [1]).pageCount;
  if (!pageCount || !Number.isSafeInteger(pageCount)) throw new BusinessError('E_PDF_PAGE_RANGE_INVALID', '无法确定教材总页数', 'VALIDATION');
  let warming: Promise<unknown> | undefined;
  let next = 0;
  const extract = async (lesson: TocEntry, batches: Map<number, string>): Promise<string> => {
    const end = lesson.endPage ?? pageCount;
    if (lesson.startPage < 1 || end < lesson.startPage || end > pageCount) throw new BusinessError('E_PDF_PAGE_RANGE_INVALID', `“${lesson.title}”的物理页范围无效，请核对目录`, 'VALIDATION');
    const pageNumbers = Array.from({ length: end - lesson.startPage + 1 }, (_, index) => lesson.startPage + index);
    const direct = inspector.processPdf(pdf, pageNumbers);
    let text = direct.markdown ?? '';
    if (direct.pagesNeedingOcr?.length || !text.trim()) {
      const parts: string[] = [];
      for (let offset = 0; offset < pageNumbers.length; offset += MAX_OCR_PAGES_PER_IMPORT) {
        if (signal.aborted) throw new BusinessError('E_CANCELLED', '教材提取已取消', 'TOOL_EXECUTION');
        let part = batches.get(offset);
        if (part === undefined) {
          const batchPages = pageNumbers.slice(offset, offset + MAX_OCR_PAGES_PER_IMPORT);
          if (!warming) {
            const first = inspector.processPdfWithOcr(pdf, { pageNumbers: batchPages });
            warming = first;
            try { part = (await first).markdown ?? ''; }
            catch (cause) { warming = undefined; throw cause; }
          } else {
            await warming;
            if (signal.aborted) throw new BusinessError('E_CANCELLED', '教材提取已取消', 'TOOL_EXECUTION');
            part = (await inspector.processPdfWithOcr(pdf, { pageNumbers: batchPages })).markdown ?? '';
          }
          if (!part.trim()) throw new BusinessError('E_OCR_TEXT_EMPTY', `“${lesson.title}”有页面批次未识别到文字，请核对页码`, 'TOOL_EXECUTION', true);
          batches.set(offset, part);
        }
        parts.push(part);
      }
      text = parts.join('\n\n');
    }
    if (!text.trim()) throw new BusinessError('E_OCR_TEXT_EMPTY', `“${lesson.title}”未识别到文字，请核对页码`, 'TOOL_EXECUTION', true);
    return text.trim();
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency, options.lessons.length) }, async () => {
    while (!signal.aborted) {
      const lesson = options.lessons[next++]; if (!lesson) return;
      options.onStart(lesson);
      const batches = new Map<number, string>();
      for (let attempt = 0; attempt <= options.retries && !signal.aborted; attempt++) {
        let text: string;
        try { text = await extract(lesson, batches); }
        catch (cause) {
          const error = cause instanceof BusinessError ? cause : translateToBusinessError(cause, { category: 'TOOL_EXECUTION', fallbackMessage: `“${lesson.title}”文字提取失败` });
          if (attempt < options.retries && error.retryable) continue;
          if (!signal.aborted) options.onFailure(lesson, error);
          break;
        }
        if (!signal.aborted) await options.onText(lesson, text);
        break;
      }
    }
  }));
}
