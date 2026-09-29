import {
  ok,
  err,
  isOk,
  type Result,
  BusinessError,
  translateToBusinessError,
  logger,
} from '@study-studio/shared';
import {
  canonicalizeTocEntries,
  type TocEntry,
} from '@study-studio/document-model';
import type { PdfInspectorLike } from '../../../../infrastructure/pdf-runtime/pdf-runtime.js';

export interface LessonContentSlice {
  lessonId: string;
  title: string;
  startPage: number;
  endPage: number;
  subSections?: string[];
  ocrText: string;
}

export interface SlicePdfLessonsOptions {
  pdf: Uint8Array;
  tocEntries: readonly TocEntry[];
  inspector: PdfInspectorLike;
  /** OCR 并发度（默认 3，避免单机 CPU / GPU 过载） */
  concurrency?: number;
}

/**
 * 课次正文并发切片抽取器（Stage 1: 生产者）
 * - 依核对后的目录起止页码，将全书切片为各课独立的正文任务（LessonContentSlice[]）；
 * - 自动识别原生文字版与扫描图片版：文字版原生抽取，扫描版以指定并发度跑局部页码 OCR；
 * - 产出标准 lessonJobs 供后续 Stage 2 AI 教学提炼并发流水线消费。
 */
export async function slicePdfLessonsWithOcr(
  options: SlicePdfLessonsOptions
): Promise<Result<LessonContentSlice[], BusinessError>> {
  const { pdf, tocEntries, inspector, concurrency = 3 } = options;

  if (!tocEntries || tocEntries.length === 0) {
    return err(new BusinessError('E_TOC_EMPTY', '目录条目不能为空', 'VALIDATION', false));
  }

  // 1. 规范化目录条目（自动推断未填写的 endPage，并提取成课）
  const canonical = canonicalizeTocEntries(tocEntries);
  const lessons = canonical.filter((e) => e.level === 'lesson');

  if (lessons.length === 0) {
    return err(new BusinessError('E_TOC_NO_LESSONS', '目录中未包含任何成课课次（level: lesson）', 'VALIDATION', false));
  }

  // 2. 检查 PDF 总体页数
  let totalPdfPages = 0;
  try {
    const info = inspector.processPdf(pdf, [1]);
    totalPdfPages = info.pageCount ?? 1;
  } catch {
    totalPdfPages = 1;
  }

  // 3. 并发切片执行（限制最大并发数）
  const results: LessonContentSlice[] = new Array(lessons.length);
  const queue = lessons.map((lesson, index) => ({ lesson, index }));
  const workerCount = Math.max(1, Math.min(concurrency, queue.length));

  logger.info('[slicePdfLessonsWithOcr] 开始教材切片', {
    lessonCount: lessons.length,
    workerCount,
    totalPdfPages,
  });

  async function runWorker(): Promise<void> {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      const { lesson, index } = item;

      const start = Math.max(1, Math.min(lesson.startPage, totalPdfPages));
      const end = Math.max(start, Math.min(lesson.endPage ?? start, totalPdfPages));
      const pageNumbers: number[] = [];
      for (let p = start; p <= end; p++) {
        pageNumbers.push(p);
      }

      let extractedText = '';
      try {
        // 先尝试文字直提
        const classify = inspector.processPdf(pdf, pageNumbers);
        const hasDirectMarkdown = typeof classify.markdown === 'string' && classify.markdown.trim().length > 0;
        const needsOcr = (classify.pagesNeedingOcr && classify.pagesNeedingOcr.length > 0) || !hasDirectMarkdown;

        if (!needsOcr && hasDirectMarkdown) {
          extractedText = classify.markdown!;
        } else if (!needsOcr && inspector.extractTextWithPositions) {
          const textItems = inspector.extractTextWithPositions(pdf, pageNumbers);
          extractedText = textItems.map((t) => t.text).join('\n');
        } else {
          // 扫描版或直提为空：调用局部页码 OCR
          const ocrResult = await inspector.processPdfWithOcr(pdf, { pageNumbers });
          extractedText = ocrResult.markdown || '';
        }
      } catch (cause) {
        throw translateToBusinessError(cause, {
          category: 'TOOL_EXECUTION',
          fallbackMessage: `抽取课次 "${lesson.title}" (第 ${start}–${end} 页) 文本失败`,
        });
      }

      const trimmedText = extractedText.trim();
      if (!trimmedText) {
        logger.warn('[slicePdfLessonsWithOcr] 提取到的课文切片内容为空', {
          lessonId: lesson.id,
          title: lesson.title,
          startPage: start,
          endPage: end,
        });
      }

      // 提取本课辖下的子条目（微观目录白名单，如文型 1~4、会话标题）
      const subSections = canonical
        .filter(
          (e) =>
            e.level === 'section' &&
            (e.parentId === lesson.id || (!e.parentId && e.startPage >= start && e.startPage <= end))
        )
        .map((e) => e.title);

      results[index] = {
        lessonId: lesson.id,
        title: lesson.title,
        startPage: start,
        endPage: end,
        subSections,
        ocrText: trimmedText,
      };
    }
  }

  try {
    const workers = Array.from({ length: workerCount }, () => runWorker());
    await Promise.all(workers);
    logger.info('[slicePdfLessonsWithOcr] 教材切片完成', {
      totalLessons: lessons.length,
      extractedCount: results.length,
    });
    return ok(results);
  } catch (e) {
    if (e instanceof BusinessError) return err(e);
    return err(translateToBusinessError(e, 'slicePdfLessonsWithOcr'));
  }
}
