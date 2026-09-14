import type { SchemaMigration } from './types.js';

/** Schema v10 `term-examples` — 已发布，禁止改 version / name / sql。 */
export const migration: SchemaMigration = {
  version: 10,
  name: 'term-examples',
  sql: `
      CREATE TABLE IF NOT EXISTS term_examples (
        id TEXT PRIMARY KEY,
        language TEXT NOT NULL,
        term_key TEXT NOT NULL,
        headword TEXT NOT NULL,
        sentence TEXT NOT NULL,
        translation TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'ai',
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_term_examples_unique
        ON term_examples(language, term_key, sentence);
    `,
};
