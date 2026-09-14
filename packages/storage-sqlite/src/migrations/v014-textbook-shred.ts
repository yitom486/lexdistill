import type { SchemaMigration } from './types.js';

/** Schema v14 `textbook-shred` — 已发布，禁止改 version / name / sql。 */
export const migration: SchemaMigration = {
  version: 14,
  name: 'textbook-shred',
  sql: `
      CREATE TABLE IF NOT EXISTS textbook_lessons (
        document_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        lesson_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        PRIMARY KEY (document_id, lesson_id)
      );
      CREATE TABLE IF NOT EXISTS textbook_vocab (
        document_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        ord INTEGER NOT NULL,
        surface TEXT NOT NULL,
        reading TEXT,
        pos TEXT,
        gloss_zh TEXT,
        pitch TEXT,
        example_ja TEXT,
        example_zh TEXT,
        PRIMARY KEY (document_id, lesson_id, ord)
      );
      CREATE INDEX IF NOT EXISTS idx_textbook_vocab_surface
        ON textbook_vocab(document_id, surface);
      CREATE TABLE IF NOT EXISTS textbook_grammar (
        document_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        ord INTEGER NOT NULL,
        title TEXT NOT NULL,
        connection TEXT,
        explanation TEXT,
        PRIMARY KEY (document_id, lesson_id, ord)
      );
      CREATE TABLE IF NOT EXISTS textbook_lines (
        document_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        ord INTEGER NOT NULL,
        speaker TEXT,
        ja TEXT NOT NULL,
        zh TEXT,
        PRIMARY KEY (document_id, lesson_id, ord)
      );
      CREATE INDEX IF NOT EXISTS idx_textbook_lines_lesson
        ON textbook_lines(document_id, lesson_id, ord);
      CREATE VIRTUAL TABLE IF NOT EXISTS textbook_fts USING fts5(
        surface, reading, gloss, ja, zh,
        document_id UNINDEXED, lesson_id UNINDEXED, kind UNINDEXED, ref UNINDEXED
      );
      CREATE TABLE IF NOT EXISTS textbook_term_map (
        document_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        ref_text TEXT NOT NULL,
        skill_id TEXT,
        entry_id TEXT,
        PRIMARY KEY (document_id, lesson_id, kind, ref_text)
      );
      CREATE INDEX IF NOT EXISTS idx_textbook_term_map_skill
        ON textbook_term_map(skill_id);
      CREATE INDEX IF NOT EXISTS idx_textbook_term_map_entry
        ON textbook_term_map(entry_id);
    `,
};
