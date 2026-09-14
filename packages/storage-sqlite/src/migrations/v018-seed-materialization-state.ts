import type { SchemaMigration } from './types.js';

/** Schema v18 `seed-materialization-state` — 已发布，禁止改 version / name / sql。 */
export const migration: SchemaMigration = {
  version: 18,
  name: 'seed-materialization-state',
  sql: `
      CREATE TABLE IF NOT EXISTS seed_materialization (
        document_id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        materializer_version INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
};
