import type { SchemaMigration } from './types.js';

/** Schema v4 `activity-alphabet-counts` — 已发布，禁止改 version / name / sql。 */
export const migration: SchemaMigration = {
  version: 4,
  name: 'activity-alphabet-counts',
  sql: `
      ALTER TABLE study_activity_logs ADD COLUMN kana_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE study_activity_logs ADD COLUMN hangul_count INTEGER NOT NULL DEFAULT 0;
    `,
};
