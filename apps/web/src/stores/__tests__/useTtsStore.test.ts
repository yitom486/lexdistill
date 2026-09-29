import { describe, expect, it } from 'bun:test';
import { migrateTtsPreferences } from '../useTtsStore.js';

describe('TTS local preference migration', () => {
  it('keeps saved keys when moving to provider-indexed storage', () => {
    const migrated = migrateTtsPreferences({
      preferredService: 'gemini',
      geminiApiKey: 'saved-gemini-key',
      azureKey: 'saved-azure-key',
      localApiKey: 'saved-local-key',
      voiceId: 'saved-voice',
      gender: 'FEMALE',
    });
    expect(migrated.providerApiKeys).toEqual({
      gemini: 'saved-gemini-key',
      azure: 'saved-azure-key',
      local: 'saved-local-key',
    });
    expect(migrated.voiceId).toBe('saved-voice');
    expect(migrated).not.toHaveProperty('gender');
  });

  it('preserves newer provider keys and ignores invalid values', () => {
    const migrated = migrateTtsPreferences({
      providerApiKeys: { gemini: 'new-key', azure: 123 },
      geminiApiKey: 'old-key',
      azureKey: 'old-azure-key',
    });
    expect(migrated.providerApiKeys).toEqual({ gemini: 'new-key', azure: 'old-azure-key' });
  });

  it('preserves the selected model id across migration', () => {
    const migrated = migrateTtsPreferences({ preferredService: 'gemini', modelId: 'gemini-3.8-flash-tts', voiceId: 'Achernar' });
    expect(migrated.modelId).toBe('gemini-3.8-flash-tts');
    expect(migrated.voiceId).toBe('Achernar');
  });

  it('defaults invalid model id to empty string', () => {
    const migrated = migrateTtsPreferences({ modelId: 123 });
    expect(migrated.modelId).toBe('');
  });
});
