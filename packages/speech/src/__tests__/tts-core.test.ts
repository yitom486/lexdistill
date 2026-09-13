import { describe, expect, it } from 'bun:test';
import {
  __resetTtsEnginesForTest,
  AZURE_DEFAULT_VOICES,
  azureTtsEndpoint,
  azureTtsHeaders,
  azureVoicesEndpoint,
  bcp47ForTrack,
  buildAzureSsml,
  buildOpenAiSpeechPayload,
  mapAzureVoiceList,
  getActiveTtsEngine,
  isHttpEndpoint,
  listTtsEngines,
  normalizeTtsTrackLanguage,
  openAiSpeechHeaders,
  registerTtsEngine,
  resolveTtsSpeakRequest,
  scoreVoiceName,
  setActiveTtsEngine,
  StubTtsEngine,
  voiceNameHints,
  TTS_STYLE_PROMPTS,
} from '../index.js';

describe('tts track + request builder', () => {
  it('normalizes track variants and falls back to en', () => {
    expect(normalizeTtsTrackLanguage('ja')).toBe('ja');
    expect(normalizeTtsTrackLanguage('JP')).toBe('ja');
    expect(normalizeTtsTrackLanguage('kor')).toBe('ko');
    expect(normalizeTtsTrackLanguage('ENG')).toBe('en');
    expect(normalizeTtsTrackLanguage('xx')).toBe('en');
    expect(normalizeTtsTrackLanguage(undefined)).toBe('en');
    expect(bcp47ForTrack('ja')).toBe('ja-JP');
    expect(bcp47ForTrack('ko')).toBe('ko-KR');
    expect(bcp47ForTrack('en')).toBe('en-US');
  });

  it('resolves per-language prompt context with purpose-adjusted rate', () => {
    const ja = resolveTtsSpeakRequest({
      text: 'こんにちは',
      trackLanguage: 'ja',
      purpose: 'dictation',
      prefs: { gender: 'FEMALE', personaName: '七海' },
    });
    expect(ja.bcp47).toBe('ja-JP');
    expect(ja.rate).toBe(0.75);
    expect(ja.pitch).toBe(1.08);
    expect(ja.voiceMatchNames[0]).toBe('七海');
    expect(ja.voiceMatchNames).toContain('nanami');
    expect(ja.personaName).toBe('七海');
    expect(ja.neural.stylePrompt).toBe(TTS_STYLE_PROMPTS.ja);
    expect(ja.context).toEqual({ trackLanguage: 'ja', purpose: 'dictation', gender: 'FEMALE' });

    const ko = resolveTtsSpeakRequest({
      text: '안녕',
      trackLanguage: 'ko',
      prefs: { gender: 'MALE', rate: 2.5 },
    });
    expect(ko.rate).toBe(1.5);
    expect(ko.pitch).toBe(0.88);
    expect(ko.voiceMatchNames).toContain('injoon');

    const en = resolveTtsSpeakRequest({ text: 'hi', trackLanguage: 'en' });
    expect(en.context.gender).toBe('FEMALE');
    expect(en.rate).toBe(0.9);
  });

  it('honours explicit prefs and neural overrides', () => {
    const req = resolveTtsSpeakRequest({
      text: 'hi',
      trackLanguage: 'en',
      prefs: { gender: 'MALE', rate: 1.1, pitch: 0.9, preferredVoiceURI: 'uri-1', personaName: 'Guy' },
      neural: { voiceId: 'v-1', stylePrompt: 'custom' },
    });
    expect(req.rate).toBe(1.1);
    expect(req.pitch).toBe(0.9);
    expect(req.preferredVoiceURI).toBe('uri-1');
    expect(req.neural.voiceId).toBe('v-1');
    expect(req.neural.stylePrompt).toBe('custom');
  });
});

describe('voice matching', () => {
  it('ranks persona voices first per language and gender', () => {
    const jaFemale = [
      { name: 'Google US English', lang: 'en-US', localService: false },
      { name: 'Microsoft Nanami - Japanese', lang: 'ja-JP', localService: true },
    ];
    expect(voiceNameHints('ja', 'FEMALE')).toContain('nanami');
    const scored = jaFemale
      .map((v) => ({ v, s: scoreVoiceName(v, 'ja', 'FEMALE') }))
      .sort((a, b) => b.s - a.s);
    expect(scored[0]?.v.name).toContain('Nanami');
  });

  it('penalizes cloud default female names for male requests', () => {
    const jenny = scoreVoiceName({ name: 'Microsoft Jenny', localService: false }, 'en', 'MALE');
    const david = scoreVoiceName({ name: 'Microsoft David', localService: true }, 'en', 'MALE');
    expect(david).toBeGreaterThan(jenny);
  });
});

