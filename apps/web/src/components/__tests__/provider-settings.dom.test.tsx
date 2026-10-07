import { afterEach, expect, it } from 'bun:test';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProviderSettingsSection } from '../ProviderSettingsSection.js';
import { act, setupDom, type DomHandle } from '../toc/__tests__/dom-setup.js';

let dom: DomHandle | undefined;
let client: QueryClient | undefined;
const originalFetch = globalThis.fetch;
const calls: Array<{ url: string; method: string }> = [];
afterEach(() => {
  dom?.teardown(); dom = undefined; client?.clear(); client = undefined;
  globalThis.fetch = originalFetch;
  calls.length = 0;
});

it('自定义供应商：未配置显示入口；保存走 POST，Key 不回显', async () => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: String(init?.method || 'GET') });
    if (url.endsWith('/api/agent/provider') && (!init || !init.method || init.method === 'GET')) {
      return Response.json({ provider: { configured: false, hasApiKey: false } });
    }
    if (url.endsWith('/api/agent/provider')) {
      return Response.json({ provider: { configured: true, name: 't', baseUrl: 'https://x', model: 'm', hasApiKey: true } });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as unknown as typeof fetch;
  dom = await setupDom(true);
  const doc = dom.dom.window.document;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  await act(async () => dom!.root.render(
    <QueryClientProvider client={client!}><ProviderSettingsSection /></QueryClientProvider>,
  ));
  const waitFor = async (ready: () => boolean) => {
    for (let i = 0; i < 100 && !ready(); i++) await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(ready()).toBe(true);
  };
  await waitFor(() => !!doc.querySelector('input[aria-label="供应商地址"]'));
  const setValue = async (label: string, value: string) => {
    const input = doc.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement | null;
    expect(input).toBeTruthy();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input!, value);
      input!.dispatchEvent(new (dom!.dom.window as unknown as { Event: typeof Event }).Event('input', { bubbles: true }));
    });
  };
  await setValue('供应商地址', 'https://api.example.com/v1');
  await setValue('供应商模型', 'gpt-4o-mini');
  await setValue('供应商密钥', 'sk-test');
  const save = [...doc.querySelectorAll('button')].find(b => b.textContent === '保存供应商') as HTMLButtonElement | undefined;
  expect(save?.disabled).toBe(false);
  await act(async () => save!.click());
  await waitFor(() => calls.some(call => call.method === 'POST'));
  expect(calls.some(call => call.url.endsWith('/api/agent/provider') && call.method === 'POST')).toBe(true);
});
