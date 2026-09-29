import { describe, expect, it } from 'bun:test';
import {
  ensureTtsEngines,
  getActiveTtsEngine,
  setActiveTtsEngine,
  studioTtsEngine,
} from '../tts-engines.js';

describe('tts engine registration', () => {
  it('registers the package-backed engine as default (idempotent)', () => {
    ensureTtsEngines();
    ensureTtsEngines();
    expect(getActiveTtsEngine()?.id).toBe('gemini-tts-studio');
    expect(studioTtsEngine.id).toBe('gemini-tts-studio');
    expect(setActiveTtsEngine('missing-engine')).toBe(false);
    expect(setActiveTtsEngine('gemini-tts-studio')).toBe(true);
  });
});
