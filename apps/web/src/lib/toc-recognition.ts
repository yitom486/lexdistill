import type { MapPdfResult } from '../queries/useLearnerQueries.js';
import { buildPreviewEntries } from './toc-anchor-flow.js';
import type { EditableTocEntry } from './toc-confirm-flow.js';

export interface TocRecognitionCandidate extends EditableTocEntry {
  /** 保留四级目录语义；编辑表格的两级缩进不是目录类型。 */
  directoryLevel?: 'unit' | 'chapter' | 'lesson' | 'section';
  /** PDF bookmarks identify physical pages, never printed pages. */
  physicalPage?: number;
  endPage?: number;
  parentId?: string;
}

const LESSON_TITLE = /第\s*[0-9０-９一二三四五六七八九十百]+\s*[課课]|\b(?:lesson|unit)\s*\d+\b/i;

/** Reject oversized windows before map-pdf can silently clamp them to 30 pages. */
export function parseTocScanRange(start: string, end: string):
  | { ok: true; startPage?: number; endPage?: number }
  | { ok: false; message: string } {
  if (!start.trim() && !end.trim()) return { ok: true };
  if (!/^\d+$/.test(start.trim()) || !/^\d+$/.test(end.trim())) {
    return { ok: false, message: '请同时填写目录页的起止 PDF 页码，或两项都留空以预览前 30 页' };
  }
  const startPage = Number(start);
  const endPage = Number(end);
  if (!Number.isSafeInteger(startPage) || !Number.isSafeInteger(endPage) || startPage < 1 || endPage < startPage) {
    return { ok: false, message: '目录页范围必须是递增的正整数' };
  }
  if (endPage - startPage + 1 > 30) {
    return { ok: false, message: '一次最多识别 30 页目录，请缩小范围' };
  }
  return { ok: true, startPage, endPage };
}

function titleWithoutPrintedPage(label: string, printedPage: number): string {
  const withoutLeadingPage = label.replace(/^\s*\d{1,4}\s+(?=第\s*[0-9０-９一二三四五六七八九十百]+\s*[課课])/, '').trim();
  const pageText = String(printedPage);
  return (withoutLeadingPage.endsWith(pageText)
    ? withoutLeadingPage.slice(0, -pageText.length).replace(/[\s.…·．]+$/, '')
    : withoutLeadingPage).trim();
}

/** Convert map results into proposals. Only OCR TOC rows carry printed page numbers. */
export function tocCandidatesFromMap(result: MapPdfResult): TocRecognitionCandidate[] {
  if (result.outlineSource === 'embedded' && result.embeddedOutline?.length) {
    return result.embeddedOutline.map((entry, index) => ({
      key: `embedded-${index}`,
      title: entry.title.trim(),
      printedPage: '',
      level: entry.level <= 1 ? 1 : 2,
      kind: LESSON_TITLE.test(entry.title) ? 'lesson' : 'section',
      confidence: null,
      physicalPage: entry.physicalPage,
    }));
  }
  return result.tocEntries.map((entry, index) => {
    const title = titleWithoutPrintedPage(entry.label, entry.printedPage);
    return {
      key: `ocr-${index}`,
      title,
      printedPage: String(entry.printedPage),
      level: 1,
      kind: LESSON_TITLE.test(title) ? 'lesson' : 'section',
      confidence: null,
    };
  });
}

/** The confirmation button shares the downstream numeric and nonempty guards. */
export function validateTocCandidates(entries: TocRecognitionCandidate[]): string | null {
  const built = buildPreviewEntries(entries);
  if (!built.ok) return built.message;
  if (!built.entries.some((entry) => entry.kind === 'lesson')) return '请至少确认一条成课目录';
  let lastPage = 0;
  for (const entry of built.entries) {
    if (entry.printedPage < lastPage) return '印刷页码不能倒退，请核对目录顺序';
    lastPage = entry.printedPage;
  }
  return null;
}
