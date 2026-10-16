import { describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { initSchema, SqliteQuestionGenerationRepository } from '@lexdistill/storage-sqlite';
import { GenerationTaskService } from '../modules/question-generation/service.js';
import { buildQuickPracticePreset } from '../modules/question-generation/preset.js';
import { binding, config } from './question-generation.fixtures.js';

const AUDIO = { providerId: 'test', modelId: 'voice-model', maleVoice: 'm', femaleVoice: 'f', narratorVoice: 'm', speed: 1, timeoutMs: 1000 };

describe('P3 quick preset and task list', () => {
  it('builds an 8-item comprehensive blueprint that fits its frozen quotas', () => {
    const preset = buildQuickPracticePreset({ language: 'en', targetLevel: 'A1', modelId: 'test-model', audio: AUDIO });
    expect(preset.blueprint.totalItems).toBe(8);
    expect(preset.blueprint.categoryCounts.LISTENING).toBe(3);
    expect(preset.blueprint.listeningModes).toEqual({ DIALOGUE: 1, PASSAGE: 1, NEWS: 1 });
    expect(preset.config.maxQuestions).toBe(8);
    expect(preset.config.maxAudio).toBe(3);
    expect(preset.objective.length).toBeGreaterThan(0);
  });
  it('rejects language/level mismatch instead of guessing', () => {
    expect(() => buildQuickPracticePreset({ language: 'ja', targetLevel: 'A1', modelId: 'm', audio: AUDIO })).toThrow();
    expect(() => buildQuickPracticePreset({ language: 'ko', targetLevel: 'N5', modelId: 'm', audio: AUDIO })).toThrow();
  });
  it('lists owned task summaries for reopening', () => {
    const sqlite = new Database(':memory:');
    try {
      sqlite.run('PRAGMA foreign_keys=ON');
      initSchema(sqlite);
      const repository = new SqliteQuestionGenerationRepository(sqlite);
      const service = new GenerationTaskService({ repository });
      expect(service.listUserTasks(binding.userId)).toEqual([]);
      const preset = buildQuickPracticePreset({ language: 'en', targetLevel: 'A1', modelId: 'test-model', audio: AUDIO });
      const created = service.createTask({ userId: binding.userId, sessionId: binding.sessionId, turnId: binding.turnId,
        config: preset.config, blueprint: preset.blueprint, objective: preset.objective });
      const listed = service.listUserTasks(binding.userId);
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ taskId: created.taskId, status: 'ACTIVE', language: 'en', targetLevel: 'A1', isExpired: false });
      expect(service.listUserTasks('other')).toEqual([]);
      expect(config.language).toBe('en');
    } finally { sqlite.close(); }
  });
});
