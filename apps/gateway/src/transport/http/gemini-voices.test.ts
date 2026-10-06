import { describe, expect, it } from 'bun:test';
import type { TTSProvider, VoiceInfo } from 'gemini-tts-studio/server';
import {
  filterVerifiedGeminiVoices,
  normalizeGeminiVoiceName,
  VERIFIED_GEMINI_VOICES,
  withGeminiVoiceFilter,
} from './gemini-voices.js';

describe('gemini-voices filter & normalization', () => {
  it('normalizes case and handles fallback for invalid voices', () => {
    expect(normalizeGeminiVoiceName('aoede')).toBe('Aoede');
    expect(normalizeGeminiVoiceName('achernar')).toBe('Achernar');
    expect(normalizeGeminiVoiceName('puck')).toBe('Puck');
    expect(normalizeGeminiVoiceName('achird')).toBe('Puck');
    expect(normalizeGeminiVoiceName('ar-001-advisor-1')).toBe('Aoede');
    expect(normalizeGeminiVoiceName(undefined)).toBe('Aoede');
  });

  it('filters out unsupported experimental voices from remote response', () => {
    const raw: VoiceInfo[] = [
      { id: 'ar-001-advisor-1', name: 'Advisor 1', description: 'Arab Lawyer', kind: 'custom', provider: 'gemini' },
      { id: 'achernar', name: 'achernar', description: 'Remote Achernar', kind: 'prebuilt', provider: 'gemini' },
      { id: 'unknown_exp_voice', name: 'Unknown', description: 'Experimental', kind: 'prompted', provider: 'gemini' },
      { id: 'Aoede', name: 'Aoede', description: 'Remote Aoede', kind: 'prebuilt', provider: 'gemini' },
    ];
    const filtered = filterVerifiedGeminiVoices(raw);
    const ids = filtered.map((v) => v.id);

    // ar-001-advisor-1 and unknown_exp_voice must NOT be in the result
    expect(ids).not.toContain('ar-001-advisor-1');
    expect(ids).not.toContain('unknown_exp_voice');

    // Aoede and Achernar must be present with canonical PascalCase IDs
    expect(ids).toContain('Aoede');
    expect(ids).toContain('Achernar');
    expect(ids).not.toContain('achernar');

    // Aoede should be the first entry
    expect(filtered[0]?.id).toBe('Aoede');
  });

  it('wraps Gemini provider to filter voices and normalize synthesis params', async () => {
    let capturedParams: Record<string, unknown> | null = null;
    const fakeProvider: TTSProvider = {
      id: 'gemini',
      displayName: 'Google Gemini TTS',
      listModels: async () => ({ models: [], source: 'remote' }),
      listVoices: async () => [
        { id: 'ar-001-advisor-1', name: 'Advisor 1', description: 'Exp', provider: 'gemini' },
        { id: 'puck', name: 'puck', description: 'Puck male', provider: 'gemini' },
      ],
      synthesize: async (params) => {
        capturedParams = params as unknown as Record<string, unknown>;
        return { audioBuffer: Buffer.from([]), mimeType: 'audio/wav' };
      },
    };

    const wrapped = withGeminiVoiceFilter(fakeProvider);

    // Test listVoices
    const voices = await wrapped.listVoices('fake-key');
    expect(voices.some((v) => v.id === 'ar-001-advisor-1')).toBe(false);
    expect(voices.some((v) => v.id === 'Puck')).toBe(true);

    // Test synthesize parameter normalization
    await wrapped.synthesize({ text: 'こんにちは', voiceName: 'achernar' }, 'fake-key');
    expect(capturedParams).not.toBeNull();
    expect(capturedParams!['voiceName']).toBe('Achernar');

    await wrapped.synthesize({ text: 'こんにちは', voiceName: 'ar-001-advisor-1' }, 'fake-key');
    expect(capturedParams!['voiceName']).toBe('Aoede');
  });
});
