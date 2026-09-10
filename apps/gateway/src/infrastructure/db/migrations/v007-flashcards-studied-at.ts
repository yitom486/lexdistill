import type { SchemaMigration } from './types.js';

/** Schema v7 `flashcards-studied-at` — 已发布，禁止改 version / name / sql。 */
export const migration: SchemaMigration = {
  version: 7,
  name: 'flashcards-studied-at',
  sql: `
      ALTER TABLE flashcards ADD COLUMN studied_at TEXT;
    `,
};
