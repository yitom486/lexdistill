import type { SchemaMigration } from './types.js';

/** Schema v17 `lesson-sort-order` — 已发布，禁止改 version / name / sql。 */
export const migration: SchemaMigration = {
  version: 17,
  name: 'lesson-sort-order',
  sql: `
      ALTER TABLE textbook_lessons ADD COLUMN sort_order INTEGER;
    `,
};
