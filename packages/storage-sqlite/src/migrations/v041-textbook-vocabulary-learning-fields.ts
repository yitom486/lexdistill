import type { SchemaMigration } from './types.js';

/**
 * Phase 1 教材词汇扩展：只加字段，不回填、不重导。
 * - usage_notes：本课用法（搭配、句型、适用场合），模型在导入时填写。
 * - context_note：本课取义说明（该词在本课语境中的具体含义与使用方式）。
 * - source：内容来源，与 knowledge/articles/sentences 对齐；存量行默认为 TEXTBOOK。
 * 存量行三列均为 NULL/'TEXTBOOK'，旧导入不受影响。
 */
const sql = `
ALTER TABLE textbook_vocabulary ADD COLUMN usage_notes TEXT;
ALTER TABLE textbook_vocabulary ADD COLUMN context_note TEXT;
ALTER TABLE textbook_vocabulary ADD COLUMN source TEXT NOT NULL DEFAULT 'TEXTBOOK';
`;
export const migration: SchemaMigration = { version: 41, name: 'textbook-vocabulary-learning-fields', sql,
  statements: sql.split(';').map(value => value.trim()).filter(Boolean) };
