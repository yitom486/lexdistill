import { describe, expect, it } from 'bun:test';
import { generateNewsPassage } from '../modules/curriculum/application/generate-news-passage.js';
import { fetchRssItems, fetchRssItemsWithFallback } from '../modules/curriculum/infrastructure/news-rss.js';
import { fetchNewsArticleFullText } from '../modules/curriculum/infrastructure/news-article-fetch.js';
import { isOk } from '@lexdistill/shared';

/**
 * P3-B 确定性单测：用注入的 fetcher 模拟网络，覆盖验收标准要求的 4 个失败场景，
 * 以及结构化来源元数据与版权收口（不持久化第三方全文）断言。
 * 不依赖真实网络，可在离线环境稳定运行。
 */

const SAMPLE_RSS_XML = `<?xml version="1.0"?>
<rss version="2.0"><channel>
<item>
  <title><![CDATA[BBC tech headline]]></title>
  <link>https://bbc.example.com/tech/story</link>
  <description><![CDATA[Lead sentence about a tech policy change. Second sentence adds context.]]></description>
  <pubDate>Sat, 05 Sep 2026 00:00:00 GMT</pubDate>
</item>
</channel></rss>`;

const EMPTY_RSS_XML = `<?xml version="1.0"?>
<rss version="2.0"><channel></channel></rss>`;

const LONG_ARTICLE_HTML = `<!doctype html><html><body>
<nav>Home Menu Subscribe</nav>
<article>
  <p>${'A substantial paragraph about the technology policy story. '.repeat(6)}</p>
  <p>Officials said the framework would be reviewed again next quarter with broader consultation.</p>
  <p>Industry groups welcomed the clarity but asked for longer transition periods.</p>
</article>
<footer>Cookie policy newsletter sign in</footer>
</body></html>`;

/** 模拟超时：返回一个永远 abort 的 fetcher */
function makeTimeoutFetcher(): typeof fetch {
  return (() =>
    Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))) as never;
}

/** 模拟 HTTP 失败 */
function makeHttpFailFetcher(status = 503): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response('service unavailable', { status })
    )) as never;
}

