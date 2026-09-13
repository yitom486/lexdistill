/**
 * PDF 导入结果摘要（只含结构，不含课文正文）。
 * 给默认 warn 日志和验收对照用：页范围、是否 OCR、课标题列表。
 */
import { BusinessError } from '@study-studio/shared';

export interface PdfConvertReport {
  title: string;
  pdfType: string;
  pageCount: number;
  /** 空数组 = 全书（调用方未选页） */
  selectedPages: number[];
  scope: 'all' | 'range';
  ocrUsed: boolean;
  ocrPages: number[];
  azurePages: number[];
  lessons: number;
  dialogues: number;
  lessonTitles: string[];
  /** CMD-08 全部页夹持：超限未失败而是对首窗转换，缺席/undefined 视同 false */
  clampedFromAll: boolean;
}

export function buildPdfConvertReport(input: {
  title: string;
  pdfType: string;
  pageCount: number;
  selectedPages: number[];
  ocrUsed: boolean;
  ocrPages: number[];
  azurePages?: number[];
  lessons: number;
  dialogues: number;
  lessonTitles: string[];
  clampedFromAll?: boolean;
}): PdfConvertReport {
  const selectedPages = Array.isArray(input.selectedPages) ? input.selectedPages : [];
  return {
    title: input.title,
    pdfType: input.pdfType,
    pageCount: input.pageCount,
    selectedPages,
    scope: selectedPages.length > 0 ? 'range' : 'all',
    ocrUsed: input.ocrUsed,
    ocrPages: Array.isArray(input.ocrPages) ? input.ocrPages : [],
    azurePages: Array.isArray(input.azurePages) ? input.azurePages : [],
    lessons: input.lessons,
    dialogues: input.dialogues,
    lessonTitles: input.lessonTitles.slice(0, 80),
    clampedFromAll: input.clampedFromAll === true,
  };
}

/** OCR 超限引导 details：弹窗据此切「指定页码」并填首个 30 页窗，不自动重试。 */
export interface PdfOcrOverflowDetails {
  pageCount: number;
  ocrPages: number[];
  suggestedStartPage: number;
  suggestedEndPage: number;
}

/**
 * 扫描页超单次 OCR 上限的友好失败（上限保持 30，禁止自动切完整本）。
 * userMessage 文案与此前一字相同；details 给前端引导用，经 HTTP 信封透出。
 */
export function buildOcrOverflowError(input: {
  scope: 'all' | 'range';
  pageCount: number;
  ocrPages: number[];
  limit: number;
}): BusinessError {
  const startPage = 1;
  const endPage = Math.min(input.limit, input.pageCount);
  const details: PdfOcrOverflowDetails = {
    pageCount: input.pageCount,
    ocrPages: [...input.ocrPages],
    suggestedStartPage: startPage,
    suggestedEndPage: endPage,
  };
  const userMessage =
    input.scope === 'all'
      ? `本书 ${input.ocrPages.length} 页需 OCR（单次上限 ${input.limit} 页），请按课分段选页导入`
      : `所选页中有 ${input.ocrPages.length} 页需 OCR（单次上限 ${input.limit} 页），请缩小选页范围`;
  return new BusinessError('E_INVALID_INPUT', userMessage, 'VALIDATION', false, details);
}

export function buildPdfMapReport(input: {  pageCount: number;
  window: number[];
  ocrUsed: boolean;
  ocrPages: number[];
  headings: Array<{ page: number; text: string }>;
  tocCount: number;
}): {
  pageCount: number;
  window: number[];
  ocrUsed: boolean;
  ocrPages: number[];
  headingCount: number;
  headingPreview: string[];
  tocCount: number;
} {
  const headings = Array.isArray(input.headings) ? input.headings : [];
  return {
    pageCount: input.pageCount,
    window: input.window,
    ocrUsed: input.ocrUsed,
    ocrPages: input.ocrPages,
    headingCount: headings.length,
    headingPreview: headings.slice(0, 24).map((h) => `p${h.page}:${h.text}`),
    tocCount: input.tocCount,
  };
}
