import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
} from '@lexdistill/shared';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { sanitizeRssText, stripHtml } from './news-rss.js';
import {
  assertPublicWebUrl,
  readBoundedText,
} from '../../library/application/document-import/web-url.js';

export interface NewsArticleFullText {
  text: string;
  /** 是否来自页面正文抽取（相对 RSS 摘要显著更长） */
  fromFullText: boolean;
  /** 抽取命中的容器提示，便于日志 */
  strategy: 'readability' | 'article-paragraphs' | 'main-paragraphs' | 'fallback-plain' | 'rss-only';
}

const DEFAULT_TIMEOUT_MS = 10_000;
/** 阅读练习友好上限：过长不利于配题与朗读 */
const MAX_CHARS = 2_400;
const MIN_FULLTEXT_CHARS = 180;
/** 手动跟随重定向（每跳重验公网，与 URL 导入同口径）。 */
const MAX_REDIRECTS = 3;

/**
 * 抓取新闻原文页并抽取可读纯文本。
 * SSRF 防护（与 URL 导入同口径）：初始 URL 与每个重定向落点都验公网
 * （本机/私网/链路本地/DNS 解析到内网一律拒绝）；响应体限流 5MB；超时熔断。
 * 两级抽取：先走 Mozilla Readability 真机解析，失败再走零依赖启发式
 * （article/main 段落）；仍失败由调用方回退 RSS 摘要。
 */
export async function fetchNewsArticleFullText(
  url: string,
  options?: { timeoutMs?: number; maxChars?: number; fetcher?: typeof fetch }
): Promise<Result<NewsArticleFullText, BusinessError>> {
  const trimmed = (url || '').trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return err(
      new BusinessError('E_NEWS_ARTICLE_URL', '原文链接无效，已使用 RSS 摘要。', 'VALIDATION', false)
    );
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxChars = options?.maxChars ?? MAX_CHARS;
  const fetcher = options?.fetcher ?? fetch;

  // SSRF 首检（抛出的 BusinessError 自带中文，可直接返回）。
  let current: string;
  try {
    current = await assertPublicWebUrl(trimmed);
  } catch (e) {
    if (e instanceof BusinessError) return err(e);
    return err(
      translateToBusinessError(e, {
        category: 'NETWORK',
        action: 'fetchNewsArticleFullText',
        entityId: trimmed.slice(0, 120),
      })
    );
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetcher(current, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'User-Agent':
            'LinguaStudio/0.1 (language-learning reader; personal study; +https://localhost)',
          'Accept-Language': 'en-US,en;q=0.8,ja;q=0.5,zh-CN;q=0.3',
        },
      });
      // 重定向逐跳复检（302 跳内网是经典 SSRF 向量）。
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location || hop === MAX_REDIRECTS) {
          return err(
            new BusinessError(
              'E_NEWS_ARTICLE_HTTP',
              '原文页重定向异常，已回退 RSS 摘要。',
              'NETWORK',
              true
            )
          );
        }
        try {
          current = await assertPublicWebUrl(new URL(location, current).toString());
        } catch (e) {
          if (e instanceof BusinessError) return err(e);
          return err(
            translateToBusinessError(e, {
              category: 'NETWORK',
              action: 'fetchNewsArticleFullText',
              entityId: trimmed.slice(0, 120),
            })
          );
        }
        continue;
      }
      if (!res.ok) {
        return err(
          new BusinessError(
            'E_NEWS_ARTICLE_HTTP',
            `原文页暂时不可用（HTTP ${res.status}），已回退 RSS 摘要。`,
            'NETWORK',
            true
          )
        );
      }
      const contentType = res.headers.get('content-type') || '';
      if (contentType && !/html|xml|text\/plain/i.test(contentType)) {
        return err(
          new BusinessError(
            'E_NEWS_ARTICLE_TYPE',
            '原文页不是可读 HTML，已回退 RSS 摘要。',
            'NETWORK',
            true
          )
        );
      }
      let html: string;
      try {
        html = await readBoundedText(res);
      } catch (e) {
        if (e instanceof BusinessError) {
          return err(
            new BusinessError(
              'E_NEWS_ARTICLE_HTTP',
              '原文页过大，已回退 RSS 摘要。',
              'NETWORK',
              true
            )
          );
        }
        throw e;
      }
      const extracted = extractReadablePlainText(html, maxChars);
      if (!extracted.fromFullText) {
        return err(
          new BusinessError(
            'E_NEWS_ARTICLE_EMPTY',
            '未能从原文页抽出足够正文，已回退 RSS 摘要。',
            'NETWORK',
            true
          )
        );
      }
      return ok(extracted);
    } catch (e: unknown) {
      const aborted = (e as { name?: string } | null)?.name === 'AbortError';
      if (aborted) {
        return err(
          new BusinessError(
            'E_NEWS_ARTICLE_TIMEOUT',
            '原文抓取超时，已回退 RSS 摘要。',
            'NETWORK',
            true
          )
        );
      }
      return err(
        translateToBusinessError(e, {
          category: 'NETWORK',
          action: 'fetchNewsArticleFullText',
          entityId: trimmed.slice(0, 120),
        })
      );
    } finally {
      clearTimeout(timer);
    }
  }
  return err(
    new BusinessError('E_NEWS_ARTICLE_HTTP', '原文页重定向过多，已回退 RSS 摘要。', 'NETWORK', true)
  );
}

