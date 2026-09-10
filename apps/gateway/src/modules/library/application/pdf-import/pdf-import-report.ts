/**
 * PDF 导入结果摘要（只含结构，不含课文正文）。
 * 给默认 warn 日志和验收对照用：页范围、是否 OCR、课标题列表。
 */

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
  };
}

export function buildPdfMapReport(input: {
  pageCount: number;
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
