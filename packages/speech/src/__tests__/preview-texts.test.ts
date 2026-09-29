import { describe, expect, it } from 'bun:test';
import { previewTextForTrack, TTS_PREVIEW_TEXTS } from '../preview-texts.js';

describe('TTS preview texts (domain SSOT)', () => {
  it('covers every track with non-empty distinct copy', () => {
    const tracks = Object.keys(TTS_PREVIEW_TEXTS).sort();
    expect(tracks).toEqual(['en', 'ja', 'ko']);
    const texts = Object.values(TTS_PREVIEW_TEXTS);
    for (const text of texts) expect(text.trim().length).toBeGreaterThan(0);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('resolves per track', () => {
    expect(previewTextForTrack('ja')).toBe(TTS_PREVIEW_TEXTS.ja);
    expect(previewTextForTrack('en')).toBe(TTS_PREVIEW_TEXTS.en);
    expect(previewTextForTrack('ko')).toBe(TTS_PREVIEW_TEXTS.ko);
  });
});
