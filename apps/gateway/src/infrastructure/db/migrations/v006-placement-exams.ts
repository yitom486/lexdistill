import type { SchemaMigration } from './types.js';

/** Schema v6 `placement-exams` — 已发布，禁止改 version / name / sql。 */
export const migration: SchemaMigration = {
  version: 6,
  name: 'placement-exams',
  sql: `
      CREATE TABLE IF NOT EXISTS placement_exams (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        language TEXT NOT NULL,
        target_level TEXT NOT NULL,
        run_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        accuracy REAL,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_placement_user_lang
        ON placement_exams(user_id, language, created_at);
    `,
};
