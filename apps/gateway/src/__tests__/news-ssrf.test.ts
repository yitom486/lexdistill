import { describe, expect, it } from 'bun:test';
import { isOk } from '@lexdistill/shared';
import { fetchNewsArticleFullText } from '../modules/curriculum/infrastructure/news-article-fetch.js';
import { fetchRssItems } from '../modules/curriculum/infrastructure/news-rss.js';

const ARTICLE_HTML =
  '<html><head><title>t</title></head><body><article>' +
  '<p>First paragraph with enough content to pass the minimum length requirement for full text extraction logic here.</p>' +
  '<p>Second paragraph adds more study material for the learner reading set generation pipeline test.</p>' +
  '</article></body></html>';

const htmlFetcher = ((async () =>
  new Response(ARTICLE_HTML, {
    status: 200,
    headers: { 'content-type': 'text/html' },
  })) as unknown) as typeof fetch;

describe('news SSRF guard（攻击向量）', () => {
  it('本机/私网/链路本地/非法 scheme 一律拒绝（不发请求）', async () => {
    let called = 0;
    const spy = (async () => {
      called += 1;
      return new Response('x', { status: 200 });
    }) as unknown as typeof fetch;
    for (const url of [
      'http://localhost/evil',
      'http://localhost:8080/admin',
      'http://127.0.0.1/evil',
      'http://127.1.2.3:9/evil',
      'http://10.0.0.1/evil',
      'http://172.16.5.4/evil',
      'http://172.31.255.255/evil',
      'http://192.168.1.1/evil',
      'http://169.254.169.254/latest/meta-data/',
      'http://0.0.0.0/evil',
      'http://[::1]/evil',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'ftp://example.com/x',
      'not a url',
    ]) {
      const res = await fetchNewsArticleFullText(url, { fetcher: spy });
      expect(isOk(res)).toBe(false);
    }
    expect(called).toBe(0);
  });

  it('重定向落点私网被拦截（302 跳 127 即停）', async () => {
    let calls = 0;
    const redirectToLocal = (async (input: unknown) => {
      calls += 1;
      if (String(input).includes('127.0.0.1')) {
        return new Response('pwned', { status: 200 });
      }
      return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:9/evil' } });
    }) as unknown as typeof fetch;
    const res = await fetchNewsArticleFullText('http://93.184.216.0/start', {
      fetcher: redirectToLocal,
    });
    expect(isOk(res)).toBe(false);
    // 首跳 + 拦截，无第三跳
    expect(calls).toBe(1);
  });

  it('重定向过多拒绝（循环 302）', async () => {
    let calls = 0;
    const loop = (async () => {
      calls += 1;
      return new Response(null, {
        status: 302,
        headers: { location: 'http://93.184.216.1/loop' },
      });
    }) as unknown as typeof fetch;
    const res = await fetchNewsArticleFullText('http://93.184.216.0/start', { fetcher: loop });
    expect(isOk(res)).toBe(false);
    expect(calls).toBeLessThanOrEqual(4);
  });

  it('超大响应体拒绝（content-length 6MB）', async () => {
    const big = (async () =>
      new Response('x', {
        status: 200,
        headers: { 'content-type': 'text/html', 'content-length': String(6 * 1024 * 1024) },
      })) as unknown as typeof fetch;
    const res = await fetchNewsArticleFullText('http://93.184.216.0/big', { fetcher: big });
    expect(isOk(res)).toBe(false);
  });

  it('正常文章照常抽取（回归：守卫不误伤）', async () => {
    const res = await fetchNewsArticleFullText('http://93.184.216.0/news/1', {
      fetcher: htmlFetcher,
    });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.fromFullText).toBe(true);
  });

  it('RSS 源地址非法直接拒绝', async () => {
    let called = 0;
    const spy = (async () => {
      called += 1;
      return new Response('<rss></rss>', { status: 200 });
    }) as unknown as typeof fetch;
    const res = await fetchRssItems('http://169.254.169.254/feed', { fetcher: spy });
    expect(isOk(res)).toBe(false);
    expect(called).toBe(0);
  });
});
