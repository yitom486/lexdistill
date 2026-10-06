import { describe, expect, it } from 'bun:test';
import { LocalTTSError, type TTSProvider } from 'gemini-tts-studio/server';
import { withTtsErrorMessages } from './tts-errors.js';

describe('withTtsErrorMessages', () => {
  const dummyProvider: TTSProvider = {
    id: 'test',
    displayName: 'Test Provider',
    resolveApiKey: () => 'key',
    listModels: async () => ({ models: [], source: 'remote' }),
    listVoices: async () => [],
    synthesize: async () => ({ audioBuffer: Buffer.from([]), mimeType: 'audio/wav' }),
  };

  it('translates quota exhaustion to E_TTS_QUOTA', async () => {
    const wrapped = withTtsErrorMessages({
      ...dummyProvider,
      synthesize: async () => {
        throw new Error('429 RESOURCE_EXHAUSTED: monthly quota exceeded');
      },
    });
    try {
      await wrapped.synthesize({ text: 'test' } as any, 'key');
      expect.unreachable();
    } catch (err) {
      expect(err instanceof LocalTTSError).toBe(true);
      const e = err as LocalTTSError;
      expect(e.code).toBe('E_TTS_QUOTA');
    }
  });

  it('translates 401 unauthorized to E_TTS_AUTH', async () => {
    const wrapped = withTtsErrorMessages({
      ...dummyProvider,
      synthesize: async () => {
        throw new Error('HTTP 401 Unauthorized API key');
      },
    });
    try {
      await wrapped.synthesize({ text: 'test' } as any, 'key');
      expect.unreachable();
    } catch (err) {
      expect(err instanceof LocalTTSError).toBe(true);
      const e = err as LocalTTSError;
      expect(e.code).toBe('E_TTS_AUTH');
    }
  });

  it('translates unknown upstream failures to E_TTS_UPSTREAM without leaking raw details to user', async () => {
    const wrapped = withTtsErrorMessages({
      ...dummyProvider,
      synthesize: async () => {
        throw new Error('400 Invalid voiceName achernar?key=AIzaSySecretApiKey123');
      },
    });
    try {
      await wrapped.synthesize({ text: 'test' } as any, 'key');
      expect.unreachable();
    } catch (err) {
      expect(err instanceof LocalTTSError).toBe(true);
      const e = err as LocalTTSError;
      expect(e.code).toBe('E_TTS_UPSTREAM');
      expect(e.message).toBe('语音服务暂时无法生成音频，请稍后再试。');
    }
  });
});
