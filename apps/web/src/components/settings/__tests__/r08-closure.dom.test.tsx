import { expect, it, mock } from 'bun:test';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, setupDom, type DomHandle } from '../../toc/__tests__/dom-setup.js';

if (process.env['LINGUA_R08_REVIEW_CHILD'] !== '1') {
  it('R08 closure boundaries (isolated)', async () => {
    const child = Bun.spawn([process.execPath, 'test', import.meta.path], {
      env: { ...process.env, LINGUA_R08_REVIEW_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ exit, output: exit ? out + err : '' }).toEqual({ exit: 0, output: '' });
  }, 60000);
} else {
  let dom: DomHandle;
  const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  async function fresh() { dom?.teardown(); dom = await setupDom(true); }
  async function until(test: () => boolean) { for (let n = 0; n < 200 && !test(); n++) await tick(); expect(test()).toBe(true); }
  let mic: ReturnType<typeof import('../../../hooks/useMicrophoneTester.js').useMicrophoneTester>;
  async function mountMic(media: object) {
    await fresh();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: media });
    const { useMicrophoneTester } = await import('../../../hooks/useMicrophoneTester.js');
    function Probe() { mic = useMicrophoneTester(); return null; }
    await act(async () => { dom.root.render(<Probe />); });
  }

  it('enumeration failure differs from empty, retry clears only its error, device failures are not permission denial', async () => {
    let broken = true;
    await mountMic({
      enumerateDevices: async () => { if (broken) throw new Error('enumeration'); return [{ kind: 'audioinput', deviceId: 'one', label: 'Named microphone' }]; },
      getUserMedia: async () => { throw Object.assign(new Error('missing'), { name: 'NotFoundError' }); },
    });
    await until(() => mic.devicesReady);
    expect(mic.devicesError).toContain('枚举失败');
    expect(mic.devices).toEqual([]);
    broken = false;
    await act(async () => { await mic.refreshDevices(); });
    expect(mic.devicesError).toBeNull();
    expect(mic.devices[0]?.label).toBe('Named microphone');
    await act(async () => { await mic.startTest(); });
    expect(mic.permissionState).toBe('idle');
    expect(mic.errorMessage).toContain('未找到');
    await act(async () => { await mic.refreshDevices(); });
    expect(mic.errorMessage).toContain('未找到');
  });

  it('pending permission is single-flight; cancel and unmount stop late tracks without AudioContext', async () => {
    for (const unmount of [false, true]) {
      let release!: (value: MediaStream) => void;
      let requests = 0;
      let stops = 0;
      let contexts = 0;
      const pending = new Promise<MediaStream>((r) => { release = r; });
      await mountMic({ enumerateDevices: async () => [], getUserMedia: () => { requests++; return pending; } });
      Object.defineProperty(window, 'AudioContext', { configurable: true, value: class { constructor() { contexts++; } } });
      let first!: Promise<void>;
      await act(async () => { first = mic.startTest(); void mic.startTest(); });
      expect(requests).toBe(1);
      expect(mic.permissionState).toBe('requesting');
      await act(async () => { if (unmount) dom.root.render(null); else mic.stopTest(); });
      await act(async () => { release({ getTracks: () => [{ stop: () => { stops++; } }] } as unknown as MediaStream); await first; });
      expect(stops).toBe(1);
      expect(contexts).toBe(0);
      if (!unmount) expect(mic.isTesting).toBe(false);
    }
  });

  it('persistent management reads reject open/cursor/transaction errors, legacy memory fallback stays available', async () => {
    const { listAudioCache, getAudioCacheStats, clearAllAudioCache } = await import('../../../lib/audio-cache.js');
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    let mode = 'open-error';
    let closed = 0;
    const record = { id: 'actual', createdAt: 1, sizeBytes: 9, text: 'test', provider: 'test',
      voice: 'test', model: '', rate: 1, lang: 'ja', purpose: 'preview', mimeType: 'audio/wav',
      blob: new Blob(['test']), lastPlayedAt: 1 };
    const factory = { open() {
      const request: Record<string, any> = {};
      queueMicrotask(() => {
        if (mode === 'open-error') { request.error = new Error('disk unavailable'); request.onerror(); return; }
        request.result = { close() { closed++; }, transaction() {
          const tx: Record<string, any> = {};
          tx.objectStore = () => ({ openCursor() {
            const cursorRequest: Record<string, any> = {};
            queueMicrotask(() => {
              if (mode === 'cursor-error') { cursorRequest.error = new Error('cursor failed'); cursorRequest.onerror(); }
              else if (mode === 'abort') { tx.error = new Error('transaction aborted'); tx.onabort(); }
              else {
                cursorRequest.result = mode === 'empty' ? null : { value: record, continue() { cursorRequest.result = null; cursorRequest.onsuccess(); } };
                cursorRequest.onsuccess(); tx.oncomplete();
              }
            });
            return cursorRequest;
          } });
          return tx;
        } };
        request.onsuccess();
      });
      return request;
    } };
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: factory });
    try {
      for (mode of ['open-error', 'cursor-error', 'abort']) {
        await expect(listAudioCache(200, true)).rejects.toThrow();
        await expect(getAudioCacheStats(true)).rejects.toThrow();
      }
      mode = 'open-error';
      expect(await listAudioCache()).toEqual([]);
      await expect(clearAllAudioCache(true)).rejects.toThrow('disk unavailable');
      mode = 'empty';
      expect(await listAudioCache(200, true)).toEqual([]);
      expect(await getAudioCacheStats(true)).toEqual({ count: 0, totalBytes: 0 });
      mode = 'success';
      expect(await listAudioCache(200, true)).toEqual([record]);
      expect(await getAudioCacheStats(true)).toEqual({ count: 1, totalBytes: 9 });
      expect(closed).toBe(8);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor);
      else Reflect.deleteProperty(globalThis, 'indexedDB');
    }
  });

  it('service directory failure preserves saved choice and exposes retry; keys have associated labels', async () => {
    await fresh();
    mock.module('../../../utils/audio.js', () => ({ sound: { playClick() {} }, speechStudio: {
      subscribe: () => () => {}, configure() {}, getConfig: () => ({}), stop() {}, getIsSpeaking: () => false,
      getIsStreaming: () => false, getStreamedSeconds: () => 0, getStreamedChunks: () => 0, getCurrentText: () => '',
      getLastAudio: () => null, getLastRequest: () => null, getStopEpoch: () => 0,
    } }));
    const { useTtsStore } = await import('../../../stores/useTtsStore.js');
    useTtsStore.setState({ preferredService: 'saved-custom-service', voiceId: 'saved-voice', modelId: 'saved-model',
      providerApiKeys: {}, backupApiKeys: {}, azureRegion: '', localBaseUrl: '' });
    const { TtsServiceSettings } = await import('../../tts/TtsServiceSettings.js');
    const originalFetch = globalThis.fetch;
    let ok = false;
    globalThis.fetch = (async () => ok ? Response.json({ providers: [] }) : new Response('broken', { status: 500 })) as unknown as typeof fetch;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    try {
      await act(async () => { dom.root.render(<QueryClientProvider client={client}><TtsServiceSettings lang="JA" /></QueryClientProvider>); });
      await until(() => !!dom.dom.window.document.body.textContent?.includes('服务列表读取失败'));
      const doc = dom.dom.window.document;
      expect(doc.body.textContent).toContain('saved-custom-service');
      for (const input of doc.querySelectorAll('input[type="password"]')) {
        expect(input.id).not.toBe(''); expect(doc.querySelector(`label[for="${input.id}"]`)).toBeTruthy();
      }
      expect(useTtsStore.getState().preferredService).toBe('saved-custom-service');
      expect(useTtsStore.getState().voiceId).toBe('saved-voice');
      expect(useTtsStore.getState().modelId).toBe('saved-model');
      expect([...doc.querySelectorAll('button')].some((b) => b.textContent === '重新读取服务')).toBe(true);
      ok = true;
      await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent === '重新读取服务') as HTMLButtonElement).click(); });
      await until(() => !!doc.body.textContent?.includes('暂无可选语音服务'));
      expect(useTtsStore.getState().preferredService).toBe('saved-custom-service');
    } finally { globalThis.fetch = originalFetch; client.clear(); }
  });
}
