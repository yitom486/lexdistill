import { Database } from 'bun:sqlite';
import { initSchema, SqliteQuestionGenerationRepository } from '@lexdistill/storage-sqlite';
import type { BankQuestionDraft, GenerationBinding, GenerationConfig } from '@lexdistill/protocol';
import { createQuestionGenerationTools, type GenerationAudioRenderer } from '../modules/question-generation/public.js';

export const binding: GenerationBinding = { taskId: 'generation_test', userId: 'generator_user', sessionId: 'session', turnId: 'turn' };
export const config: GenerationConfig = { language: 'en', targetLevel: 'A1', modelId: 'configured-model', promptVersion: 'v1',
  maxQuestions: 20, maxDifficultyTier: 3, maxAudio: 10, maxAudioAttempts: 20, maxPapers: 1, maxPaperItems: 20,
  categoryLimits: { VOCABULARY: 10, GRAMMAR: 10, READING: 10, CLOZE: 10, LISTENING: 10, WRITING: 10 },
  allowedAnswerTypes: ['MULTIPLE_CHOICE', 'FILL_BLANK', 'REORDER', 'SHORT_ANSWER', 'TRANSLATION', 'WRITING'], textbookScopes: [],
  audio: { providerId: 'test', modelId: 'voice-model', maleVoice: 'configured-male', femaleVoice: 'configured-female', narratorVoice: 'configured-narrator', speed: 1, timeoutMs: 1000 } };
export const question = (patch: Partial<BankQuestionDraft> = {}): BankQuestionDraft => ({
  category: 'GRAMMAR', targetLevel: 'A1', difficultyTier: 1, difficultyReason: 'Simple present tense with familiar everyday words.',
  prompt: 'She ___ a student.', explanation: 'Use is with she.', skillIds: ['en.grammar.present'], citations: [],
  answer: { type: 'MULTIPLE_CHOICE', options: [{ key: 'A', text: 'is' }, { key: 'B', text: 'are' }], correctKey: 'A' }, ...patch,
});
export const listening = (mode: 'DIALOGUE' | 'PASSAGE' | 'NEWS' = 'DIALOGUE') => question({ category: 'LISTENING', prompt: `What do you hear? ${mode}`,
  answer: { type: 'SHORT_ANSWER', referenceAnswer: 'Hello.', rubric: 'Recognizes the greeting.' },
  material: { type: 'LISTENING', title: `Greeting ${mode}`, mode,
    turns: mode === 'DIALOGUE' ? [{ speaker: 'MALE', text: 'Hello.' }, { speaker: 'FEMALE', text: 'Good morning.' }] : [{ speaker: 'NARRATOR', text: 'Hello.' }],
    ...(mode === 'NEWS' ? { news: { kind: 'SIMULATED' as const } } : {}) } });
export const sixFormats = (): BankQuestionDraft[] => [question(),
  question({ category: 'CLOZE', prompt: 'Fill the blank.', material: { type: 'READING', title: 'School', text: 'She ___ a student.' }, answer: { type: 'FILL_BLANK', acceptedAnswers: ['is'] } }),
  question({ category: 'READING', prompt: 'Put the sentence in order.', material: { type: 'READING', title: 'School', text: 'She is a student.' }, answer: { type: 'REORDER', chunks: ['She', 'is', 'a student.'], correctOrder: [0, 1, 2] } }),
  listening(),
  question({ category: 'VOCABULARY', prompt: 'Translate hello.', answer: { type: 'TRANSLATION', referenceAnswer: 'hello', rubric: 'Correct greeting.', targetLanguage: 'en' } }),
  question({ category: 'WRITING', prompt: 'Introduce yourself.', answer: { type: 'WRITING', sampleAnswer: 'I am a student.', rubric: 'Clear simple sentences.', minWords: 3, maxWords: 30 } }),
];
export function fixture(overrides: Partial<GenerationConfig> = {}, audio?: GenerationAudioRenderer, prepare?: (sqlite: Database) => void) {
  const sqlite = new Database(':memory:');
  sqlite.run('PRAGMA foreign_keys=ON');
  initSchema(sqlite);
  prepare?.(sqlite);
  const repository = new SqliteQuestionGenerationRepository(sqlite);
  const expiresAt = new Date(Date.now() + 60000).toISOString();
  const tools = createQuestionGenerationTools({ repository, audio: audio ?? { async render() { return { bytes: new Uint8Array([1, 2, 3, 4]), mimeType: 'audio/wav' }; } } }, binding, { ...structuredClone(config), ...overrides }, expiresAt);
  const invoke = (name: string, input: unknown, context = binding) => tools.registry.execute(name, input, context);
  return { sqlite, repository, tools, invoke, expiresAt };
}
