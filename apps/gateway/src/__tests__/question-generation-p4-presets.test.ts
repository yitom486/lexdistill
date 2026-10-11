import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { SqliteQuestionGenerationRepository } from '@study-studio/storage-sqlite';
import { GenerationTaskService } from '../modules/question-generation/service.js';
import { GenerationRunManager } from '../modules/question-generation/run-manager.js';
import { ToolRegistry } from '@study-studio/tool-core';
import { createGenerationRoutes } from '../modules/question-generation/http/generation-routes.js';
import type { GatewayDeps } from '../composition/gateway-deps.js';
import { listPresets, resolvePreset } from '../modules/question-generation/presets.js';
import { suggestPreset } from '../modules/question-generation/suggest.js';

const AUDIO = { providerId: 'test', modelId: 'voice-model', maleVoice: 'm', femaleVoice: 'f', narratorVoice: 'm', speed: 1, timeoutMs: 1000 };

describe('P4 presets resolve server-side with the same gates', () => {
  it('lists four versioned presets without claiming official exam blueprints', () => {
    const presets = listPresets();
    expect(presets.map(p => p.id).sort()).toEqual(['comprehensive', 'listening-focus', 'reading-cloze', 'vocab-grammar']);
    expect(new Set(presets.map(p => p.version))).toEqual(new Set(['v1']));
    expect(JSON.stringify(presets)).not.toMatch(/官方|真题|certified/i);
  });
  it('resolves budgets per language and rejects mismatched levels', () => {
    const resolved = resolvePreset({ presetId: 'listening-focus', language: 'ko', targetLevel: 'TOPIK_3', modelId: 'm', audio: AUDIO });
    expect(resolved.blueprint).toMatchObject({ totalItems: 4 });
    expect(resolved.budgetNote).toEqual({ newQuestionsMax: 4, finalPaperItems: 4 });
    expect(resolved.config.promptVersion).toBe('preset-listening-focus-v1');
    expect(() => resolvePreset({ presetId: 'listening-focus', language: 'en', targetLevel: 'N5', modelId: 'm', audio: AUDIO })).toThrow();
    expect(() => resolvePreset({ presetId: 'unknown', language: 'en', targetLevel: 'A1', modelId: 'm' })).toThrow();
  });
  it('validates user adjustments against quotas and exact listening sums', () => {
    expect(() => resolvePreset({ presetId: 'listening-focus', language: 'en', targetLevel: 'A1', modelId: 'm',
      audio: AUDIO, listeningModes: { DIALOGUE: 3 } })).toThrow();
    expect(() => resolvePreset({ presetId: 'vocab-grammar', language: 'en', targetLevel: 'A1', modelId: 'm',
      categoryCounts: { GRAMMAR: 200 } })).toThrow();
    const adjusted = resolvePreset({ presetId: 'vocab-grammar', language: 'en', targetLevel: 'A1', modelId: 'm',
      categoryCounts: { GRAMMAR: 4 } });
    expect(adjusted.blueprint.totalItems).toBe(7);
    expect(adjusted.budgetNote).toEqual({ newQuestionsMax: 7, finalPaperItems: 7 });
    // 无听力预设不需要语音配置。
    expect(adjusted.config.audio).toBeUndefined();
  });
  it('suggests only from verified facts with visible defaults', () => {
    expect(suggestPreset({ profileLanguage: 'ja', unresolvedMistakeSkillIds: ['ja.listening.basic'], textbookCount: 2 }))
      .toMatchObject({ language: 'ja', languageBasis: 'user-profile', targetLevel: 'N5', targetLevelBasis: 'visible-default',
        presetId: 'listening-focus', presetBasis: 'recent-mistakes' });
    expect(suggestPreset({ profileLanguage: null, unresolvedMistakeSkillIds: [], textbookCount: 0 }))
      .toMatchObject({ language: 'en', languageBasis: 'visible-default', presetId: 'comprehensive', presetBasis: 'visible-default' });
  });
  it('suggests listening focus from unresolved listening mistakes', async () => {
    const { createMistakeEntry } = await import('@study-studio/learner-core');
    const repo = new DrizzleLearnerRepository(':memory:');
    try {
      const userId = 'p4_mistakes';
      await repo.getLearnerProfile(userId);
      const mistake = createMistakeEntry(userId,
        { id: 'listen-mistake', type: 'MULTIPLE_CHOICE', prompt: 'Hear', content: 'Hear', correctAnswer: 'A',
          explanation: 'Listen.', testedSkillId: 'en.listening.basic', difficultyTier: 2 },
        'B', { questionId: 'listen-mistake', isCorrect: false, score: 0, correctAnswer: 'A',
          userSubmission: 'B', explanation: 'Listen.', mistakeRecorded: true });
      const saved = await repo.saveMistake(mistake);
      expect(saved.ok).toBe(true);
      const suggestion = await repo.suggestGenerationPreset(userId, 'en');
      expect(suggestion.presetId).toBe('listening-focus');
      expect(suggestion.presetBasis).toBe('recent-mistakes');
    } finally {
      repo.getRawDb().close();
    }
  });
  it('serves presets, resolve and suggest over HTTP with ownership', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    try {
      const userId = 'p4_owner';
      await repo.getLearnerProfile(userId);
      const bank = new SqliteQuestionGenerationRepository(repo.getRawDb());
      const service = new GenerationTaskService({ repository: bank });
      const runs = new GenerationRunManager({ service, repository: bank,
        resolveRunAdapter: () => { throw new Error('no model in preset test'); },
        toolRegistry: new ToolRegistry() });
      const app = new Hono().route('/', createGenerationRoutes({ repo, generation: { service, runs } } as unknown as GatewayDeps));
      expect((await (await app.request('/api/generation/presets')).json() as unknown[])).toHaveLength(4);
      const resolved = await (await app.request('/api/generation/presets/resolve', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presetId: 'reading-cloze', language: 'en', targetLevel: 'B1', modelId: 'm' }) })).json() as { blueprint: { totalItems: number } };
      expect(resolved.blueprint.totalItems).toBe(5);
      const bad = await app.request('/api/generation/presets/resolve', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presetId: 'listening-focus', language: 'en', targetLevel: 'A1', modelId: 'm',
          audio: { providerId: 'test', modelId: 'v', maleVoice: 'm', femaleVoice: 'f', narratorVoice: 'm', speed: 1, timeoutMs: 1000 },
          listeningModes: { DIALOGUE: 3 } }) });
      expect(bad.status).not.toBe(200);
      expect(JSON.stringify(await bad.json())).toContain('Listening mode counts');
      const suggestion = await (await app.request(`/api/generation/suggest/${userId}?language=en`)).json() as { presetId: string; presetBasis: string };
      expect(suggestion.presetId).toBe('comprehensive');
      expect(suggestion.presetBasis).toBe('visible-default');
      const foreign = await app.request('/api/generation/suggest/other');
      expect(foreign.status).toBe(200);
    } finally {
      repo.getRawDb().close();
    }
  });
});