describe('engine registry + stub', () => {
  it('registers engines, selects active, rejects unknown', () => {
    __resetTtsEnginesForTest();
    try {
      const stub = new StubTtsEngine();
      registerTtsEngine(stub);
      expect(getActiveTtsEngine()?.id).toBe('stub');
      expect(listTtsEngines().map((e) => e.id)).toEqual(['stub']);
      expect(setActiveTtsEngine('missing')).toBe(false);
      expect(setActiveTtsEngine('stub')).toBe(true);
    } finally {
      __resetTtsEnginesForTest();
    }
  });

  it('stub records calls and resolves without speaking', async () => {
    __resetTtsEnginesForTest();
    try {
      const stub = new StubTtsEngine();
      registerTtsEngine(stub);
      const req = resolveTtsSpeakRequest({ text: 'hi', trackLanguage: 'en' });
      const res = await stub.speak(req);
      expect(stub.calls.length).toBe(1);
      expect(stub.calls[0]?.utteranceText).toBe('hi');
      if (res.ok) {
        await res.value.finished;
        res.value.stop();
        expect(stub.stoppedCount).toBe(1);
      } else {
        throw new Error('stub speak should not fail');
      }
    } finally {
      __resetTtsEnginesForTest();
    }
  });
});

describe('openai-compatible plugin endpoint', () => {
  it('builds speech payload with gender-default voice and bcp47', () => {
    const p = buildOpenAiSpeechPayload('あ', { bcp47: 'ja-JP', gender: 'FEMALE' });
    expect(p.input).toBe('あ');
    expect(p.model).toBe('tts-1');
    expect(p.voice).toBe('alloy');
    expect(p.language).toBe('ja-JP');
    const male = buildOpenAiSpeechPayload('あ', { gender: 'MALE', voice: 'onyx' });
    expect(male.voice).toBe('onyx');
    expect(male.language).toBeUndefined();
  });

  it('clamps speed into the OpenAI range', () => {
    expect(buildOpenAiSpeechPayload('hi', { speed: 99 }).speed).toBe(4);
    expect(buildOpenAiSpeechPayload('hi', { speed: -1 }).speed).toBe(0.25);
    expect(buildOpenAiSpeechPayload('hi').speed).toBeUndefined();
  });

  it('sends Authorization only when a key is set', () => {
    expect(openAiSpeechHeaders(' sk-123 ').Authorization).toBe('Bearer sk-123');
    expect(openAiSpeechHeaders('')).toEqual({ 'Content-Type': 'application/json' });
    expect(openAiSpeechHeaders()).toEqual({ 'Content-Type': 'application/json' });
  });

  it('only allows http/https endpoints', () => {
    expect(isHttpEndpoint('http://127.0.0.1:8880/v1/audio/speech')).toBe(true);
    expect(isHttpEndpoint('https://api.openai.com/v1/audio/speech')).toBe(true);
    expect(isHttpEndpoint('file:///etc/passwd')).toBe(false);
    expect(isHttpEndpoint('javascript:alert(1)')).toBe(false);
    expect(isHttpEndpoint('')).toBe(false);
  });
});

