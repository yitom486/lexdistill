/**
 * 精读默认教材选择（纯函数）。
 *
 * 开箱即用：languageFilter 初始跟用户轨道（ja→JA、en→EN、ko→KO），默认选中该语种
 * 第一本；ALL 仍留在下拉里给想看别的语种的人。空选 / 当前书被滤掉时用
 * pickDefaultTextbook，禁止无脑 booksList[0]（种子同秒写入时 EN 会排第一）。
 */
export type TextbookLanguageFilter = 'ALL' | 'JA' | 'EN' | 'KO';

export interface DefaultTextbookCandidate {
  id: string;
  language?: string;
}

/** 用户目标语种 → 初始过滤档（未知输入回退 JA，不回退 ALL）。 */
export function targetLanguageToFilter(targetLanguage: string): Exclude<TextbookLanguageFilter, 'ALL'> {
  if (targetLanguage === 'en') return 'EN';
  if (targetLanguage === 'ko') return 'KO';
  return 'JA';
}

/**
 * filter 非 ALL 时取该语种第一本（缺书语言按 JA 计，与列表过滤口径一致），
 * 没有则回退全单第一本；ALL 直接第一本；空单 undefined。
 */
export function pickDefaultTextbook<T extends DefaultTextbookCandidate>(
  books: T[],
  filter: TextbookLanguageFilter
): T | undefined {
  if (books.length === 0) return undefined;
  if (filter === 'ALL') return books[0];
  return books.find((b) => (b.language || 'JA') === filter) ?? books[0];
}
