import type { ChapterSource, TextbookPipelineSettings } from '@study-studio/document-model';
import { BusinessError } from '@study-studio/shared';
import type { ChapterParser } from '../mineru/parser.js';
import type { PdfInspectorLike } from './pdf-runtime.js';

/** Bound each native OCR call; larger chapters remain one model/transaction task. */
export const LOCAL_OCR_PAGE_LIMIT = 30;

export function createLocalOcrParser(inspector: PdfInspectorLike, settings: TextbookPipelineSettings): ChapterParser {
  return { async parse(pdf, pages, signal, diagnostic): Promise<ChapterSource> {
    const aborted = () => new BusinessError(signal.aborted ? 'E_CANCELLED' : 'E_OCR_TIMEOUT',
      signal.aborted ? '教材提取已取消' : '本地 OCR 等待超时，可重试本章', 'TOOL_EXECUTION', !signal.aborted);
    if (signal.aborted) throw aborted();
    let stop: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Cancellation stops consumption; native inference finishes its current call.
      const cancellation = new Promise<never>((_, reject) => {
        stop = () => reject(aborted());
        signal.addEventListener('abort', stop, { once: true });
        timer = setTimeout(() => reject(aborted()), settings.parseTimeoutMs);
      });
      const result = await Promise.race([
        inspector.processPdfWithOcr(pdf, { pageNumbers: pages.map((_, index) => index + 1) }),
        cancellation,
      ]);
      if (signal.aborted) throw aborted();
      const results = result.pages ?? [];
      if (results.length !== pages.length || new Set(results.map(page => page.pageNumber)).size !== pages.length) {
        throw new BusinessError('E_OCR_RESULT_INVALID', '本地 OCR 返回的章节页数不完整，请重试本章', 'VALIDATION', true);
      }
      const blocks = pages.map((page, index) => {
        const recognized = results.find(item => item.pageNumber === index + 1);
        // Prefer recognition lines to Markdown assembled into incorrect table columns.
        const lines = recognized?.spans?.map(span => span.text.trim()).filter(Boolean) ?? [];
        const text = lines.length ? lines.join('\n') : recognized?.markdown.trim();
        if (!text) throw new BusinessError('E_PARSE_CONTENT_INVALID', '本章有页面未识别到文字，请核对教材后重试', 'VALIDATION', true);
        return { id: `p${page}b0`, page, kind: 'TEXT' as const, text };
      });
      diagnostic('parse_completed', { parser: 'local-ocr', pages, blockCount: blocks.length, ocrTimeMs: result.ocrTimeMs });
      return { parser: 'local-ocr', blocks };
    } finally {
      if (stop) signal.removeEventListener('abort', stop);
      if (timer) clearTimeout(timer);
    }
  } };
}
