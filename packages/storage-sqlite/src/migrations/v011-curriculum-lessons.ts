import type { SchemaMigration } from './types.js';

/** Schema v11 `curriculum-lessons` — 已发布，禁止改 version / name / sql。 */
export const migration: SchemaMigration = {
  version: 11,
  name: 'curriculum-lessons',
  sql: `
      CREATE TABLE IF NOT EXISTS curriculum_lessons (
        id TEXT PRIMARY KEY,
        language TEXT NOT NULL,
        min_level TEXT NOT NULL DEFAULT 'NOVICE',
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        body_json TEXT NOT NULL DEFAULT '{}',
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_lessons_lang ON curriculum_lessons(language, sort_order);
      CREATE TABLE IF NOT EXISTS lesson_progress (
        user_id TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        PRIMARY KEY (user_id, skill_id)
      );
    `,
};
