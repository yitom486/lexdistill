/**
 * PDF 导入页范围解析（纯函数，供导入弹窗与单测共用）。
 *
 * - 「全部页」一律返回 `{}`：调用方 spread 后不带 start/end，后端按全书走。
 * - 「指定页码」两端必填：缺一端或非纯数字返回 `'incomplete-range'`，
 *   调用方不得发请求，直接给用户可见错误。
 */
export type PdfPageScope = 'all' | 'range';

export type ResolvedPdfPageRange = { startPage?: number; endPage?: number } | 'incomplete-range';

function parsePageNumber(text: string): number | undefined {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
}

export function resolvePdfPageRange(
  scope: PdfPageScope,
  startText: string,
  endText: string
): ResolvedPdfPageRange {
  if (scope !== 'range') return {};
  const startPage = parsePageNumber(startText);
  const endPage = parsePageNumber(endText);
  if (startPage === undefined || endPage === undefined) return 'incomplete-range';
  return { startPage, endPage };
}

export interface OcrOverflowWindow {
  startPage: number;
  endPage: number;
}

function readOverflowNumber(details: unknown, key: string): number | undefined {
  if (typeof details !== 'object' || details === null) return undefined;
  const value = (details as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * OCR 超限引导窗（纯函数）：网关 details 自带首个 30 页窗建议；
 * 若刚 map 过且有标题页，起始页用第一条 heading.page，
 * 结束页 = min(start + 29, pageCount)。形状不对返回 null（不切换、不重试）。
 */
export function resolveOcrOverflowWindow(
  details: unknown,
  headings: Array<{ page: number }> | undefined,
  pageCount: number | undefined
): OcrOverflowWindow | null {
  const suggestedStart = readOverflowNumber(details, 'suggestedStartPage');
  const suggestedEnd = readOverflowNumber(details, 'suggestedEndPage');
  if (suggestedStart === undefined || suggestedEnd === undefined) return null;
  const firstHeadingPage = Array.isArray(headings) && headings.length > 0 ? headings[0]?.page : undefined;
  const start =
    typeof firstHeadingPage === 'number' && Number.isFinite(firstHeadingPage) && firstHeadingPage >= 1
      ? Math.floor(firstHeadingPage)
      : Math.max(1, Math.floor(suggestedStart));
  const windowSize = Math.max(1, Math.floor(suggestedEnd) - Math.floor(suggestedStart) + 1);
  const cap = typeof pageCount === 'number' && Number.isFinite(pageCount) && pageCount >= 1 ? Math.floor(pageCount) : start + windowSize - 1;
  const end = Math.max(start, Math.min(start + windowSize - 1, cap));
  return { startPage: start, endPage: end };
}
