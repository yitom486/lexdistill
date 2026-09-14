import type { SchemaMigration } from './types.js';

/** Schema v16 `textbook-exercises-grammar-examples` — 已发布，禁止改 version / name / sql。 */
export const migration: SchemaMigration = {
  version: 16,
  name: 'textbook-exercises-grammar-examples',
  sql: `
      CREATE TABLE IF NOT EXISTS textbook_exercises (
        document_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        ord INTEGER NOT NULL,
        exercise_id TEXT,
        type TEXT NOT NULL,
        prompt TEXT NOT NULL,
        options_json TEXT NOT NULL DEFAULT '[]',
        answer TEXT NOT NULL DEFAULT '',
        explanation TEXT,
        PRIMARY KEY (document_id, lesson_id, ord)
      );
      CREATE INDEX IF NOT EXISTS idx_textbook_exercises_lesson
        ON textbook_exercises(document_id, lesson_id, ord);
      ALTER TABLE textbook_grammar ADD COLUMN examples_json TEXT NOT NULL DEFAULT '[]';
    `,
};
