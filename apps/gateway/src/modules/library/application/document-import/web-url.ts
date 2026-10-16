import { lookup } from 'node:dns/promises';
import { BusinessError } from '@lexdistill/shared';

/**
 * 公网 URL 安全读取（AI 可调用的 URL 导入专用）。
 *
 * 现有新闻管线只校验 scheme；本模块补足 SSRF 防护后才敢把 URL 入口交给 AI：
 * - 本机回环/私网/链路本地一律拒绝（含重定向落点，逐跳复检）；
 * - 响应体限流读取（防超大文件 OOM）；
 * - 超时 + 重定向上限。
 */

const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  return false;
}

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost') return true;
  if (h === '::1' || h === '[::1]') return true;
  if (h.startsWith('[') && h.endsWith(']')) {
    const inner = h.slice(1, -1);
    if (inner === '::1') return true;
    if (inner.toLowerCase().startsWith('fe80:')) return true;
    if (/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.test(inner)) {
      return isPrivateIPv4(inner.slice(7));
    }
    if (inner.includes(':')) return true;
    return isPrivateIPv4(inner);
  }
  if (h.includes(':')) return true;
  return isPrivateIPv4(h);
}

/** 主机名 → 拒绝私网（字面 IP 直判；域名解析后复判；解析失败按不可用处理）。 */
export async function assertPublicWebUrl(rawUrl: string): Promise<string> {
  const trimmed = (rawUrl || '').trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new BusinessError('E_INVALID_INPUT', '网址不正确（须为 http(s) 地址）', 'VALIDATION', false);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BusinessError('E_INVALID_INPUT', '只接受 http(s) 网址', 'VALIDATION', false);
  }
  if (isPrivateHost(url.hostname)) {
    throw new BusinessError('E_INVALID_INPUT', '只接受公网网址，不访问本机与内网地址', 'SECURITY', false);
  }
  try {
    const records = await lookup(url.hostname);
    const addresses = Array.isArray(records) ? records : [records];
    for (const record of addresses) {
      const ip = typeof record === 'string' ? record : record.address;
      if (isPrivateHost(ip)) {
        throw new BusinessError('E_INVALID_INPUT', '该域名解析到内网地址，拒绝访问', 'SECURITY', false);
      }
    }
  } catch (e) {
    if (e instanceof BusinessError) throw e;
    throw new BusinessError('E_INVALID_INPUT', '网址域名无法解析', 'VALIDATION', false);
  }
  return url.toString();
}

/** 限流读 body（超上限抛中文错；调用方不再二次读流）。新闻管线复用同一上限。 */
export async function readBoundedText(res: Response): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new BusinessError('E_INVALID_INPUT', '网页过大（上限 5MB），拒绝抓取', 'VALIDATION', false);
  }
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    if (text.length > MAX_BODY_BYTES) {
      throw new BusinessError('E_INVALID_INPUT', '网页过大（上限 5MB），拒绝抓取', 'VALIDATION', false);
    }
    return text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.length;
      if (total > MAX_BODY_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // 忽略取消错误
        }
        throw new BusinessError('E_INVALID_INPUT', '网页过大（上限 5MB），拒绝抓取', 'VALIDATION', false);
      }
      chunks.push(value);
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

export type WebFetchImpl = typeof fetch;

/**
 * 公网 HTML 抓取（手动跟随重定向并逐跳复检；返回原文与最终 URL）。
 * fetcher 可注入（单测桩；生产走全局 fetch）。
 */
export async function fetchPublicWebText(
  rawUrl: string,
  fetcher: WebFetchImpl = fetch
): Promise<{ html: string; finalUrl: string }> {
  let current = await assertPublicWebUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetcher(current, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'User-Agent': 'LinguaStudio/0.1 (language-learning reader; personal study)',
        },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location || hop === MAX_REDIRECTS) {
          throw new BusinessError('E_INVALID_INPUT', '网址重定向异常或过多', 'VALIDATION', false);
        }
        current = await assertPublicWebUrl(new URL(location, current).toString());
        continue;
      }
      if (!res.ok) {
        throw new BusinessError(
          'E_TOOL_EXECUTION',
          `网页暂时不可用（HTTP ${res.status}）`,
          'NETWORK',
          true
        );
      }
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType && !/html|xml|text\/plain/i.test(contentType)) {
        throw new BusinessError('E_INVALID_INPUT', '该地址不是可读网页', 'VALIDATION', false);
      }
      return { html: await readBoundedText(res), finalUrl: current };
    } catch (e) {
      if (e instanceof BusinessError) throw e;
      if ((e as { name?: string } | null)?.name === 'AbortError') {
        throw new BusinessError('E_TOOL_EXECUTION', '网页抓取超时', 'NETWORK', true);
      }
      throw new BusinessError('E_TOOL_EXECUTION', '网页抓取失败，请稍后重试', 'NETWORK', true);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new BusinessError('E_INVALID_INPUT', '网址重定向过多', 'VALIDATION', false);
}
