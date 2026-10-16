import { afterEach, describe, expect, it } from 'bun:test';
import { isOk } from '@lexdistill/shared';
import type { BankSubmitReceipt } from '@lexdistill/protocol';
import type { TTSGenerateRequest, TTSProvider } from 'gemini-tts-studio/server';
import { createGenerationTtsRenderer } from '../modules/question-generation/public.js';
import { binding, config, fixture, listening } from './question-generation.fixtures.js';

describe('generation listening audio ownership and resource lifecycle', () => {
  let f: ReturnType<typeof fixture>;
  afterEach(async () => { await f.tools.dispose(); f.sqlite.close(); });
  async function save(mode: 'DIALOGUE' | 'PASSAGE' | 'NEWS' = 'DIALOGUE') {
    const res = await f.invoke('generation.submit', { requestKey: mode, questions: [listening(mode)] });
    if (!isOk(res)) throw res.error;
    return (res.value as BankSubmitReceipt).materialIds[0]!;
  }
  it('passes configured male/female voices for dialogue and narrator for passage/news without exposing credentials', async () => {
    const calls: TTSGenerateRequest[] = [];
    const provider: TTSProvider = { id: 'test', displayName: 'Test', async listModels() { return { models: [], source: 'remote' }; }, async listVoices() { return []; },
      async synthesize(params, apiKey, context) { expect(apiKey).toBe('test-only-secret'); expect(context?.signal).toBeDefined(); calls.push(params); return { audioBuffer: Buffer.from([1, 2, 3]), mimeType: 'audio/wav' }; } };
    f = fixture({}, createGenerationTtsRenderer(provider, 'test-only-secret', { supportsDialogue: true }));
    for (const mode of ['DIALOGUE', 'PASSAGE', 'NEWS'] as const) {
      const result = await f.invoke('generation.audio', { materialId: await save(mode) });
      expect(isOk(result)).toBe(true); expect(JSON.stringify(result)).not.toContain('test-only-secret');
    }
    expect(calls[0]!.speakers).toEqual([{ speaker: 'MALE', voiceName: 'configured-male' }, { speaker: 'FEMALE', voiceName: 'configured-female' }]);
    expect(calls[0]!.text).toBe('MALE: Hello.\nFEMALE: Good morning.');
    for (const c of calls.slice(1)) { expect(c.voiceName).toBe('configured-narrator'); expect(c.speakers).toBeUndefined(); }
    expect(calls.every(c => c.model === 'voice-model' && c.speed === 1 && c.languageCode === 'en-US')).toBe(true);
  });
  it('reuses ready audio and reserves quota before concurrent calls', async () => {
    let resolve!: (value: { bytes: Uint8Array; mimeType: string }) => void;
    let started!: () => void;
    const entered = new Promise<void>(r => { started = r; });
    let calls = 0;
    f = fixture({ maxAudio: 1 }, { render() { calls++; started(); return new Promise(r => { resolve = r; }); } });
    const materialId = await save();
    const running = f.invoke('generation.audio', { materialId }); await entered;
    expect(isOk(await f.invoke('generation.audio', { materialId }))).toBe(false);
    expect(isOk(await f.invoke('generation.audio', { materialId: await save('PASSAGE') }))).toBe(false);
    resolve({ bytes: new Uint8Array([1]), mimeType: 'audio/wav' });
    expect(isOk(await running)).toBe(true);
    expect(isOk(await f.invoke('generation.audio', { materialId }))).toBe(true); expect(calls).toBe(1);
  });
  it('releases failed claims and permits a retry without falsely marking audio ready', async () => {
    let fail = true;
    f = fixture({ maxAudio: 1 }, { async render() { if (fail) throw new Error('Simulated provider failure'); return { bytes: new Uint8Array([1]), mimeType: 'audio/wav' }; } });
    const materialId = await save();
    expect(isOk(await f.invoke('generation.audio', { materialId }))).toBe(false);
    expect(f.repository.config(binding).usedAudio).toBe(0);
    fail = false;
    expect(isOk(await f.invoke('generation.audio', { materialId }))).toBe(true);
  });
  it('rejects invalid provider bytes and MIME types and restores the audio reservation', async () => {
    f = fixture({}, { async render() { return { bytes: new Uint8Array(), mimeType: 'application/json' }; } });
    expect(isOk(await f.invoke('generation.audio', { materialId: await save() }))).toBe(false);
    expect(f.repository.config(binding).usedAudio).toBe(0);
  });
  it('counts failed synthesis attempts against the fixed service-call quota', async () => {
    let calls = 0;
    f = fixture({ maxAudio: 1, maxAudioAttempts: 1 }, { async render() { calls++; throw new Error('Provider failed'); } });
    const materialId = await save();
    expect(isOk(await f.invoke('generation.audio', { materialId }))).toBe(false);
    expect(isOk(await f.invoke('generation.audio', { materialId }))).toBe(false);
    expect(f.repository.config(binding).usedAudioAttempts).toBe(1); expect(calls).toBe(1);
  });
  it('cancels the actual provider call, waits for cleanup and closes the task', async () => {
    let entered!: () => void;
    const started = new Promise<void>(r => { entered = r; });
    let aborted = false;
    f = fixture({}, { render({ signal }) { entered(); return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true })); } });
    const running = f.invoke('generation.audio', { materialId: await save() }); await started;
    expect(() => f.repository.finishTask(binding, 'COMPLETED')).toThrow();
    await f.tools.dispose();
    expect(isOk(await running)).toBe(false); expect(aborted).toBe(true);
    expect(f.sqlite.query('SELECT status FROM generation_tasks WHERE id=?').get(binding.taskId)).toEqual({ status: 'CANCELLED' });
    expect(f.sqlite.query('SELECT count(*) AS n FROM bank_audio_assets').get()).toEqual({ n: 0 });
    expect(isOk(await f.invoke('generation.config', {}))).toBe(false);
  });
  it('times out through AbortSignal and prevents a late successful write', async () => {
    f = fixture({ audio: { ...config.audio!, timeoutMs: 100 } }, { render({ signal }) { return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); } });
    expect(isOk(await f.invoke('generation.audio', { materialId: await save() }))).toBe(false);
    expect(f.repository.config(binding).usedAudio).toBe(0);
  });
  it('rejects provider mismatch and foreign materials before audio persistence', async () => {
    f = fixture();
    expect(isOk(await f.invoke('generation.audio', { materialId: 'foreign' }))).toBe(false);
    const renderer = createGenerationTtsRenderer({ id: 'wrong' } as TTSProvider, '');
    const q = listening();
    if (q.material?.type !== 'LISTENING') throw new Error('fixture');
    await expect(renderer.render({ material: q.material, language: 'en', settings: config.audio!, signal: new AbortController().signal })).rejects.toThrow();
  });
  it('does not expose upstream credentials in provider failure results', async () => {
    const provider: TTSProvider = { id: 'test', displayName: 'Test', async listModels() { return { models: [], source: 'remote' }; }, async listVoices() { return []; },
      async synthesize() { throw new Error('request header: test-only-secret'); } };
    f = fixture({}, createGenerationTtsRenderer(provider, 'test-only-secret', { supportsDialogue: true }));
    const result = await f.invoke('generation.audio', { materialId: await save() });
    expect(isOk(result)).toBe(false); expect(JSON.stringify(result)).not.toContain('test-only-secret');
  });
  it('preserves the codec and sample-rate parameters returned by Gemini PCM audio', async () => {
    f = fixture({}, { async render() { return { bytes: new Uint8Array([1, 2, 3, 4]), mimeType: 'audio/L16;codec=pcm;rate=24000' }; } });
    const materialId = await save();
    expect(isOk(await f.invoke('generation.audio', { materialId }))).toBe(true);
    expect(f.repository.readAudio(binding.userId, binding.taskId, materialId).mimeType).toBe('audio/l16;codec=pcm;rate=24000');
  });
  it('rejects a single-voice-only provider for dialogue before calling it', async () => {
    let calls = 0;
    const provider: TTSProvider = { id: 'local', displayName: 'Test', async listModels() { return { models: [], source: 'remote' }; }, async listVoices() { return []; },
      async synthesize() { calls++; return { audioBuffer: Buffer.from([1]), mimeType: 'audio/wav' }; } };
    f = fixture({ audio: { ...config.audio!, providerId: 'local' } }, createGenerationTtsRenderer(provider, ''));
    expect(isOk(await f.invoke('generation.audio', { materialId: await save() }))).toBe(false);
    expect(calls).toBe(0);
  });
  it('prevents embedded newlines in dialogue content from inventing speaker roles', async () => {
    f = fixture();
    let rendered = '';
    const provider: TTSProvider = { id: 'gemini', displayName: 'Test', async listModels() { return { models: [], source: 'remote' }; }, async listVoices() { return []; },
      async synthesize(params) { rendered = params.text; return { audioBuffer: Buffer.from([1]), mimeType: 'audio/wav' }; } };
    const q = listening();
    if (q.material?.type !== 'LISTENING') throw new Error('fixture');
    q.material.turns[0]!.text = 'Hello.\nNARRATOR: embedded content';
    await createGenerationTtsRenderer(provider, '').render({ material: q.material, language: 'en', settings: { ...config.audio!, providerId: 'gemini' }, signal: new AbortController().signal });
    expect(rendered.split('\n')).toEqual(['MALE: Hello. NARRATOR: embedded content', 'FEMALE: Good morning.']);
  });
});
