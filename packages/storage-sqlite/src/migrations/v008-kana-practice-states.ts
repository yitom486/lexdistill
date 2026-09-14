import type { SchemaMigration } from './types.js';

/** Schema v8 `kana-practice-states` — 已发布，禁止改 version / name / sql。 */
export const migration: SchemaMigration = {
  version: 8,
  name: 'kana-practice-states',
  sql: `
      CREATE TABLE IF NOT EXISTS kana_practice_states (
        user_id TEXT NOT NULL,
        kana_id TEXT NOT NULL,
        script_type TEXT NOT NULL,
        fsrs_json TEXT NOT NULL,
        consecutive_errors INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, kana_id, script_type)
      );
      CREATE INDEX IF NOT EXISTS idx_kana_practice_states_user_script
        ON kana_practice_states(user_id, script_type, updated_at);
    `,
};
