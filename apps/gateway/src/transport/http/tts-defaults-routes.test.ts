import { describe, expect, it } from 'bun:test';
import { TTS_PREVIEW_TEXTS } from '@lexdistill/speech';
import { createTtsDefaultsRoutes } from './tts-defaults-routes.js';

describe('GET /api/tts-studio/defaults', () => {
  it('serves the registry default provider and domain preview texts', async () => {
    const res = await createTtsDefaultsRoutes().request('/api/tts-studio/defaults');
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    if (!body || typeof body !== 'object') throw new Error('defaults body must be an object');
    const record = body as Record<string, unknown>;
    expect(typeof record['defaultProvider']).toBe('string');
    expect((record['defaultProvider'] as string).length).toBeGreaterThan(0);
    expect(record['previewTexts']).toEqual(TTS_PREVIEW_TEXTS);
  });
});