describe('azure speech helpers', () => {
  it('exposes per-track per-gender default neural voices', () => {
    expect(AZURE_DEFAULT_VOICES.ja.FEMALE).toBe('ja-JP-NanamiNeural');
    expect(AZURE_DEFAULT_VOICES.ja.MALE).toBe('ja-JP-KeitaNeural');
    expect(AZURE_DEFAULT_VOICES.ko.FEMALE).toBe('ko-KR-SunHiNeural');
    expect(AZURE_DEFAULT_VOICES.ko.MALE).toBe('ko-KR-InJoonNeural');
    expect(AZURE_DEFAULT_VOICES.en.FEMALE).toBe('en-US-JennyNeural');
    expect(AZURE_DEFAULT_VOICES.en.MALE).toBe('en-US-GuyNeural');
  });

  it('builds the regional REST endpoint', () => {
    expect(azureTtsEndpoint('japaneast')).toBe(
      'https://japaneast.tts.speech.microsoft.com/cognitiveservices/v1'
    );
    expect(azureTtsHeaders(' key123 ')['Ocp-Apim-Subscription-Key']).toBe('key123');
    expect(azureTtsHeaders('key123')['Content-Type']).toBe('application/ssml+xml');
  });

  it('builds SSML with escaped text and relative prosody', () => {
    const ssml = buildAzureSsml('あ & <お>', { trackLanguage: 'ja', rate: 0.75 });
    expect(ssml).toContain('ja-JP-NanamiNeural');
    expect(ssml).toContain('rate="-25%"');
    expect(ssml).toContain('あ &amp; &lt;お&gt;');
    expect(ssml).not.toContain('<お>');
    const faster = buildAzureSsml('hi', { trackLanguage: 'en', rate: 1.2 });
    expect(faster).toContain('rate="+20%"');
    // rate 恰为常速时不包 prosody（与自然语速逐字节一致，线上已验证）
    const natural = buildAzureSsml('hi', { trackLanguage: 'en', rate: 1.0 });
    expect(natural).not.toContain('prosody');
    const custom = buildAzureSsml('hi', { voice: 'en-US-GuyNeural' });
    expect(custom).toContain('en-US-GuyNeural');
    expect(custom).not.toContain('prosody');
  });

  it('adds an IPA hint for isolated hiragana わ', () => {
    const isolated = buildAzureSsml('わ', { trackLanguage: 'ja' });
    expect(isolated).toContain('<phoneme alphabet="ipa" ph="w a">わ</phoneme>');

    const contextual = buildAzureSsml('わを', { trackLanguage: 'ja' });
    expect(contextual).toContain('<voice name="ja-JP-NanamiNeural">わを</voice>');
    expect(contextual).not.toContain('phoneme');
  });

  it('keeps ordinary Japanese text unchanged', () => {
    const ssml = buildAzureSsml('こんにちは', { trackLanguage: 'ja' });
    expect(ssml).toContain('<voice name="ja-JP-NanamiNeural">こんにちは</voice>');
    expect(ssml).not.toContain('phoneme');
  });

  it('matches byte-for-byte the SSML verified against live Azure (japaneast)', () => {
    // 2026-09-06 实测：该 exact 请求经网关代理返回 10800 字节 audio/mpeg；
    // 无属性 <prosody> 空壳会被 Azure 回 400 空 body（已修，见下）。
    expect(buildAzureSsml('こんにちは', { trackLanguage: 'ja' })).toBe(
      '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ja-JP">' +
        '<voice name="ja-JP-NanamiNeural">こんにちは</voice></speak>'
    );
  });

  it('wraps style in the mstts namespace only when set', () => {
    const styled = buildAzureSsml('你好', {
      trackLanguage: 'ja',
      voice: 'ja-JP-NanamiNeural',
      style: 'cheerful',
    });
    expect(styled).toContain('xmlns:mstts="https://www.w3.org/2001/mstts"');
    expect(styled).toContain('<mstts:express-as style="cheerful">你好</mstts:express-as>');
    const plain = buildAzureSsml('你好', { trackLanguage: 'ja' });
    expect(plain).not.toContain('mstts');
    expect(plain).not.toContain('express-as');
  });

  it('maps the voices/list payload to dropdown options', () => {
    expect(azureVoicesEndpoint('japaneast')).toBe(
      'https://japaneast.tts.speech.microsoft.com/cognitiveservices/voices/list'
    );
    const options = mapAzureVoiceList(
      [
        {
          Name: 'Microsoft Server Speech Text to Speech Voice (ja-JP, NanamiNeural)',
          ShortName: 'ja-JP-NanamiNeural',
          Gender: 'Female',
          Locale: 'ja-JP',
          VoiceType: 'Neural',
          StyleList: ['chat', 'cheerful', 'customerservice'],
        },
        {
          ShortName: 'ja-JP-KeitaNeural',
          Gender: 'Male',
          Locale: 'ja-JP',
          VoiceType: 'Neural',
        },
        { ShortName: 'ko-KR-SunHiNeural', Gender: 'Female', VoiceType: 'Neural' },
        { ShortName: 'ja-JP-StandardA', Gender: 'Female', VoiceType: 'Standard' },
        { ShortName: 'broken' },
        null,
        'junk',
      ],
      'ja'
    );
    expect(options.map((o) => o.id)).toEqual(['ja-JP-KeitaNeural', 'ja-JP-NanamiNeural']);
    expect(options[1]?.label).toBe('Nanami（女）');
    expect(options[1]?.styles).toEqual(['chat', 'cheerful', 'customerservice']);
    expect(options[0]?.gender).toBe('MALE');
    expect(mapAzureVoiceList(null, 'ja')).toEqual([]);
  });
});
