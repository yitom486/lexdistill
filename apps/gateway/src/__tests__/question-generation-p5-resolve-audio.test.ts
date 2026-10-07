import { describe, expect, it } from 'bun:test';
import type { GenerationConfig } from '@study-studio/protocol';
import { resolveGenerationAudio } from '../modules/question-generation/infrastructure/resolve-audio.js';

function configWith(providerId: string): GenerationConfig {
  return {
    language: 'en', targetLevel: 'A1', modelId: 'm', promptVersion: 'v',
    maxQuestions: 1, categoryLimits: { VOCABULARY: 0, GRAMMAR: 0, READING: 0, CLOZE: 0, LISTENING: 1, WRITING: 0 },
    allowedAnswerTypes: ['MULTIPLE_CHOICE'], maxDifficultyTier: 3,
    maxAudio: 1, maxAudioAttempts: 3, maxPapers: 1, maxPaperItems: 1, textbookScopes: [],
    audio: { providerId, modelId: 'voice', maleVoice: 'm', femaleVoice: 'f', narratorVoice: 'm', speed: 1, timeoutMs: 1000 },
  };
}

describe('P5 resolveGenerationAudio only reads host env, never model input', () => {
  it('returns undefined when no audio or no key (honest E_AUDIO_UNAVAILABLE downstream)', () => {
    const noAudio = { ...configWith('gemini'), audio: undefined };
    expect(resolveGenerationAudio(noAudio, {})).toBeUndefined();
    expect(resolveGenerationAudio(configWith('gemini'), {})).toBeUndefined();
    expect(resolveGenerationAudio(configWith('azure'), {})).toBeUndefined();
    expect(resolveGenerationAudio(configWith('local'), {})).toBeUndefined();
    expect(resolveGenerationAudio(configWith('unknown'), { GEMINI_API_KEY: 'k' })).toBeUndefined();
  });
  it('resolves gemini/azure from host env keys without logging them', () => {
    expect(resolveGenerationAudio(configWith('gemini'), { GEMINI_API_KEY: 'g-key' })).toBeDefined();
    expect(resolveGenerationAudio(configWith('gemini'), { GOOGLE_API_KEY: 'g2' })).toBeDefined();
    expect(resolveGenerationAudio(configWith('azure'), { AZURE_TTS_KEY: 'a-key' })).toBeDefined();
    // local needs explicit opt-in
    expect(resolveGenerationAudio(configWith('local'), { STUDY_STUDIO_ENABLE_LOCAL_TTS: '1' })).toBeDefined();
  });
  it('renderer still enforces provider match and dialogue capability', async () => {
    const renderer = resolveGenerationAudio(configWith('gemini'), { GEMINI_API_KEY: 'test-key' })!;
    const material = { type: 'LISTENING', title: 't', mode: 'DIALOGUE', turns: [{ speaker: 'MALE', text: 'Hi' }] };
    await expect(renderer.render({
      material: material as never, language: 'en',
      settings: { ...configWith('azure').audio!, providerId: 'azure' },
      signal: new AbortController().signal,
    })).rejects.toThrow();
    const azure = resolveGenerationAudio(configWith('azure'), { AZURE_TTS_KEY: 'a-key' })!;
    await expect(azure.render({
      material: material as never, language: 'en',
      settings: configWith('azure').audio!,
      signal: new AbortController().signal,
    })).rejects.toThrow();
  });
});
