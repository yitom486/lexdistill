import type { SchemaMigration } from './types.js';

/** CI-5 回填语句（单源：迁移与单测复用同一字符串，重放结果一致）。 */
export const V027_RECOUNT_SQL: readonly [string, string] = [
  `UPDATE encountered_terms SET lookup_count = (
     SELECT COUNT(*) FROM term_occurrences o
     WHERE o.user_id = encountered_terms.user_id
       AND o.language = encountered_terms.language
       AND o.term_key = encountered_terms.term_key
       AND o.source = 'lookup'
   )`,
  `UPDATE encountered_terms SET read_count = (
     SELECT COUNT(*) FROM term_occurrences o
     WHERE o.user_id = encountered_terms.user_id
       AND o.language = encountered_terms.language
       AND o.term_key = encountered_terms.term_key
       AND o.source IN ('reading', 'import')
   )`,
];

/**
 * Schema v27 `encountered-term-counts`（P1-3）。
 * 加 lookup/read 分计数＋按 occurrences.source 聚合回填（重放结果一致）。
 */
export const migration: SchemaMigration = {
  version: 27,
  name: 'encountered-term-counts',
  sql: `
      ALTER TABLE encountered_terms ADD COLUMN lookup_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE encountered_terms ADD COLUMN read_count INTEGER NOT NULL DEFAULT 0;
      ${V027_RECOUNT_SQL[0]};
      ${V027_RECOUNT_SQL[1]};
    `,
};
