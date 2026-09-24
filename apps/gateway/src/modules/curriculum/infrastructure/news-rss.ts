import { ok, err, type Result, BusinessError, isOk } from '@study-studio/shared';
import {
  type StudyContentLanguage,
  normalizeContentLanguage,
} from '../application/content-language-policy.js';
import { assertPublicWebUrl } from '../../library/application/document-import/web-url.js';

export interface RssItem {
  title: string;
  link: string;
  description: string;
  pubDate?: string | undefined;
}

export interface NewsFeedRef {
  url: string;
  publisher: string;
  language: StudyContentLanguage;
}

/**
 * 栏目 → 公开 RSS 候选（按优先级）。
 * - EN：BBC / Guardian / NPR，同栏目多源回退
 * - JA：NHK ONE，失败回退 www3.nhk.or.jp
 * - KO：联合新闻（韩语正文）+ 东亚日报总览回退
 * 仅个人学习用途；遵守各源非商业 RSS 条款。
 */
export function resolveNewsFeedCandidates(
  topicId: string,
  language: StudyContentLanguage | string
): NewsFeedRef[] {
  const lang = normalizeContentLanguage(language);

  if (lang === 'JA') {
    const cat =
      (
        {
          technology: '3',
          world: '6',
          culture: '3',
          business: '5',
          sports: '7',
          exam_prep: '0',
        } as Record<string, string>
      )[topicId] ?? '0';
    const legacyCat =
      (
        {
          technology: '3',
          world: '6',
          culture: '3',
          business: '5',
          sports: '7',
          exam_prep: '0',
        } as Record<string, string>
      )[topicId] ?? '0';
    return [
      {
        url: `https://news.web.nhk/n-data/conf/na/rss/cat${cat}.xml`,
        publisher: 'NHK ONE',
        language: 'JA',
      },
      {
        url: `https://www3.nhk.or.jp/rss/news/cat${legacyCat}.xml`,
        publisher: 'NHK News',
        language: 'JA',
      },
    ];
  }

  if (lang === 'KO') {
    const koPrimary: Record<string, NewsFeedRef> = {
      technology: {
        url: 'https://www.yna.co.kr/rss/industry.xml',
        publisher: '연합뉴스',
        language: 'KO',
      },
      world: {
        url: 'https://www.yna.co.kr/rss/international.xml',
        publisher: '연합뉴스',
        language: 'KO',
      },
      culture: {
        url: 'https://www.yna.co.kr/rss/culture.xml',
        publisher: '연합뉴스',
        language: 'KO',
      },
      business: {
        url: 'https://www.yna.co.kr/rss/economy.xml',
        publisher: '연합뉴스',
        language: 'KO',
      },
      sports: {
        url: 'https://www.yna.co.kr/rss/sports.xml',
        publisher: '연합뉴스',
        language: 'KO',
      },
      exam_prep: {
        url: 'https://www.yna.co.kr/rss/society.xml',
        publisher: '연합뉴스',
        language: 'KO',
      },
    };
    const primary = koPrimary[topicId] ?? koPrimary.world!;
    return [
      primary,
      {
        url: 'https://www.yna.co.kr/rss/news.xml',
        publisher: '연합뉴스',
        language: 'KO',
      },
      {
        url: 'https://rss.donga.com/total.xml',
        publisher: '동아일보',
        language: 'KO',
      },
    ];
  }

  // EN — 英语学习主路径：栏目主源 + 跨社回退
  const enPrimary: Record<string, NewsFeedRef> = {
    technology: {
      url: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
      publisher: 'BBC News',
      language: 'EN',
    },
    world: {
      url: 'https://www.theguardian.com/world/rss',
      publisher: 'The Guardian',
      language: 'EN',
    },
    culture: {
      url: 'https://feeds.npr.org/1008/rss.xml',
      publisher: 'NPR',
      language: 'EN',
    },
    business: {
      url: 'https://feeds.bbci.co.uk/news/business/rss.xml',
      publisher: 'BBC News',
      language: 'EN',
    },
    sports: {
      url: 'https://feeds.bbci.co.uk/sport/rss.xml',
      publisher: 'BBC Sport',
      language: 'EN',
    },
    exam_prep: {
      url: 'https://feeds.bbci.co.uk/news/education/rss.xml',
      publisher: 'BBC Education',
      language: 'EN',
    },
  };
  const primary = enPrimary[topicId] ?? enPrimary.world!;
  const enFallbacks = [
    {
      url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
      publisher: 'BBC News',
      language: 'EN' as const,
    },
    {
      url: 'https://www.theguardian.com/international/rss',
      publisher: 'The Guardian',
      language: 'EN' as const,
    },
    {
      url: 'https://feeds.npr.org/1001/rss.xml',
      publisher: 'NPR',
      language: 'EN' as const,
    },
  ] satisfies NewsFeedRef[];
  const fallbacks = enFallbacks.filter((f) => f.url !== primary.url);

  return [primary, ...fallbacks];
}

/** 兼容：返回最高优先级源 */
export function resolveNewsFeed(
  topicId: string,
  language: StudyContentLanguage | string
): NewsFeedRef {
  return resolveNewsFeedCandidates(topicId, language)[0]!;
}

type Fetcher = typeof fetch;

/**
 * 按候选列表依次拉取 RSS，首个成功即返回（带实际命中的 feed）。
 * @internal 暴露 fetcher 仅为确定性单测使用，产品调用走全局 fetch。
 */