/** 纯函数：从 HTML 抽可读段落（可单测，不发网络） */
export function extractReadablePlainText(
  html: string,
  maxChars = MAX_CHARS
): NewsArticleFullText {
  // 一级：Mozilla Readability 真机抽取（样板/导航去除最干净）。
  const readability = extractWithReadability(html, maxChars);
  if (readability) return readability;

  // 二级：零依赖启发式（article/main 段落），Readability 失败/过短时兜底。
  let h = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const articleInner = matchTagInner(h, 'article');
  const mainInner = matchTagInner(h, 'main');

  let strategy: NewsArticleFullText['strategy'] = 'fallback-plain';
  let chunk = h;
  if (articleInner && articleInner.length > 200) {
    chunk = articleInner;
    strategy = 'article-paragraphs';
  } else if (mainInner && mainInner.length > 200) {
    chunk = mainInner;
    strategy = 'main-paragraphs';
  }

  const paras = collectParagraphs(chunk);
  if (paras.length >= 2) {
    const joined = paras.join('\n\n');
    const text = truncateAtSentence(joined, maxChars);
    if (text.length >= MIN_FULLTEXT_CHARS) {
      return { text, fromFullText: true, strategy };
    }
  }

  const plain = sanitizeRssText(chunk);
  const text = truncateAtSentence(plain, maxChars);
  if (text.length >= MIN_FULLTEXT_CHARS) {
    return {
      text,
      fromFullText: true,
      strategy: strategy === 'fallback-plain' ? 'fallback-plain' : strategy,
    };
  }

  return {
    text: text.slice(0, maxChars),
    fromFullText: false,
    strategy: 'rss-only',
  };
}

/** Mozilla Readability + JSDOM 二次抽取（纯函数，可单测；失败返回 null）。 */
export function extractWithReadability(html: string, maxChars = MAX_CHARS): NewsArticleFullText | null {
  try {
    const dom = new JSDOM(html, { url: 'https://localhost/' });
    const article = new Readability(dom.window.document).parse();
    dom.window.close();
    const raw = article?.textContent ?? '';
    if (!raw || raw.length < MIN_FULLTEXT_CHARS) return null;
    const text = truncateAtSentence(sanitizeRssText(raw), maxChars);
    if (text.length < MIN_FULLTEXT_CHARS) return null;
    return { text, fromFullText: true, strategy: 'readability' };
  } catch {
    return null;
  }
}

function matchTagInner(html: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = html.match(re);
  return m?.[1] ?? null;
}

function collectParagraphs(chunk: string): string[] {
  const raw = [...chunk.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) =>
    sanitizeRssText(stripHtml(m[1] ?? ''))
  );
  return raw.filter((p) => {
    if (p.length < 42) return false;
    if (
      /cookie|subscribe|sign in|newsletter|advertisement|隐私|クッキー|ログイン|로그인|구독|뉴스레터|광고|개인정보/i.test(
        p
      )
    ) {
      return false;
    }
    // 过短导航残片
    if (/^(home|menu|share|related)$/i.test(p)) return false;
    return true;
  });
}

function truncateAtSentence(text: string, maxChars: number): string {
  const cleaned = text.replace(/\n{3,}/g, '\n\n').trim();
  if (cleaned.length <= maxChars) return cleaned;
  const slice = cleaned.slice(0, maxChars);
  const cut = Math.max(
    slice.lastIndexOf('。'),
    slice.lastIndexOf('. '),
    slice.lastIndexOf('！'),
    slice.lastIndexOf('？'),
    slice.lastIndexOf('\n\n')
  );
  if (cut > maxChars * 0.55) {
    return slice.slice(0, cut + 1).trim();
  }
  return `${slice.trim()}…`;
}
