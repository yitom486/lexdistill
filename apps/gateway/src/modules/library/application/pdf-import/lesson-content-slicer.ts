import { PDFDocument } from 'pdf-lib';
import type { AgentImageAttachment } from '@study-studio/agent-runtime';
import { BusinessError, translateToBusinessError } from '@study-studio/shared';
import { type ChapterSource, type TocEntry, TextbookPipelineSettingsSchema } from '@study-studio/document-model';
import type { PdfInspectorLike, RenderedPagePng } from '../../../../infrastructure/pdf-runtime/pdf-runtime.js';
import { createMineruParser, type ChapterParser } from '../../../../infrastructure/mineru/parser.js';
import { createLocalOcrParser, LOCAL_OCR_PAGE_LIMIT } from '../../../../infrastructure/pdf-runtime/local-ocr-parser.js';
import { renderLessonImages, LESSON_RENDER_BATCH_PAGES } from './lesson-page-images.js';

export interface ProducePdfLessonsOptions {
  pdf: Uint8Array; inspector: PdfInspectorLike; lessons: readonly TocEntry[];
  concurrency: number; retries: number; signal: AbortSignal;
  parser?: ChapterParser; settings?: Parameters<typeof createMineruParser>[0];
  onStart: (lesson: TocEntry) => void;
  onText: (lesson: TocEntry, text: string, source: ChapterSource) => Promise<void>;
  onImages?: (lesson: TocEntry, images: AgentImageAttachment[]) => Promise<void>;
  onFailure: (lesson: TocEntry, error: BusinessError) => void;
  onDiagnostic?: (lesson: TocEntry, name: string, detail: unknown) => void;
}

/** 页级原始材料 → 有界章节队列；模型池与生产者并行启动。 */
export async function producePdfLessons(options: ProducePdfLessonsOptions): Promise<void> {
  const { pdf, inspector, signal } = options;
  const settings = options.settings ?? TextbookPipelineSettingsSchema.parse({});
  const document = await PDFDocument.load(pdf);
  const pageCount = document.getPageCount();
  const batchLimit = settings.parserBackend === 'local-ocr' ? Math.min(settings.parsePageLimit, LOCAL_OCR_PAGE_LIMIT) : settings.parsePageLimit;
  let next = 0;
  let parser = options.parser;
  const extract = async (lesson: TocEntry, batches: Map<number, ChapterSource>, files: Map<number, Uint8Array>, imageCache: Map<number, RenderedPagePng[]>): Promise<ChapterSource | AgentImageAttachment[]> => {
    const end = lesson.endPage ?? pageCount;
    if (lesson.startPage < 1 || end < lesson.startPage || end > pageCount) throw new BusinessError('E_PDF_PAGE_RANGE_INVALID', '章节物理页范围无效，请核对目录：' + lesson.title, 'VALIDATION');
    const pages = Array.from({ length: end - lesson.startPage + 1 }, (_, index) => lesson.startPage + index);
    if (settings.parserBackend === 'model-vision') {
      for (let offset = 0; offset < pages.length; offset += LESSON_RENDER_BATCH_PAGES) {
        if (signal.aborted) throw new BusinessError('E_CANCELLED', '教材提取已取消', 'TOOL_EXECUTION');
        const direct = inspector.processPdf(pdf, pages.slice(offset, offset + LESSON_RENDER_BATCH_PAGES));
        if (direct.pagesNeedingOcr?.length || !direct.markdown?.trim()) {
          if (!options.onImages) throw new BusinessError('E_INVALID_INPUT', '正文图片接收通道未就绪', 'VALIDATION');
          return renderLessonImages(pdf, pages, inspector, signal, settings.parseTimeoutMs, imageCache);
        }
      }
    }
    const result: ChapterSource = { parser: 'native', blocks: [] };
    for (let offset = 0; offset < pages.length; offset += batchLimit) {
      if (signal.aborted) throw new BusinessError('E_CANCELLED', '教材提取已取消', 'TOOL_EXECUTION');
      let part = batches.get(offset);
      if (!part) {
        const batchPages = pages.slice(offset, offset + batchLimit);
        const direct = inspector.processPdf(pdf, batchPages);
        if (direct.pagesNeedingOcr?.length || !direct.markdown?.trim()) {
          let file = files.get(offset);
          if (!file) {
            const slice = await PDFDocument.create();
            for (const page of await slice.copyPages(document, batchPages.map(page => page - 1))) slice.addPage(page);
            file = await slice.save(); files.set(offset, file);
          }
          parser ??= settings.parserBackend === 'local-ocr' ? createLocalOcrParser(inspector, settings) : createMineruParser(settings);
          part = await parser.parse(file, batchPages, signal, (name, detail) => options.onDiagnostic?.(lesson, name, detail));
        } else {
          part = { parser: 'native', blocks: batchPages.flatMap(page => {
            const text = inspector.processPdf(pdf, [page]).markdown?.trim();
            return text ? [{ id: 'p' + page + 'b0', page, kind: 'TEXT' as const, text }] : [];
          }) };
        }
        if (!part.blocks.length) throw new BusinessError('E_PARSE_CONTENT_INVALID', '章节没有可用内容，请核对页码：' + lesson.title, 'VALIDATION', true);
        batches.set(offset, part);
      }
      if (part.parser !== 'native') result.parser = part.parser;
      result.blocks.push(...part.blocks);
    }
    return result;
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency, options.lessons.length) }, async () => {
    while (!signal.aborted) {
      const lesson = options.lessons[next++]; if (!lesson) return;
      options.onStart(lesson);
      const batches = new Map<number, ChapterSource>();
      const files = new Map<number, Uint8Array>();
      const imageCache = new Map<number, RenderedPagePng[]>();
      let source: ChapterSource | AgentImageAttachment[] | undefined;
      for (let attempt = 0; attempt <= options.retries && !signal.aborted; attempt++) {
        try { source = await extract(lesson, batches, files, imageCache); break; }
        catch (cause) {
          const error = cause instanceof BusinessError ? cause : translateToBusinessError(cause, { category: 'TOOL_EXECUTION', fallbackMessage: '章节解析失败：' + lesson.title });
          options.onDiagnostic?.(lesson, 'parse_failed', { attempt: attempt + 1, code: error.code, message: error.userMessage });
          if (attempt < options.retries && error.retryable) { options.onDiagnostic?.(lesson, 'parse_retry', { attempt: attempt + 2 }); continue; }
          if (!signal.aborted) options.onFailure(lesson, error);
          break;
        }
      }
      if (source && !signal.aborted) {
        if (Array.isArray(source)) await options.onImages!(lesson, source);
        else await options.onText(lesson, JSON.stringify(source), source);
      }
    }
  }));
}
