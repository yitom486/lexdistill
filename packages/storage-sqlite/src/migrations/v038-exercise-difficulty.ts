import type { SchemaMigration } from './types.js';

// DDL migration: preserve existing exercises; unknown estimates remain NULL.
const sql = `
CREATE TABLE textbook_exercise_items_v38 (
  id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL, ord INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('CHOICE','MULTI_CHOICE','FILL_BLANK','TRANSLATION','ORDERING','MATCHING','SHORT_ANSWER','WRITING')),
  prompt TEXT NOT NULL, options_json TEXT, left_json TEXT, right_json TEXT, answer_json TEXT,
  explanation TEXT, grading_notes TEXT,
  difficulty_tier INTEGER CHECK(difficulty_tier IS NULL OR (typeof(difficulty_tier)='integer' AND difficulty_tier BETWEEN 1 AND 5)), difficulty_reason TEXT,
  source TEXT NOT NULL CHECK(source IN ('TEXTBOOK','AI'))
);
INSERT INTO textbook_exercise_items_v38(id,document_id,chapter_id,ord,type,prompt,options_json,left_json,right_json,answer_json,explanation,grading_notes,source)
SELECT id,document_id,chapter_id,ord,type,prompt,options_json,left_json,right_json,answer_json,explanation,grading_notes,source FROM textbook_exercise_items;
DROP TABLE textbook_exercise_items;
ALTER TABLE textbook_exercise_items_v38 RENAME TO textbook_exercise_items;
CREATE INDEX idx_textbook_exercises_chapter ON textbook_exercise_items(document_id,chapter_id,ord);
`;
export const migration: SchemaMigration = { version: 38, name: 'exercise-difficulty', sql, statements: sql.split(';').map(value => value.trim()).filter(Boolean) };
