import type { SchemaMigration } from './types.js';

/** Schema v13 `placement-blueprint` — 已发布，禁止改 version / name / sql。 */
export const migration: SchemaMigration = {
  version: 13,
  name: 'placement-blueprint',
  sql: `
      ALTER TABLE placement_exams ADD COLUMN blueprint_version TEXT;
      ALTER TABLE placement_exams ADD COLUMN blueprint_json TEXT;
      ALTER TABLE placement_exams ADD COLUMN subscores_json TEXT;
    `,
};
