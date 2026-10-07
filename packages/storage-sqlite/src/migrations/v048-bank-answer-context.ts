import type { SchemaMigration } from './types.js';

const statements = [
  `ALTER TABLE bank_submissions ADD COLUMN time_spent_ms INTEGER NOT NULL DEFAULT 0 CHECK(time_spent_ms>=0)`,
  `ALTER TABLE bank_submissions ADD COLUMN attempt_id TEXT`,
  `ALTER TABLE bank_submissions ADD COLUMN model TEXT`,
  `ALTER TABLE bank_submissions ADD COLUMN adapter TEXT`,
  `CREATE UNIQUE INDEX bank_submissions_attempt ON bank_submissions(attempt_id)`,
];
export const migration: SchemaMigration = { version: 48, name: 'bank-answer-context', statements, sql: statements.join(';\n') + ';' };
