import type { SchemaMigration } from './types.js';

/**
 * Schema v26 `term-occurrence-segments`（P1-3）。
 * occurrence 加段地址列（NULL＝历史行）；quote 保留。
 */
export const migration: SchemaMigration = {
  version: 26,
  name: 'term-occurrence-segments',
  sql: `
      ALTER TABLE term_occurrences ADD COLUMN segment_id TEXT;
      ALTER TABLE term_occurrences ADD COLUMN lesson_id TEXT;
    `,
};