export async function fetchRssItemsWithFallback(
  feeds: NewsFeedRef[],
  options?: { timeoutMs?: number; limit?: number; fetcher?: Fetcher }
): Promise<Result<{ items: RssItem[]; feed: NewsFeedRef }, BusinessError>> {
  if (feeds.length === 0) {
    return err(
      new BusinessError('E_NEWS_RSS_EMPTY', '未配置可用新闻源。', 'VALIDATION', false)
    );
  }
  let lastErr: BusinessError | null = null;
  for (const feed of feeds) {
    const fetchOpts: { timeoutMs?: number; limit?: number; fetcher?: typeof fetch } = {};
    if (options?.timeoutMs !== undefined) fetchOpts.timeoutMs = options.timeoutMs;
    if (options?.limit !== undefined) fetchOpts.limit = options.limit;
    if (options?.fetcher) fetchOpts.fetcher = options.fetcher;
    const res = await fetchRssItems(feed.url, fetchOpts);
    if (isOk(res) && res.value.length > 0) {
      return ok({ items: res.value, feed });
    }
    if (!isOk(res)) lastErr = res.error;
  }
  return err(
    lastErr ??
      new BusinessError(
        'E_NEWS_RSS_EMPTY',
        '新闻源暂时不可用，请稍后再试或换栏目。',
        'NETWORK',
        true
      )
  );
}

export async function fetchRssItems(
  feedUrl: string,
  options?: { timeoutMs?: number; limit?: number; fetcher?: Fetcher }
): Promise<Result<RssItem[], BusinessError>> {
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const limit = options?.limit ?? 8;
  const fetcher = options?.fetcher ?? fetch;
  // 纵深防御：源地址固定来自配置表，但入口仍验公网（防未来某个栏目映射被污染）。
  try {
    await assertPublicWebUrl(feedUrl);
  } catch (e) {
    return err(
      e instanceof BusinessError
        ? e
        : new BusinessError('E_NEWS_RSS_FETCH', '新闻源地址非法。', 'NETWORK', true)
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetcher(feedUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
        'User-Agent': 'LinguaStudio/0.1 (language-learning; personal study use)',
      },
    });
    if (!res.ok) {
      return err(
        new BusinessError(
          'E_NEWS_RSS_HTTP',
          `新闻源暂时不可用（HTTP ${res.status}），已保留离线模板兜底。`,
          'NETWORK',
          true
        )
      );
    }
    const xml = await res.text();
    const items = parseRssItems(xml).slice(0, limit);
    if (items.length === 0) {
      return err(
        new BusinessError(
          'E_NEWS_RSS_EMPTY',
          '新闻源返回为空，请稍后再试或换栏目。',
          'NETWORK',
          true
        )
      );
    }
    return ok(items);
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return err(
      new BusinessError(
        aborted ? 'E_NEWS_RSS_TIMEOUT' : 'E_NEWS_RSS_FETCH',
        aborted
          ? '拉取新闻超时，请检查网络后重试。'
          : '拉取新闻失败，已可回退合规模板。',
        'NETWORK',
        true
      )
    );
  } finally {
    clearTimeout(timer);
  }
}

export function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  for (const block of itemBlocks) {
    const title = sanitizeRssText(pickTag(block, 'title'));
    const link = sanitizeRssText(pickTag(block, 'link') || pickTag(block, 'guid'));
    // Guardian 等源常在 description / content:encoded 里塞 HTML 或 &lt;p&gt; 实体
    const rawDesc =
      pickTag(block, 'description') ||
      pickTag(block, 'content:encoded') ||
      pickTag(block, 'encoded') ||
      '';
    const description = sanitizeRssText(rawDesc);
    const pubDate = stripCdata(pickTag(block, 'pubDate')) || undefined;
    if (!title) continue;
    items.push({
      title,
      link,
      description: description || title,
      ...(pubDate ? { pubDate } : {}),
    });
  }
  return items;
}

function pickTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = block.match(re);
  return m?.[1]?.trim() ?? '';
}

function stripCdata(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/^<!\[CDATA\[/i, '')
    .replace(/\]\]>$/i, '')
    .trim();
}

/**
 * RSS 正文清洗：实体解码 → 剥标签 → 再解码残留实体。
 * 错误顺序（先剥标签再解码）会把 `&lt;p&gt;` 变成可见 `<p>`。
 */
export function sanitizeRssText(raw: string): string {
  if (!raw) return '';
  let text = stripCdata(raw);
  // 实体逃逸的 HTML（Guardian 常见）先解码一次，便于 stripHtml 识别标签
  if (/&lt;|&gt;|&amp;(?:lt|gt|quot|nbsp|#)/i.test(text)) {
    text = decodeXmlEntities(text);
  }
  text = stripHtml(text);
  text = decodeXmlEntities(text);
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function stripHtml(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<\/(?:ul|ol|table)>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeXmlEntities(raw: string): string {
  let text = raw;
  // 最多两轮：处理 &amp;#x27; → &#x27; → ' 这类双重实体
  for (let i = 0; i < 2; i++) {
    text = text
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&amp;/g, '&');
  }
  return text;
}

export function pickLeadSentence(text: string, maxLen = 60): string {
  const cleaned = sanitizeRssText(text).replace(/\s+/g, ' ').trim();
  const cut = cleaned.split(/[。．.!?！？]/)[0]?.trim() || cleaned;
  return cut.length > maxLen ? `${cut.slice(0, maxLen)}…` : cut;
}
