import type { SchemaMigration } from './types.js';
export const migration: SchemaMigration = {
  version: 34, name: 'textbook-structured-content',
  sql: `
    ALTER TABLE textbook_lessons ADD COLUMN content_json TEXT;
    ALTER TABLE textbook_lessons ADD COLUMN submission_id TEXT;
    ALTER TABLE textbook_vocab ADD COLUMN source TEXT;
    ALTER TABLE textbook_vocab ADD COLUMN toc_id TEXT;
    ALTER TABLE textbook_vocab ADD COLUMN field_sources_json TEXT;
    ALTER TABLE textbook_grammar ADD COLUMN source TEXT;
    ALTER TABLE textbook_grammar ADD COLUMN toc_id TEXT;
    ALTER TABLE textbook_grammar ADD COLUMN ai_explanation TEXT;
    ALTER TABLE textbook_grammar ADD COLUMN field_sources_json TEXT;
    ALTER TABLE textbook_lines ADD COLUMN block_id TEXT;
    ALTER TABLE textbook_lines ADD COLUMN kind TEXT;
    ALTER TABLE textbook_lines ADD COLUMN source TEXT;
    ALTER TABLE textbook_lines ADD COLUMN toc_id TEXT;
    ALTER TABLE textbook_lines ADD COLUMN field_sources_json TEXT;
    ALTER TABLE textbook_exercises ADD COLUMN source TEXT;
    ALTER TABLE textbook_exercises ADD COLUMN toc_id TEXT;
    ALTER TABLE textbook_exercises ADD COLUMN answer_json TEXT;
    ALTER TABLE textbook_exercises ADD COLUMN content_json TEXT;
    ALTER TABLE textbook_exercises ADD COLUMN field_sources_json TEXT;
  `,
};
