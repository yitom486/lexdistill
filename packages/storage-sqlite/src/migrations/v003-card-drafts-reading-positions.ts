import type { SchemaMigration } from './types.js';

/** Schema v3 `card-drafts-reading-positions` — 已发布，禁止改 version / name / sql。 */
export const migration: SchemaMigration = {
  version: 3,
  name: 'card-drafts-reading-positions',
  sql: `
      CREATE TABLE IF NOT EXISTS card_drafts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        language TEXT NOT NULL,
        term_key TEXT NOT NULL,
        headword TEXT NOT NULL,
        reading TEXT,
        meanings_json TEXT NOT NULL,
        part_of_speech TEXT,
        source TEXT NOT NULL,
        source_ref TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        edited_fields_json TEXT NOT NULL DEFAULT '[]',
        flashcard_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_card_drafts_user_lang_status
        ON card_drafts(user_id, language, status, updated_at);
      CREATE TABLE IF NOT EXISTS reading_positions (
        user_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        locator TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, document_id)
      );
    `,
};
