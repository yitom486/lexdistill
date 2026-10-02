import type { SchemaMigration } from './types.js';
// Versioned DDL only; unrelated historical scores and assets are preserved as unknown scope/scale.
const sql = `
ALTER TABLE practice_item_attempts ADD COLUMN attempt_no INTEGER NOT NULL DEFAULT 1;
ALTER TABLE practice_item_attempts ADD COLUMN previous_attempt_id TEXT;
ALTER TABLE practice_item_attempts ADD COLUMN submission_kind TEXT;
ALTER TABLE practice_item_attempts ADD COLUMN question_snapshot_json TEXT;
ALTER TABLE practice_item_attempts ADD COLUMN grading_run_id TEXT;
ALTER TABLE practice_item_attempts ADD COLUMN grading_error_code TEXT;
ALTER TABLE quiz_attempts ADD COLUMN source_attempt_id TEXT;
ALTER TABLE quiz_attempts ADD COLUMN document_id TEXT;
ALTER TABLE quiz_attempts ADD COLUMN chapter_id TEXT;
ALTER TABLE quiz_attempts ADD COLUMN difficulty_tier INTEGER;
ALTER TABLE quiz_attempts ADD COLUMN max_score REAL;
ALTER TABLE quiz_attempts ADD COLUMN submission_kind TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_quiz_source_attempt ON quiz_attempts(source_attempt_id);
`;
export const migration: SchemaMigration = { version: 39, name: 'exercise-attempt-history', sql, statements: sql.split(';').map(value => value.trim()).filter(Boolean) };