/** 模拟成功 RSS + 长正文页 */
function makeRssWithFullTextFetcher(): typeof fetch {
  return ((url: string | URL | Request) => {
    const u = String(url);
    if (u.includes('bbc.example.com')) {
      return Promise.resolve(
        new Response(LONG_ARTICLE_HTML, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      ) as never;
    }
    return Promise.resolve(
      new Response(SAMPLE_RSS_XML, {
        status: 200,
        headers: { 'content-type': 'application/rss+xml' },
      })
    ) as never;
  }) as never;
}

/** 模拟成功 RSS + 正文页正文不足（fromFullText=false） */
function makeRssWithThinArticleFetcher(): typeof fetch {
  return ((url: string | URL | Request) => {
    const u = String(url);
    if (u.includes('bbc.example.com')) {
      // 正文过短 → extractReadablePlainText 返回 fromFullText=false
      return Promise.resolve(
        new Response('<html><body><p>Hi</p></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      ) as never;
    }
    return Promise.resolve(
      new Response(SAMPLE_RSS_XML, {
        status: 200,
        headers: { 'content-type': 'application/rss+xml' },
      })
    ) as never;
  }) as never;
}

describe('P3-B news reliability — deterministic failure scenarios', () => {
  it('scenario 1: RSS 超时 → 回退模板且 fetchStatus=timeout', async () => {
    const passage = await generateNewsPassage({
      setId: 'p3b_timeout',
      topic: 'technology',
      language: 'EN',
      fetcher: makeTimeoutFetcher(),
    });
    expect(passage.fromRss).toBe(false);
    expect(passage.sourceKind).toBe('offline_template');
    expect(passage.fetchStatus).toBe('timeout');
    expect(passage.title).toContain('English Media Briefing');
  });

  it('scenario 2: RSS 返回空（无条目）→ 回退模板且 fetchStatus=empty', async () => {
    const fetcher = (() =>
      Promise.resolve(
        new Response(EMPTY_RSS_XML, {
          status: 200,
          headers: { 'content-type': 'application/rss+xml' },
        })
      )) as never;
    const passage = await generateNewsPassage({
      setId: 'p3b_empty',
      topic: 'technology',
      language: 'EN',
      fetcher,
    });
    expect(passage.fromRss).toBe(false);
    expect(passage.sourceKind).toBe('offline_template');
    expect(passage.fetchStatus).toBe('empty');
  });

  it('scenario 3: 正文不足（fromFullText=false）→ 用 RSS 摘要，sourceKind=rss_summary', async () => {
    const passage = await generateNewsPassage({
      setId: 'p3b_thin',
      topic: 'technology',
      language: 'EN',
      fetcher: makeRssWithThinArticleFetcher(),
    });
    expect(passage.fromRss).toBe(true);
    expect(passage.fromFullText).toBe(false);
    expect(passage.sourceKind).toBe('rss_summary');
    expect(passage.fetchStatus).toBe('ok');
    expect(passage.body).toContain('Lead sentence');
    expect(passage.body).not.toMatch(/<\/?[a-z]+/i);
  });

  it('scenario 4: 全部来源失败（HTTP 503）→ 回退模板且 fetchStatus=network_failed', async () => {
    const passage = await generateNewsPassage({
      setId: 'p3b_allfail',
      topic: 'world',
      language: 'EN',
      fetcher: makeHttpFailFetcher(503),
    });
    expect(passage.fromRss).toBe(false);
    expect(passage.sourceKind).toBe('offline_template');
    expect(passage.fetchStatus).toBe('network_failed');
  });
});

describe('P3-B structured source metadata & copyright boundary', () => {
  it('命中原文摘录时：body 含全文，但 persistBody 仅含 RSS 摘要（不持久化第三方全文）', async () => {
    const passage = await generateNewsPassage({
      setId: 'p3b_copyright',
      topic: 'technology',
      language: 'EN',
      fetcher: makeRssWithFullTextFetcher(),
    });
    expect(passage.fromRss).toBe(true);
    expect(passage.fromFullText).toBe(true);
    expect(passage.sourceKind).toBe('full_text');
    expect(passage.fetchStatus).toBe('ok');
    expect(passage.publisher).toBe('BBC News');

    // 版权收口核心断言：展示正文是原文摘录，持久化正文只是 RSS 摘要
    expect(passage.body).toContain('substantial paragraph about the technology policy');
    expect(passage.persistBody).not.toContain('substantial paragraph about the technology policy');
    expect(passage.persistBody).toContain('Lead sentence');
    expect(passage.persistBody.length).toBeLessThan(passage.body.length);
  });

  it('fetchRssItemsWithFallback 在所有候选失败时返回 network_failed 业务错误', async () => {
    const res = await fetchRssItemsWithFallback(
      [
        { url: 'https://a.example.com/rss', publisher: 'A', language: 'EN' },
        { url: 'https://b.example.com/rss', publisher: 'B', language: 'EN' },
      ],
      { fetcher: makeHttpFailFetcher(500) }
    );
    expect(isOk(res)).toBe(false);
    if (!isOk(res)) {
      expect(res.error.category).toBe('NETWORK');
      expect(res.error.retryable).toBe(true);
    }
  });

  it('fetchRssItemsWithFallback 首个候选成功即返回，不请求后续源', async () => {
    let calls = 0;
    const fetcher = ((url: string | URL | Request) => {
      calls++;
      const u = String(url);
      if (u.includes('a.example.com')) {
        return Promise.resolve(
          new Response(SAMPLE_RSS_XML, {
            status: 200,
            headers: { 'content-type': 'application/rss+xml' },
          })
        ) as never;
      }
      return Promise.resolve(new Response('', { status: 500 })) as never;
    }) as never;
    const res = await fetchRssItemsWithFallback(
      [
        { url: 'https://a.example.com/rss', publisher: 'A', language: 'EN' },
        { url: 'https://b.example.com/rss', publisher: 'B', language: 'EN' },
      ],
      { fetcher }
    );
    expect(isOk(res)).toBe(true);
    expect(calls).toBe(1);
    if (isOk(res)) {
      expect(res.value.feed.publisher).toBe('A');
      expect(res.value.items.length).toBeGreaterThan(0);
    }
  });

  it('fetchNewsArticleFullText 非法 URL 直接回退（不发起请求）', async () => {
    let called = false;
    const fetcher = (() => {
      called = true;
      return Promise.resolve(new Response('', { status: 200 })) as never;
    }) as never;
    const res = await fetchNewsArticleFullText('not-a-url', { fetcher });
    expect(isOk(res)).toBe(false);
    expect(called).toBe(false);
    if (!isOk(res)) {
      expect(res.error.code).toBe('E_NEWS_ARTICLE_URL');
      expect(res.error.retryable).toBe(false);
    }
  });

  it('fetchRssItems 直接调用：超时映射为 E_NEWS_RSS_TIMEOUT', async () => {
    const res = await fetchRssItems('https://example.com/rss', {
      fetcher: makeTimeoutFetcher(),
    });
    expect(isOk(res)).toBe(false);
    if (!isOk(res)) {
      expect(res.error.code).toBe('E_NEWS_RSS_TIMEOUT');
      expect(res.error.userMessage).toContain('超时');
    }
  });
});
