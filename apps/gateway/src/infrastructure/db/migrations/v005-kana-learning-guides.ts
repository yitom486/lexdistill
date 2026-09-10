import type { SchemaMigration } from './types.js';

/** Schema v5 `kana-learning-guides` — 已发布，禁止改 version / name / sql。 */
export const migration: SchemaMigration = {
  version: 5,
  name: 'kana-learning-guides',
  sql: `
      ALTER TABLE curriculum_kana ADD COLUMN learning_guide_json TEXT;
    `,
};
