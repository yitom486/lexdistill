import type { SchemaMigration } from './types.js';

/** Schema v15 `document-structure` — 已发布，禁止改 version / name / sql。 */
export const migration: SchemaMigration = {
  version: 15,
  name: 'document-structure',
  sql: `
      CREATE TABLE IF NOT EXISTS document_structure (
        document_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        headings_json TEXT NOT NULL DEFAULT '[]',
        classes_json TEXT NOT NULL DEFAULT '[]',
        model TEXT NOT NULL DEFAULT '',
        effort TEXT NOT NULL DEFAULT '',
        dropped INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
    `,
};
