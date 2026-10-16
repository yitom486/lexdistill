import { expect, it, mock } from 'bun:test';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, setupDom, type DomHandle } from '../../toc/__tests__/dom-setup.js';
/**
 * UI-R08 设置可信状态：受控 fetch + 真容器行为（非浅层 markup）。
 * 覆盖：试音文案同步中/失败/未下发三分、失败不显示正在同步、供应商读取中/
 * 失败/未配置/已配置、词典包四态与离线禁用原因、Anki 未知态不冒充关闭、
 * 输入设备枚举三态与权限徽标、控件可达性命名。隔离环境，不录音、不付费
 * 试听、不改真实账户与用户偏好（子进程内）。
 */

if (process.env['LINGUA_SETTINGS_CHILD'] !== '1') {
  it('settings states (child isolation)', async () => {
    const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_SETTINGS_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ exit, output: exit ? stdout + stderr : '' }).toEqual({ exit: 0, output: '' });
  }, 60000);
} else {

let dom: DomHandle | undefined;

async function freshDom() {
  dom?.teardown();
  dom = await setupDom(true);
  const el = (globalThis as Record<string, unknown>)['Element'] as { prototype: { scrollIntoView?: unknown } } | undefined;
  if (el && typeof el.prototype.scrollIntoView !== 'function') {
    el.prototype.scrollIntoView = function () {};
  }
  return dom;
}

function mockInfra() {
  mock.module('../../../utils/audio.js', () => ({
    sound: { playClick() {}, playCorrect() {}, playMistake() {}, playSuccess() {} },
    speechStudio: {
      speak: async () => {},
      stop: () => {},
      replayLast: async () => {},
      canReplay: () => false,
      subscribe: () => () => {},
      configure: () => {},
      getConfig: () => ({}),
      getIsSpeaking: () => false,
      getIsStreaming: () => false,
      getStreamedSeconds: () => 0,
      getStreamedChunks: () => 0,
      getCurrentText: () => '',
      getStopEpoch: () => 0,
      getLastAudio: () => null,
      getLastRequest: () => null,
    },
  }));
  mock.module('sonner', () => ({
    toast: { info() {}, error() {}, success() {}, warning() {} },
  }));
  mock.module('../../tts/TtsModelPicker.js', () => ({ TtsModelPicker: () => null }));
  mock.module('../../tts/TtsVoiceLibrary.js', () => ({ TtsVoiceLibrary: () => null }));
  mock.module('../../audio/AudioCacheManager.js', () => ({ AudioCacheManager: () => null }));
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
}

const settle = async () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
async function waitFor(ready: () => boolean) {
  for (let i = 0; i < 200 && !ready(); i++) await settle();
  expect(ready()).toBe(true);
}

function makeFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const calls: string[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method || 'GET'} ${url}`);
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

it('试音文案：同步中/失败/未下发/已下发四态，失败绝不显示正在同步', async () => {  await freshDom();
  mockInfra();
  const { TtsStudioSettings } = await import('../../TtsStudioSettings.js');
  const { useTtsStore } = await import('../../../stores/useTtsStore.js');
  useTtsStore.getState().setRate(1);
  const doc = dom!.dom.window.document;
  const originalFetch = globalThis.fetch;
  try {
    let mode: 'hold' | 'error' | 'empty' | 'ok' = 'hold';
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { fetchFn } = makeFetch(async (url) => {
      if (url.includes('/api/tts-studio/defaults')) {
        if (mode === 'hold') await gate;
        if (mode === 'error') return new Response('boom', { status: 500 });
        if (mode === 'empty') return Response.json({ defaultProvider: 'gemini', previewTexts: {} });
        return Response.json({ defaultProvider: 'gemini', previewTexts: { ja: 'テスト文です。' } });
      }
      return new Response('[]', { status: 500 });
    });
    globalThis.fetch = fetchFn;
    const client = makeClient();
    await act(async () => {
      dom!.root.render(<QueryClientProvider client={client}><TtsStudioSettings lang="JA" /></QueryClientProvider>);
    });
    // 同步中
    await waitFor(() => !!doc.body.textContent?.includes('正在同步网关试音配置'));
    expect(doc.body.textContent).not.toContain('试音文案读取失败');
    // 失败：可读措辞 + 重试入口，占位不显示正在同步
    mode = 'error';
    release();
    await waitFor(() => !!doc.body.textContent?.includes('试音文案读取失败'));
    expect(doc.body.textContent).not.toContain('正在同步');
    const input = doc.querySelector('input[value=""]') as HTMLInputElement | null;
    expect(input?.placeholder).toContain('读取失败');
    // 重试转成功
    mode = 'ok';
    const retry = [...doc.querySelectorAll('button')].find((b) => b.textContent === '重新读取') as HTMLButtonElement;
    await act(async () => { retry.click(); });
    await waitFor(() => !!doc.body.textContent?.includes('テスト文です'));
    // 未下发：不断言失败，说明可手动输入
    mode = 'empty';
    await act(async () => { await client.invalidateQueries({ queryKey: ['tts-studio', 'defaults'] }); });
    await waitFor(() => !!doc.body.textContent?.includes('未下发'));
    expect(doc.body.textContent).not.toContain('试音文案读取失败');
    client.clear();
  } finally {
    globalThis.fetch = originalFetch;
  }
}, 60000);

it('试听条占位：无文案时中性提示，不冒充同步中', async () => {
  await freshDom();
  mockInfra();
  const { TtsPreviewBar } = await import('../../tts/TtsPreviewBar.js');
  const { useTtsStore } = await import('../../../stores/useTtsStore.js');
  useTtsStore.getState().setRate(1);
  const doc = dom!.dom.window.document;
  const client = makeClient();
  const noop = () => undefined;
  await act(async () => {
    dom!.root.render(
      <QueryClientProvider client={client}>
        <TtsPreviewBar lang="JA" serverText="" userText="" onUserTextChange={noop} />
      </QueryClientProvider>
    );
  });
  const input = doc.querySelector('input') as HTMLInputElement | null;
  expect(input?.placeholder).not.toContain('正在同步');
  expect(doc.querySelector('input[type="range"]')?.getAttribute('aria-label')).toBe('朗读语速');
  await act(async () => {
    dom!.root.render(
      <QueryClientProvider client={client}>
        <TtsPreviewBar lang="JA" serverText="" previewPlaceholder="试音文案读取失败，可直接输入句子试听。" userText="" onUserTextChange={noop} />
      </QueryClientProvider>
    );
  });
  expect((doc.querySelector('input') as HTMLInputElement | null)?.placeholder).toContain('读取失败');
  // 空输入禁用试听，不隐式计费
  const listen = [...doc.querySelectorAll('button')].find((b) => b.textContent === '试听') as HTMLButtonElement | undefined;
  expect(listen?.disabled).toBe(true);
  client.clear();
}, 30000);

it('供应商：读取中/失败重试/未配置/已配置，不拿失败冒充未配置', async () => {
  await freshDom();
  mockInfra();
  const { ProviderSettingsSection } = await import('../../ProviderSettingsSection.js');
  const doc = dom!.dom.window.document;
  const originalFetch = globalThis.fetch;
  try {
    let mode: 'hold' | 'error' | 'unconfigured' | 'configured' = 'hold';
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { fetchFn, calls } = makeFetch(async (url) => {
      if (url.endsWith('/api/agent/provider')) {
        if (mode === 'hold') await gate;
        if (mode === 'error') return new Response('boom', { status: 500 });
        if (mode === 'unconfigured') return Response.json({ provider: { configured: false, hasApiKey: false } });
        return Response.json({ provider: { configured: true, model: 'm', hasApiKey: true } });
      }
      throw new Error(`unexpected ${url}`);
    });
    globalThis.fetch = fetchFn;
    const client = makeClient();
    await act(async () => {
      dom!.root.render(<QueryClientProvider client={client}><ProviderSettingsSection /></QueryClientProvider>);
    });
    await waitFor(() => !!doc.body.textContent?.includes('读取中'));
    mode = 'error';
    release();
    await waitFor(() => !!doc.body.textContent?.includes('读取失败，点击重试'));
    expect(doc.body.textContent).not.toContain('未配置');
    const before = calls.length;
    mode = 'unconfigured';
    await act(async () => { (doc.querySelector('button') as HTMLButtonElement).click(); });
    await waitFor(() => calls.length > before && !!doc.body.textContent?.includes('未配置'));
    mode = 'configured';
    await act(async () => { await client.invalidateQueries(); });
    await waitFor(() => !!doc.body.textContent?.includes('已配置 · m'));
    client.clear();
  } finally {
    globalThis.fetch = originalFetch;
  }
}, 30000);

it('词典包：读取中/失败/空/有数据四态，离线禁用原因明确', async () => {
  await freshDom();
  mockInfra();
  const { SettingsDictionarySection } = await import('../SettingsDictionarySection.js');
  const doc = dom!.dom.window.document;
  const originalFetch = globalThis.fetch;
  try {
    let mode: 'hold' | 'error' | 'empty' | 'ok' = 'hold';
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { fetchFn } = makeFetch(async (url) => {
      if (url.includes('/api/dictionary/packages')) {
        if (mode === 'hold') await gate;
        if (mode === 'error') return new Response('boom', { status: 500 });
        if (mode === 'empty') return Response.json({ packages: [] });
        return Response.json({ packages: [{ id: 'p1', language: 'ja', provider: 't', installed: false, installerReady: true, licenseName: 'L', enabled: true, priority: 0 }] });
      }
      return Response.json({});
    });
    globalThis.fetch = fetchFn;
    const client = makeClient();
    await act(async () => {
      dom!.root.render(<QueryClientProvider client={client}><SettingsDictionarySection isConnected active /></QueryClientProvider>);
    });
    await waitFor(() => !!doc.body.textContent?.includes('正在读取词典包状态'));
    mode = 'error';
    release();
    await waitFor(() => !!doc.body.textContent?.includes('词典包状态读取失败'));
    mode = 'empty';
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent === '重新读取') as HTMLButtonElement).click(); });
    await waitFor(() => !!doc.body.textContent?.includes('暂无可安装词典包'));
    mode = 'ok';
    await act(async () => { await client.invalidateQueries(); });
    await waitFor(() => !!doc.body.textContent?.includes('安装'));
    // 离线：禁用原因明确，不静默
    await act(async () => {
      dom!.root.render(<QueryClientProvider client={client}><SettingsDictionarySection isConnected={false} active /></QueryClientProvider>);
    });
    await waitFor(() => !!doc.body.textContent?.includes('离线时不可安装'));
    const install = [...doc.querySelectorAll('button')].find((b) => b.textContent === '安装') as HTMLButtonElement | undefined;
    expect(install?.disabled).toBe(true);
    expect(install?.title).toContain('离线');
    expect((doc.querySelector('input[type="file"]') as HTMLInputElement).disabled).toBe(true);
    client.clear();
  } finally {
    globalThis.fetch = originalFetch;
  }
}, 30000);

it('Anki：状态未知时开关禁用，不拿关闭冒充已知', async () => {
  await freshDom();
  mockInfra();
  const { SettingsAnkiSection } = await import('../SettingsAnkiSection.js');
  const doc = dom!.dom.window.document;
  const originalFetch = globalThis.fetch;
  try {
    let mode: 'hold' | 'error' | 'off' = 'hold';
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { fetchFn } = makeFetch(async (url) => {
      if (url.includes('/api/flashcards/anki/status')) {
        if (mode === 'hold') await gate;
        if (mode === 'error') return new Response('boom', { status: 500 });
        return Response.json({ enabled: false, connected: false });
      }
      return Response.json({});
    });
    globalThis.fetch = fetchFn;
    const client = makeClient();
    await act(async () => {
      dom!.root.render(<QueryClientProvider client={client}><SettingsAnkiSection isConnected active /></QueryClientProvider>);
    });
    await waitFor(() => !!doc.body.textContent?.includes('读取中'));
    const sw = doc.querySelector('[aria-label="推送到 Anki 开关"]') as HTMLElement | null;
    expect(sw?.getAttribute('data-disabled')).not.toBeNull();
    expect(doc.body.textContent).toContain('状态未知');
    mode = 'error';
    release();
    await waitFor(() => !!doc.body.textContent?.includes('读取失败，点击重试'));
    mode = 'off';
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent?.includes('读取失败')) as HTMLButtonElement).click(); });
    await waitFor(() => !!doc.body.textContent?.includes('推送已关闭'));
    expect((doc.querySelector('[aria-label="推送到 Anki 开关"]') as HTMLElement | null)?.getAttribute('data-disabled')).toBeNull();
    client.clear();
  } finally {
    globalThis.fetch = originalFetch;
  }
}, 30000);

it('输入设备：枚举三态与权限徽标，不泄露内部哨兵', async () => {
  await freshDom();
  mockInfra();
  const g = globalThis as Record<string, unknown>;
  const nav = g['navigator'] as Record<string, unknown>;
  Object.defineProperty(nav, 'mediaDevices', {
    value: {
      enumerateDevices: async () => [],
      getUserMedia: async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); },
    },
    configurable: true,
  });
  const { AudioInputSettings } = await import('../../audio/AudioInputSettings.js');
  const doc = dom!.dom.window.document;
  await act(async () => {
    dom!.root.render(<AudioInputSettings />);
  });
  // 枚举结算为空：不是“正在枚举”，给出权限后路
  await waitFor(() => !!doc.body.textContent?.includes('未发现麦克风设备'));
  expect(doc.body.textContent).toContain('尚未检测权限');
  expect(doc.body.textContent).not.toContain('__default');
  // 展开下拉：选项显示语义名称，无内部哨兵
  const trigger = doc.querySelector('[aria-label="输入设备"]') as HTMLButtonElement | null;
  expect(trigger).toBeTruthy();
  await act(async () => { trigger!.click(); });
  await waitFor(() => doc.querySelectorAll('[role="option"]').length > 0);
  const options = [...doc.querySelectorAll('[role="option"]')].map((o) => o.textContent);
  expect(options.some((t) => t?.includes('__default'))).toBe(false);
  expect(options.some((t) => t?.includes('系统默认麦克风'))).toBe(true);
  // 拒绝：徽标 + alert，不自动录音
  const test = [...doc.querySelectorAll('button')].find((b) => b.textContent === '测试麦克风') as HTMLButtonElement;
  await act(async () => { test.click(); });
  await waitFor(() => !!doc.body.textContent?.includes('权限受限'));
  expect(doc.querySelector('[role="alert"]')).toBeTruthy();
}, 30000);

it('设置控件：输入有标签、按钮有名称、无隐藏 Tab 陷阱', async () => {
  await freshDom();
  mockInfra();
  const { SettingsDictionarySection } = await import('../SettingsDictionarySection.js');
  const { ProviderSettingsSection } = await import('../../ProviderSettingsSection.js');
  const doc = dom!.dom.window.document;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => Response.json({ packages: [] })) as unknown as typeof fetch;
    const client = makeClient();
    await act(async () => {
      dom!.root.render(
        <QueryClientProvider client={client}>
          <SettingsDictionarySection isConnected active />
          <ProviderSettingsSection />
        </QueryClientProvider>
      );
    });
    await waitFor(() => !!doc.querySelector('input[aria-label="供应商地址"]'));
    const bad: string[] = [];
    doc.querySelectorAll('button').forEach((b) => {
      const name = (b.textContent || b.getAttribute('aria-label') || b.getAttribute('title') || '').trim();
      if (!name) bad.push('unnamed-button');
      if ((b as HTMLButtonElement).tabIndex < 0) bad.push(`neg-tab:${name}`);
    });
    doc.querySelectorAll('input').forEach((input) => {
      // 隐藏输入不进键盘序列，不在可达性断言内
      if ((input as HTMLInputElement).type === 'hidden') return;
      if (input.getAttribute('aria-hidden') === 'true') return;
      const labelled =
        input.getAttribute('aria-label') || input.getAttribute('placeholder') ||
        input.closest('label') || (input.id && doc.querySelector(`label[for="${input.id}"]`));
      if (!labelled) bad.push(`unlabelled-input:${input.className.slice(0, 20)}`);
    });
    expect(bad).toEqual([]);
    const upload = doc.querySelector('input[type="file"]') as HTMLInputElement;
    expect(upload.disabled).toBe(false);
    expect(upload.classList.contains('hidden')).toBe(false);
    upload.focus();
    expect(doc.activeElement).toBe(upload);
    client.clear();
  } finally {
    globalThis.fetch = originalFetch;
  }
}, 30000);

}
