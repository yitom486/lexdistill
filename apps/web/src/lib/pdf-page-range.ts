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
