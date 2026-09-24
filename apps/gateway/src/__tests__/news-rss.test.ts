import { describe, expect, it } from 'bun:test';
import {
  parseRssItems,
  resolveNewsFeed,
  resolveNewsFeedCandidates,
  pickLeadSentence,
} from '../modules/curriculum/infrastructure/news-rss.js';
import { generateNewsPassage } from '../modules/curriculum/application/generate-news-passage.js';
import { DEFAULT_CONTENT_LANGUAGE } from '../modules/curriculum/application/content-language-policy.js';

describe('news RSS integration', () => {
  // 真网 live 用例：默认隔离，CI/常规 bun test 不跑；
  // 本地手动验证：STUDY_STUDIO_LIVE_NEWS=1 bun test src/__tests__/news-rss.test.ts
  const liveIt = process.env.STUDY_STUDIO_LIVE_NEWS === '1' ? it : it.skip;
  it('defaults product language policy to English', () => {
    expect(DEFAULT_CONTENT_LANGUAGE).toBe('EN');
  });

  it('maps EN topics across BBC / Guardian / NPR', () => {
    expect(resolveNewsFeed('technology', 'EN').publisher).toBe('BBC News');
    expect(resolveNewsFeed('technology', 'EN').url).toContain('technology');

    const world = resolveNewsFeed('world', 'EN');
    expect(world.publisher).toBe('The Guardian');
    expect(world.url).toContain('theguardian.com');

    const culture = resolveNewsFeed('culture', 'EN');
    expect(culture.publisher).toBe('NPR');
    expect(culture.url).toContain('npr.org');

    const enCandidates = resolveNewsFeedCandidates('technology', 'EN');
    expect(enCandidates.length).toBeGreaterThanOrEqual(2);
  });

  it('maps JA to NHK candidates and KO to Korean Yonhap feeds', () => {
    const ja = resolveNewsFeed('world', 'JA');
    expect(ja.publisher).toBe('NHK ONE');
    expect(ja.url).toContain('cat6.xml');

    const jaAll = resolveNewsFeedCandidates('world', 'JA');
    expect(jaAll.length).toBeGreaterThanOrEqual(2);
    expect(jaAll[1]!.url).toContain('nhk.or.jp');

    const ko = resolveNewsFeed('world', 'KO');
    expect(ko.language).toBe('KO');
    expect(ko.publisher).toBe('연합뉴스');
    expect(ko.url).toContain('yna.co.kr');
    expect(ko.url).toContain('international');

    const koTech = resolveNewsFeed('technology', 'KO');
    expect(koTech.url).toContain('industry');

    const koAll = resolveNewsFeedCandidates('world', 'KO');
    expect(koAll.some((f) => f.url.includes('donga.com'))).toBe(true);
  });

  it('builds Korean TOPIK AI passage (no longer an English scaffold)', async () => {
    const { buildKoreanAiReadingPrompt } = await import(
      '../modules/curriculum/application/content-language-policy.js'
    );
    const p = buildKoreanAiReadingPrompt({ topic: '시사', difficulty: 2 });
    expect(p.sourceLabel).toContain('TOPIK');
    expect(p.body).toContain('시사');
    expect(/[\uAC00-\uD7A3]/.test(p.body)).toBe(true);
    expect(p.body).not.toContain('interim EN scaffold');
  });

  it('parses NHK-like RSS XML items', () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
<item>
  <title><![CDATA[テスト見出し]]></title>
  <link>https://example.com/a</link>
  <description><![CDATA[第一文です。第二文です。]]></description>
  <pubDate>Fri, 04 Sep 2026 12:00:00 +0900</pubDate>
</item>
</channel></rss>`;
    const items = parseRssItems(xml);
    expect(items.length).toBe(1);
    expect(items[0]!.title).toBe('テスト見出し');
    expect(items[0]!.description).toContain('第一文');
    expect(pickLeadSentence(items[0]!.description)).toBe('第一文です');
  });

  it('strips Guardian-style entity-escaped HTML from description', () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
<item>
  <title>UK hits back at Argentinian Falklands claim</title>
  <link>https://example.com/falklands</link>
  <description>&lt;p&gt;Ed Miliband says Britain&amp;#x27;s position remains unwavering.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;&lt;p&gt;&lt;a href=&quot;https://example.com/live&quot;&gt;UK politics live&lt;/a&gt;&lt;/p&gt;&lt;/li&gt;&lt;/ul&gt;</description>
</item>
</channel></rss>`;
    const items = parseRssItems(xml);
    expect(items.length).toBe(1);
    const desc = items[0]!.description;
    expect(desc).not.toMatch(/<\/?[a-z]+/i);
    expect(desc).toContain('Ed Miliband');
    expect(desc).toContain('UK politics live');
    expect(desc).toContain("Britain's position");
  });

  it('sanitizeRssText handles real HTML tags inside CDATA', async () => {
    const { sanitizeRssText } = await import('../modules/curriculum/infrastructure/news-rss.js');
    const cleaned = sanitizeRssText(
      '<![CDATA[<p>First sentence.</p><p>Second <a href="x">link</a> here.</p>]]>'
    );
    expect(cleaned).not.toMatch(/</);
    expect(cleaned).toContain('First sentence');
    expect(cleaned).toContain('Second');
    expect(cleaned).toContain('link');
  });

  liveIt(
    'fetches a live English media feed when network allows',
    async () => {
      const news = await generateNewsPassage({
        setId: 'read_news_live_en',
        topic: 'technology',
        language: 'EN',
      });
      expect(news.title.length).toBeGreaterThan(0);
      expect(news.questions.length).toBe(3);
      if (news.fromRss) {
        expect(news.publisher).toBe('BBC News');
        expect(news.sourceUrl).toBeTruthy();
        expect(news.sourceLabel).toContain('BBC');
        // 全文抓取视站点反爬而定：成功则原文摘录，失败仍保留 RSS 摘要
        expect(typeof news.fromFullText).toBe('boolean');
        expect(news.body.length).toBeGreaterThan(40);
        expect(news.body).not.toMatch(/<\/?[a-z]+/i);
      } else {
        expect(news.sourceLabel).toContain('template');
        expect(news.fromFullText).toBe(false);
      }
    },
    { timeout: 20_000 }
  );

  liveIt(
    'fetches a live NHK feed when network allows',
    async () => {
      const news = await generateNewsPassage({
        setId: 'read_news_live_ja',
        topic: 'world',
        language: 'JA',
      });
      expect(news.title.length).toBeGreaterThan(0);
      expect(news.questions.length).toBe(3);
      if (news.fromRss) {
        expect(news.publisher).toMatch(/NHK/);
        expect(news.sourceUrl).toBeTruthy();
        expect(news.sourceLabel).toMatch(/NHK/);
        expect(typeof news.fromFullText).toBe('boolean');
        expect(news.body.length).toBeGreaterThan(40);
        expect(news.body).not.toMatch(/<\/?[a-z]+/i);
      } else {
        expect(news.sourceLabel).toContain('模板');
        expect(news.fromFullText).toBe(false);
      }
    },
    { timeout: 25_000 }
  );

  liveIt(
    'fetches a live Korean Yonhap feed when network allows',
    async () => {
      const news = await generateNewsPassage({
        setId: 'read_news_live_ko',
        topic: 'world',
        language: 'KO',
      });
      expect(news.title.length).toBeGreaterThan(0);
      expect(news.questions.length).toBe(3);
      if (news.fromRss) {
        expect(news.publisher).toMatch(/연합|동아/);
        expect(news.sourceUrl).toBeTruthy();
        expect(typeof news.fromFullText).toBe('boolean');
        expect(news.body.length).toBeGreaterThan(20);
        expect(news.questions[0]!.prompt).toMatch(/뉴스|중심/);
      } else {
        expect(news.sourceLabel).toContain('템플릿');
        expect(news.fromFullText).toBe(false);
      }
    },
    { timeout: 25_000 }
  );
});
