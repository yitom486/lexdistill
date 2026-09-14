import type { SchemaMigration } from './types.js';

/** Schema v9 `card-drafts-kind` — 已发布，禁止改 version / name / sql。 */
export const migration: SchemaMigration = {
  version: 9,
  name: 'card-drafts-kind',
  sql: `
      ALTER TABLE card_drafts ADD COLUMN kind TEXT NOT NULL DEFAULT 'word';
      ALTER TABLE card_drafts ADD COLUMN card_type TEXT;
    `,
};
