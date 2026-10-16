import { expect, it, mock } from 'bun:test';
import type { TTSProvider } from 'gemini-tts-studio/server';

it('TTS provider failure → gateway SSE → playback warning and error callback, without leaking upstream details', async () => {
  // Isolate the provider registry, global fetch and Sonner mock from the workspace suite.
  if (process.env['LINGUA_TTS_ERRORS_CHILD'] !== '1') {
    const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_TTS_ERRORS_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    const [exit, output] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect({ exit, output: exit ? output : '' }).toEqual({ exit: 0, output: '' });
    return;
  }
  const warnings: string[] = [];
  const errors: string[] = [];
  mock.module('sonner', () => ({ toast: {
    warning: (message: string) => warnings.push(message),
    error: (message: string) => errors.push(message),
  } }));
  const { createTtsRoutes } = await import('../../../../gateway/src/transport/http/tts-routes.js');
  const { LocalTTSError } = await import('gemini-tts-studio/server');
  const { speechStudio } = await import('../../utils/audio.js');
  const { BusinessError } = await import('@lexdistill/shared');
  const { fetchTtsStream, TtsStreamError } = await import('../tts-stream.js');
  const originalFetch = globalThis.fetch;
  let upstreamError: unknown;
  let requests = 0;
  let chunks = 0;
  const provider: TTSProvider = {
    id: 'test-tts-errors', displayName: 'Controlled TTS', requiresApiKey: false,
    listModels: async () => ({ models: [], source: 'remote' }),
    listVoices: async () => [],
    synthesize: async () => { throw upstreamError; },
    synthesizeStream: async (_params, _key, onChunk) => {
      if (upstreamError) throw upstreamError;
      await onChunk({ audioBase64: 'AQID', mimeType: 'audio/wav' });
      return { mimeType: 'audio/wav' };
    },
  };
  const app = createTtsRoutes([provider]);
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests++;
    const request = input instanceof Request ? input : new Request(input, init);
    expect(new URL(request.url).pathname).toBe('/api/tts-studio/tts/stream');
    return app.fetch(request);
  }, { preconnect: originalFetch.preconnect });
  speechStudio.configure({ preferredService: provider.id, voiceId: 'test-voice', modelId: '' });

  // Matches Google SDK's status + JSON Error.message, including QuotaFailure metadata.
  const quotaError = (quotaId?: string) => Object.assign(new Error(JSON.stringify({ error: {
    code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Resource has been exhausted. secret-upstream-value',
    ...(quotaId ? { details: [{ violations: [{ quotaId }] }] } : {}),
  } })), { status: 429 });
  const cases = [
    { error: quotaError('GenerateRequestsPerDayPerProjectPerModel'), code: 'E_TTS_QUOTA', hint: '可用额度已用尽', retryable: false, warning: true },
    { error: quotaError('GenerateRequestsPerMinutePerProjectPerModel'), code: 'E_TTS_RATE_LIMIT', hint: '请求过于频繁', retryable: true, warning: true },
    { error: quotaError(), code: 'E_TTS_USAGE_LIMIT', hint: '触发使用限制', retryable: true, warning: true },
    { error: Object.assign(new Error('secret-upstream-value'), { status: 401 }), code: 'E_TTS_AUTH', hint: '未授权', retryable: false, warning: false },
    { error: Object.assign(new Error('secret-upstream-value'), { status: 503 }), code: 'E_TTS_UPSTREAM', hint: '暂时无法生成', retryable: true, warning: false },
    { error: new Error('Azure TTS 生成失败 (429 · region=test): Too Many Requests'), code: 'E_TTS_RATE_LIMIT', hint: '请求过于频繁', retryable: true, warning: true },
    { error: new LocalTTSError('E_LOCAL_AUTH', '本地服务未授权。', 401, false), code: 'E_LOCAL_AUTH', hint: '本地服务未授权', retryable: false, warning: false },
  ];
  try {
    for (const scenario of cases) {
      warnings.length = 0;
      errors.length = 0;
      upstreamError = scenario.error;
      let received: unknown;
      const before = requests;
      await speechStudio.speak('駅', { lang: 'JA', onError: (error) => { received = error; } });
      expect(received).toBeInstanceOf(BusinessError);
      if (!(received instanceof BusinessError)) throw new Error('Expected a business error');
      expect(received.code).toBe(scenario.code);
      expect(received.retryable).toBe(scenario.retryable);
      expect(received.userMessage).toContain(scenario.hint);
      expect(received.userMessage).not.toContain('secret-upstream-value');
      expect(warnings).toEqual(scenario.warning ? [received.userMessage] : []);
      expect(errors).toEqual(scenario.warning ? [] : [received.userMessage]);
      expect(speechStudio.getIsSpeaking()).toBe(false);
      expect(speechStudio.getIsStreaming()).toBe(false);
      expect(requests - before).toBe(1); // No retry storm or silent provider switch.
    }
    // The non-stream route uses the same translation and keeps quota failures non-retryable.
    upstreamError = quotaError('GenerateRequestsPerDayPerProjectPerModel');
    const generated = await app.request('/api/tts-studio/tts/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: provider.id, text: '駅', voiceName: 'test-voice' }),
    });
    expect(generated.status).toBe(429);
    expect(await generated.json()).toMatchObject({ code: 'E_TTS_QUOTA', retryable: false });
    // Exercise the client's HTTP error branch as well as the SSE error path above.
    globalThis.fetch = Object.assign(async () => Response.json({ error: '额度已用尽', code: 'E_TTS_QUOTA', retryable: false }, { status: 429 }), { preconnect: originalFetch.preconnect });
    let httpError: unknown;
    try { await fetchTtsStream({ provider: provider.id, text: '駅', voiceName: 'test-voice' }); }
    catch (error) { httpError = error; }
    expect(httpError).toBeInstanceOf(TtsStreamError);
    expect(httpError).toMatchObject({ code: 'E_TTS_QUOTA', retryable: false });

    globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => app.fetch(input instanceof Request ? input : new Request(input, init)), { preconnect: originalFetch.preconnect });
    upstreamError = undefined;
    const result = await fetchTtsStream({ provider: provider.id, text: '駅', voiceName: 'test-voice' }, { onChunk: () => { chunks++; } });
    expect(chunks).toBe(1);
    expect([...result.chunks[0]!]).toEqual([1, 2, 3]);
    expect(result.mimeType).toBe('audio/wav');
  } finally {
    speechStudio.stop();
    globalThis.fetch = originalFetch;
  }
}, 30_000);
