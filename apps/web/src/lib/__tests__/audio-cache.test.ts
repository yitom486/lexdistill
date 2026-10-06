import { describe, expect, it, beforeEach } from 'bun:test';
import {
  buildAudioCacheKey,
  saveAudioCache,
  getAudioCache,
  deleteAudioCache,
  clearAllAudioCache,
  listAudioCache,
  getAudioCacheStats,
} from '../audio-cache.js';

describe('Audio Cache System (IndexedDB / Memory fallback)', () => {
  beforeEach(async () => {
    await clearAllAudioCache();
  });

  it('buildAudioCacheKey generates normalized deterministic keys', () => {
    const key1 = buildAudioCacheKey({
      text: ' Hello World  ',
      provider: 'Gemini',
      voice: 'Kore',
      model: 'gemini-2.5-flash',
      rate: 1.0,
      lang: 'en-US',
      purpose: 'preview',
    });

    const key2 = buildAudioCacheKey({
      text: 'hello world',
      provider: 'gemini',
      voice: 'kore',
      model: 'gemini-2.5-flash',
      rate: 1,
      lang: 'EN-US',
      purpose: 'PREVIEW',
    });

    expect(key1).toBe(key2);
  });

  it('saves, retrieves, and lists audio caches', async () => {
    const blob1 = new Blob(['mock audio binary 1'], { type: 'audio/wav' });
    const key1 = buildAudioCacheKey({
      text: 'Test phrase 1',
      provider: 'gemini',
      voice: 'kore',
    });

    await saveAudioCache({
      id: key1,
      text: 'Test phrase 1',
      provider: 'gemini',
      voice: 'kore',
      model: '',
      rate: 1.0,
      lang: 'en',
      purpose: '',
      mimeType: 'audio/wav',
      sizeBytes: blob1.size,
      blob: blob1,
    });

    const fetched = await getAudioCache(key1);
    expect(fetched).not.toBeNull();
    expect(fetched?.text).toBe('Test phrase 1');
    expect(fetched?.sizeBytes).toBe(blob1.size);

    const list = await listAudioCache();
    expect(list.length).toBe(1);
    expect(list[0]?.id).toBe(key1);

    const stats = await getAudioCacheStats();
    expect(stats.count).toBe(1);
    expect(stats.totalBytes).toBe(blob1.size);
  });

  it('supports single deletion and clear all', async () => {
    const blob1 = new Blob(['mock audio 1'], { type: 'audio/wav' });
    const blob2 = new Blob(['mock audio 2'], { type: 'audio/wav' });

    const key1 = 'key-1';
    const key2 = 'key-2';

    await saveAudioCache({
      id: key1,
      text: 'text 1',
      provider: 'gemini',
      voice: 'kore',
      model: '',
      rate: 1.0,
      lang: '',
      purpose: '',
      mimeType: 'audio/wav',
      sizeBytes: blob1.size,
      blob: blob1,
    });

    await saveAudioCache({
      id: key2,
      text: 'text 2',
      provider: 'gemini',
      voice: 'fenrir',
      model: '',
      rate: 1.0,
      lang: '',
      purpose: '',
      mimeType: 'audio/wav',
      sizeBytes: blob2.size,
      blob: blob2,
    });

    let stats = await getAudioCacheStats();
    expect(stats.count).toBe(2);

    // Single delete
    await deleteAudioCache(key1);
    expect(await getAudioCache(key1)).toBeNull();
    expect(await getAudioCache(key2)).not.toBeNull();

    stats = await getAudioCacheStats();
    expect(stats.count).toBe(1);

    // Clear all
    await clearAllAudioCache();
    expect(await getAudioCache(key2)).toBeNull();
    stats = await getAudioCacheStats();
    expect(stats.count).toBe(0);
    expect(stats.totalBytes).toBe(0);
  });
});
