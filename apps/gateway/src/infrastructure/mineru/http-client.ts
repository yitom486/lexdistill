import { BusinessError, translateToBusinessError } from '@study-studio/shared';

export const MINERU_CLOUD_URL = 'https://mineru.net';
export const MINERU_CLOUD_PAGE_LIMIT = 200;
export const MINERU_CLOUD_BYTE_LIMIT = 200_000_000;
const domains = ['mineru.net', 'openxlab.org.cn', 'aliyuncs.com'];
export class MineruHttpClient {
  constructor(readonly baseUrl: string, readonly token: string, readonly signal: AbortSignal, readonly requestTimeoutMs = 60_000) {}
  url(path: string): string { return new URL(path, this.baseUrl).href; }
  auth(url: string): Record<string, string> { return new URL(url).origin === new URL(this.baseUrl).origin && this.token ? { Authorization: `Bearer ${this.token}` } : {}; }
  allowed(url: string): string {
    const target = new URL(url, this.baseUrl);
    if (target.origin === new URL(this.baseUrl).origin || (target.protocol === 'https:' && domains.some(domain => target.hostname === domain || target.hostname.endsWith(`.${domain}`)))) return target.href;
    throw new BusinessError('E_MINERU_RESPONSE_INVALID', '解析服务返回了非预期的文件地址', 'VALIDATION');
  }
  async response(url: string, init: RequestInit = {}): Promise<Response> {
    try {
      let target = this.allowed(url);
      let response: Response;
      for (let redirects = 0; ; redirects++) {
        const headers = new Headers(init.headers);
        if (new URL(target).origin !== new URL(this.baseUrl).origin) headers.delete('Authorization');
        response = await fetch(target, { ...init, headers, signal: AbortSignal.any([this.signal, AbortSignal.timeout(this.requestTimeoutMs)]), redirect: 'manual' });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        await response.body?.cancel();
        const location = response.headers.get('Location');
        if (init.method && init.method !== 'GET' || redirects >= 3 || !location) throw new BusinessError('E_MINERU_RESPONSE_INVALID', '解析服务返回了无效的文件跳转', 'VALIDATION');
        target = this.allowed(new URL(location, target).href);
      }
      if (!response.ok) throw new BusinessError('E_MINERU_HTTP', response.status === 401 || response.status === 403 ? 'MinerU 凭据无效或没有解析权限，请检查配置' : response.status === 429 ? 'MinerU 请求过于频繁，请降低解析并发后重试' : 'MinerU 请求失败，请检查网络或服务状态', 'NETWORK', response.status === 429 || response.status >= 500, { status: response.status });
      return response;
    } catch (cause) {
      if (cause instanceof BusinessError) throw cause;
      if (this.signal.aborted) throw new BusinessError('E_CANCELLED', '本次解析已停止，已保存章节保留', 'TOOL_EXECUTION');
      throw translateToBusinessError(cause, { category: 'NETWORK', fallbackMessage: '无法连接 MinerU，请检查网络、代理和解析服务' });
    }
  }
  async json(path: string, body?: unknown): Promise<unknown> {
    const url = this.url(path);
    const response = await this.response(url, { headers: { ...this.auth(url), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    try { return await response.json(); }
    catch { throw new BusinessError('E_MINERU_RESPONSE_INVALID', 'MinerU 返回的解析回执格式不正确', 'VALIDATION', true); }
  }
  async bytes(url: string): Promise<Uint8Array> {
    return new Uint8Array(await (await this.response(url, { headers: this.auth(url) })).arrayBuffer());
  }
  async pause(ms: number): Promise<void> {
    if (this.signal.aborted) throw new BusinessError('E_CANCELLED', '本次解析已停止', 'TOOL_EXECUTION');
    await new Promise<void>((resolve, reject) => {
      const cancel = () => { clearTimeout(timer); reject(new BusinessError('E_CANCELLED', '本次解析已停止', 'TOOL_EXECUTION')); };
      const timer = setTimeout(() => { this.signal.removeEventListener('abort', cancel); resolve(); }, ms);
      this.signal.addEventListener('abort', cancel, { once: true });
    });
  }
}
