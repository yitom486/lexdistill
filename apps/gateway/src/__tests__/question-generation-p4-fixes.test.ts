import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { Hono } from 'hono';
import { BusinessError, err } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import type { GatewayDeps } from '../composition/gateway-deps.js';
import { createGenerationRoutes } from '../modules/question-generation/http/generation-routes.js';
import { listPresets, resolvePreset } from '../modules/question-generation/presets.js';
import { suggestPreset } from '../modules/question-generation/suggest.js';

const audio = { providerId: 'test', modelId: 'voice', maleVoice: 'm', femaleVoice: 'f', narratorVoice: 'n', speed: 1, timeoutMs: 1000 };
const base = { presetId: 'comprehensive', language: 'en' as const, targetLevel: 'A1' as const, modelId: 'model', audio };
const repos: DrizzleLearnerRepository[] = [];
afterEach(() => { for (const repo of repos.splice(0)) repo.getRawDb().close(); });
function repository() {
  const repo = new DrizzleLearnerRepository(':memory:');
  repos.push(repo);
  return repo;
}
function appFor(repo: DrizzleLearnerRepository) {
  return new Hono().route('/', createGenerationRoutes({ repo } as unknown as GatewayDeps));
}

describe('P4 configuration regressions', () => {
  it('freezes comprehensive adjustments rather than reverting to the eight-item baseline', () => {
    const result = resolvePreset({ ...base, categoryCounts: { GRAMMAR: 3, LISTENING: 4 }, listeningModes: { DIALOGUE: 2 } });
    expect(result.blueprint).toMatchObject({ totalItems: 11, categoryCounts: { GRAMMAR: 3, LISTENING: 4 },
      listeningModes: { DIALOGUE: 2, PASSAGE: 1, NEWS: 1 } });
    expect(result.config).toMatchObject({ maxQuestions: 11, maxPaperItems: 11, maxAudio: 4, maxAudioAttempts: 12,
      categoryLimits: { GRAMMAR: 3, LISTENING: 4 } });
    expect(result.budgetNote).toEqual({ newQuestionsMax: 11, finalPaperItems: 11 });
    expect(result.objective).toContain('11');
    expect(result.objective).toContain('"GRAMMAR":3');
    expect(result.objective).not.toContain('各一');
  });

  it('retains listening-mode adjustments even when total questions stay unchanged', () => {
    expect(resolvePreset({ ...base, listeningModes: { DIALOGUE: 0, PASSAGE: 2 } }).blueprint.listeningModes)
      .toEqual({ DIALOGUE: 0, PASSAGE: 2, NEWS: 1 });
  });

  it('allows turning off listening without carrying stale modes or requiring voices', () => {
    const result = resolvePreset({ ...base, audio: undefined, categoryCounts: { LISTENING: 0 } });
    expect(result.blueprint.totalItems).toBe(5);
    expect(result.blueprint.listeningModes).toBeUndefined();
    expect(result.config.maxAudio).toBe(0);
    expect(result.config.audio).toBeUndefined();
    expect(() => resolvePreset({ ...base, categoryCounts: { LISTENING: 0 }, listeningModes: { DIALOGUE: 1 } })).toThrow();
  });

  it('rejects writing blueprints when the preset excludes writing answer formats', async () => {
    const app = appFor(repository());
    const response = await app.request('/api/generation/presets/resolve', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...base, presetId: 'vocab-grammar', categoryCounts: { WRITING: 1 } }) });
    expect(response.ok).toBe(false);
    expect(JSON.stringify(await response.json())).toContain('不允许写作');
  });

  it('isolates preset catalogue arrays from caller mutations', () => {
    const copy = listPresets();
    copy[0]!.allowedAnswerTypes.length = 0;
    copy[0]!.categoryCounts.GRAMMAR = 99;
    expect(listPresets()[0]!.allowedAnswerTypes).toEqual(['MULTIPLE_CHOICE', 'FILL_BLANK']);
    expect(listPresets()[0]!.categoryCounts.GRAMMAR).toBe(3);
  });

  it('uses the selected track for language, level and listening signals', () => {
    expect(suggestPreset({ requestedLanguage: 'en', profileLanguage: 'ja', textbookCount: 0,
      unresolvedMistakeSkillIds: ['ja.listening.basic'] }))
      .toMatchObject({ language: 'en', targetLevel: 'A1', languageBasis: 'user-selection', presetId: 'comprehensive' });
    expect(suggestPreset({ requestedLanguage: 'ko', profileLanguage: 'en', textbookCount: 0,
      unresolvedMistakeSkillIds: ['ko.listening.basic'] }))
      .toMatchObject({ language: 'ko', targetLevel: 'TOPIK_1', presetId: 'listening-focus' });
  });

  it('reads suggestions without creating missing profiles or language-profile rows', async () => {
    const repo = repository();
    const sqlite = repo.getRawDb();
    const before = sqlite.query('SELECT count(*) AS n FROM learner_profiles').get();
    const languagesBefore = sqlite.query('SELECT count(*) AS n FROM learner_language_profiles').get();
    const suggestion = await repo.suggestGenerationPreset('new-suggestion-reader');
    expect(suggestion).toMatchObject({ language: 'en', languageBasis: 'visible-default', targetLevel: 'A1' });
    expect(sqlite.query('SELECT count(*) AS n FROM learner_profiles').get()).toEqual(before);
    expect(sqlite.query('SELECT count(*) AS n FROM learner_language_profiles').get()).toEqual(languagesBefore);
  });

  it('serves an English suggestion for an English track without changing a Japanese profile', async () => {
    const repo = repository();
    await repo.updateLearnerProfile('ja-owner', { targetLanguage: 'ja' });
    const response = await appFor(repo).request('/api/generation/suggest/ja-owner?language=en');
    expect(response.ok).toBe(true);
    expect(await response.json()).toMatchObject({ language: 'en', targetLevel: 'A1', languageBasis: 'user-selection' });
    expect(repo.getRawDb().query('SELECT target_language AS language FROM learner_profiles WHERE user_id=?').get('ja-owner'))
      .toEqual({ language: 'ja' });
  });

  it('reports failed fact reads rather than claiming there are no listening mistakes', async () => {
    const repo = repository();
    const read = spyOn(repo, 'getMistakes').mockResolvedValue(err(new BusinessError('E_TEST_READ', '错题读取失败', 'DATABASE')));
    try {
      const response = await appFor(repo).request('/api/generation/suggest/read-error?language=en');
      expect(response.ok).toBe(false);
      expect(JSON.stringify(await response.json())).toContain('错题读取失败');
    } finally { read.mockRestore(); }
  });

  it('rejects unknown tracks instead of silently selecting a different language', async () => {
    const response = await appFor(repository()).request('/api/generation/suggest/owner?language=fr');
    expect(response.ok).toBe(false);
  });
});
