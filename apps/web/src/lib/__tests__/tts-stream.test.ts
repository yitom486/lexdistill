import { describe, expect, it } from 'bun:test';
import {
  buildTtsStreamBody,
  matchTtsRequest,
  parseSseLine,
  TtsStreamError,
  type TtsRequestDescriptor,
} from '../tts-stream.js';

describe('buildTtsStreamBody', () => {
  it('builds a gemini streaming request', () => {
    const body = buildTtsStreamBody({
      provider: 'gemini',
      text: 'hello',
      voiceName: 'Achernar',
      model: 'gemini-3.8-flash-tts',
      languageCode: 'en-US',
      speed: 0.9,
    });
    expect(body).toMatchObject({
      provider: 'gemini',
      text: 'hello',
      voiceName: 'Achernar',
      model: 'gemini-3.8-flash-tts',
      speed: 0.9,
    });
    // 前奏回归锁：请求体永远不带 speechMetadata。
    expect(body).not.toHaveProperty('speechMetadata');
  });

  it('rejects empty text, missing voice, and missing gemini model', () => {
    expect(() => buildTtsStreamBody({ provider: 'gemini', text: '  ', voiceName: 'V', model: 'M' }))
      .toThrow(TtsStreamError);
    expect(() => buildTtsStreamBody({ provider: 'gemini', text: 'hi', voiceName: '', model: 'M' }))
      .toThrow(TtsStreamError);
    expect(() => buildTtsStreamBody({ provider: 'gemini', text: 'hi', voiceName: 'V', model: '' }))
      .toThrow(TtsStreamError);
  });

  it('allows model-free requests for non-gemini providers', () => {
    const body = buildTtsStreamBody({ provider: 'azure', text: 'hi', voiceName: 'V', region: 'eastus' });
    expect(body.provider).toBe('azure');
    expect(body).not.toHaveProperty('model');
  });

  it('rejects out-of-range speed', () => {
    expect(() => buildTtsStreamBody({ provider: 'gemini', text: 'hi', voiceName: 'V', model: 'M', speed: 9 }))
      .toThrow(TtsStreamError);
  });
});

describe('parseSseLine', () => {
  it('parses audio, done, and error events', () => {
    expect(parseSseLine('data: {"audio":"aGk=","mimeType":"audio/wav"}')).toMatchObject({ audio: 'aGk=' });
    expect(parseSseLine('data: {"done":true,"mimeType":"audio/wav"}')).toMatchObject({ done: true });
    expect(parseSseLine('data: {"error":"boom","code":"E_X"}')).toMatchObject({ error: 'boom' });
  });

  it('ignores non-data lines', () => {
    expect(parseSseLine(': heartbeat')).toBeNull();
    expect(parseSseLine('')).toBeNull();
  });
});

const baseRequest: TtsRequestDescriptor = {
  text: 'hello',
  provider: 'gemini',
  voice: 'Achernar',
  voiceAuto: false,
  model: 'gemini-3.8-flash-tts',
  modelAuto: false,
  lang: 'en-US',
  rate: 0.9,
  purpose: 'preview',
};

describe('matchTtsRequest', () => {
  it('matches identical requests', () => {
    expect(matchTtsRequest(baseRequest, { ...baseRequest })).toBe(true);
  });

  it('rejects nulls and any changed scalar', () => {
    expect(matchTtsRequest(null, baseRequest)).toBe(false);
    expect(matchTtsRequest(baseRequest, null)).toBe(false);
    expect(matchTtsRequest(baseRequest, { ...baseRequest, text: 'other' })).toBe(false);
    expect(matchTtsRequest(baseRequest, { ...baseRequest, provider: 'azure' })).toBe(false);
    expect(matchTtsRequest(baseRequest, { ...baseRequest, lang: 'ja-JP' })).toBe(false);
    expect(matchTtsRequest(baseRequest, { ...baseRequest, rate: 1 })).toBe(false);
    expect(matchTtsRequest(baseRequest, { ...baseRequest, purpose: 'reading' })).toBe(false);
    expect(matchTtsRequest(baseRequest, { ...baseRequest, voice: 'Aoede' })).toBe(false);
    expect(matchTtsRequest(baseRequest, { ...baseRequest, model: 'other-model' })).toBe(false);
  });

  it('lets auto mode reuse the last auto resolution', () => {
    const auto = { ...baseRequest, voiceAuto: true, modelAuto: true };
    expect(matchTtsRequest(auto, { ...auto, voice: '', model: '' })).toBe(true);
  });

  it('replays when locked values equal the last auto resolution', () => {
    const auto = { ...baseRequest, voiceAuto: true, modelAuto: true };
    // 上次自动解析出 Achernar，本次显式锁定同一值：字节一致，直接重播。
    expect(matchTtsRequest(auto, { ...baseRequest, voiceAuto: false, modelAuto: false })).toBe(true);
    // 上次锁定、本次切回自动：自动结果可能已变化，失效并重新合成。
    expect(matchTtsRequest(baseRequest, { ...baseRequest, voice: '', voiceAuto: true, model: '', modelAuto: true })).toBe(false);
  });

  it('ignores model drift for non-gemini providers', () => {
    const azure = { ...baseRequest, provider: 'azure', model: '', modelAuto: true };
    expect(matchTtsRequest(azure, { ...azure, model: 'whatever' })).toBe(true);
  });
});
