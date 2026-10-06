import type { SchemaMigration } from './types.js';

/**
 * 全局轨道＋教材轨道的学习内容字段：只加列，不回填。
 * - learning_json：结构化教学内容（七模块，缺省可空），NULL 表示尚未生成。
 * - learning_version：按词覆盖计数，重复生成只 bump 版本不建新行。
 * - learning_updated_at / learning_session_id：最近生成时间与关联学习会话（继续追问用）。
 * 两表行为一致，各轨道独立读写，互不覆盖。
 */
const sql = `
ALTER TABLE global_vocabulary ADD COLUMN learning_json TEXT;
ALTER TABLE global_vocabulary ADD COLUMN learning_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE global_vocabulary ADD COLUMN learning_updated_at TEXT;
ALTER TABLE global_vocabulary ADD COLUMN learning_session_id TEXT;
ALTER TABLE textbook_vocabulary ADD COLUMN learning_json TEXT;
ALTER TABLE textbook_vocabulary ADD COLUMN learning_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE textbook_vocabulary ADD COLUMN learning_updated_at TEXT;
ALTER TABLE textbook_vocabulary ADD COLUMN learning_session_id TEXT;
`;
export const migration: SchemaMigration = { version: 42, name: 'vocabulary-learning-content-fields', sql,
  statements: sql.split(';').map(value => value.trim()).filter(Boolean) };
