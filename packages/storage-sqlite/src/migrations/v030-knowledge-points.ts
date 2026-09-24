import type { SchemaMigration } from './types.js';

/**
 * Schema v30 `knowledge-points` —— 目录挂知识：
 * - textbook_lessons 加 kind（'lesson' | 'chapter'，默认 lesson）与 parent_id（章→课挂载，可空）；
 *   SQLite 只允许 ADD COLUMN，NOT NULL 必须带 DEFAULT。
 * - 新增 knowledge_points（蒸馏知识点：concept + explanation，可悬空原文，source_refs_json 可空指回）；
 * - textbook_term_map 退役（无用户面读者；映射计数职能由 shred 内存统计 + doctor 其余规则接管）。
 */
export const migration: SchemaMigration = {
  version: 30,
  name: 'knowledge-points',
  sql: `
      ALTER TABLE textbook_lessons ADD COLUMN kind TEXT NOT NULL DEFAULT 'lesson';
      ALTER TABLE textbook_lessons ADD COLUMN parent_id TEXT;
      CREATE TABLE IF NOT EXISTS knowledge_points (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'concept',
        ord INTEGER NOT NULL DEFAULT 0,
        concept TEXT NOT NULL,
        explanation_md TEXT NOT NULL DEFAULT '',
        source_refs_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_points_lesson
        ON knowledge_points(document_id, lesson_id, ord);
      DROP TABLE IF EXISTS textbook_term_map;
    `,
};
