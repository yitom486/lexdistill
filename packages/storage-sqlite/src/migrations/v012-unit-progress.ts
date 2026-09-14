import type { SchemaMigration } from './types.js';

/** Schema v12 `unit-progress` — 已发布，禁止改 version / name / sql。 */
export const migration: SchemaMigration = {
  version: 12,
  name: 'unit-progress',
  sql: `
      CREATE TABLE IF NOT EXISTS unit_progress (
        user_id TEXT NOT NULL,
        unit_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'mastered',
        evidence_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, unit_id)
      );
    `,
};
