import { describe, expect, it } from 'bun:test';
import { resolveKanaAudioUrl, kanaAudioUrl, hasKanaAudio } from '../kana-audio.js';

describe('kana-audio', () => {
  it('maps kana id to bundled file, missing id to null (fallback to live TTS)', () => {
    const manifest = { kana_a: 'kana_a.wav', kana_shi: 'kana_shi.wav' };
    expect(resolveKanaAudioUrl(manifest, '/audio/kana/', 'kana_a')).toBe('/audio/kana/kana_a.wav');
    expect(resolveKanaAudioUrl(manifest, '/audio/kana/', 'kana_shi')).toBe('/audio/kana/kana_shi.wav');
    expect(resolveKanaAudioUrl(manifest, '/audio/kana/', 'kana_unknown')).toBeNull();
    expect(resolveKanaAudioUrl({}, '/audio/kana/', 'kana_a')).toBeNull();
  });

  it('live manifest lookup never throws', () => {
    expect(() => kanaAudioUrl('kana_a')).not.toThrow();
    expect(typeof hasKanaAudio('kana_a')).toBe('boolean');
  });
});
