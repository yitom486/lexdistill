import type { SchemaMigration } from './types.js';

/**
 * Schema v28 `ai-artifact-runs`（P4-1）。
 * AI 批改／生成运行审计：只插不改；读口另批。
 */
export const migration: SchemaMigration = {
  version: 28,
  name: 'ai-artifact-runs',
  sql: `
      CREATE TABLE IF NOT EXISTS ai_artifact_runs (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        input_snapshot_hash TEXT NOT NULL,
        adapter TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_version TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        status TEXT NOT NULL,
        error_code TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_ai_artifact_action_time
        ON ai_artifact_runs(action, created_at);
    `,
};
