import { BusinessError } from '@lexdistill/shared';
// 跨模块复用（G5 登记）：Readability+启发式正文抽取纯函数；抓取层自备 SSRF 防护（web-url.ts）。
import { extractReadablePlainText } from '../../../curriculum/infrastructure/news-article-fetch.js';
import { fetchPublicWebText, type WebFetchImpl } from './web-url.js';

/**
 * 网页正文导入（clean-room 编排，自研抓取守卫 + 既有抽取）。
 * 定位是学习不是阅读：只取可读正文进 AST/抽词/组卷，不存整页 HTML、不跟样式脚本。
 * AI 找新闻作练习题走本入口（URL 由 AI 提供，经 SSRF 防护后抓取）。
 */

const MAX_IMPORT_CHARS = 20000;

function pageTitle(html: string, fallback: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim();
  return m || fallback;
}

/** URL → markdown（标题 + 正文；抽取不足判空，不臆造）。 */
export async function extractWebArticle(
  url: string,
  fetcher?: WebFetchImpl
): Promise<{ title: string; markdown: string; finalUrl: string }> {
  const { html, finalUrl } = await fetchPublicWebText(url, fetcher);
  const extracted = extractReadablePlainText(html, MAX_IMPORT_CHARS);
  if (!extracted.fromFullText || !extracted.text.trim()) {
    throw new BusinessError(
      'E_CONTENT_EMPTY',
      '该网页抽不出足够正文（可能为纯图片/付费墙），换一篇再试',
      'VALIDATION',
      false
    );
  }
  const host = fallbackTitle(finalUrl);
  const title = pageTitle(html, host);
  return { title, markdown: `# ${title}\n\n${extracted.text.trim()}`, finalUrl };
}

function fallbackTitle(finalUrl: string): string {
  try {
    return new URL(finalUrl).hostname || '网页导入';
  } catch {
    return '网页导入';
  }
}
