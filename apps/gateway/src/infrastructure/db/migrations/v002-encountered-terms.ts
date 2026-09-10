import type { SchemaMigration } from './types.js';

/** Schema v2 `encountered-terms` — 已发布，禁止改 version / name / sql。 */
export const migration: SchemaMigration = {
  version: 2,
  name: 'encountered-terms',
  sql: `
      CREATE TABLE IF NOT EXISTS encountered_terms (
        user_id TEXT NOT NULL,
        language TEXT NOT NULL,
        term_key TEXT NOT NULL,
        headword TEXT NOT NULL,
        reading TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        exposure_count INTEGER NOT NULL DEFAULT 1,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        flashcard_id TEXT,
        PRIMARY KEY (user_id, language, term_key)
      );
      CREATE TABLE IF NOT EXISTS term_occurrences (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        language TEXT NOT NULL,
        term_key TEXT NOT NULL,
        source TEXT NOT NULL,
        document_id TEXT,
        quote TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_term_occurrences_user_term
        ON term_occurrences(user_id, language, term_key, created_at);
      CREATE INDEX IF NOT EXISTS idx_encountered_terms_user_lang
        ON encountered_terms(user_id, language, last_seen_at);
    `,
};
