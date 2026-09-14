import type { SchemaMigration } from './types.js';

/** Schema v20 `toc-import-session-document` — 已发布，禁止改 version / name / sql。 */
export const migration: SchemaMigration = {
  version: 20,
  name: 'toc-import-session-document',
  sql: `
      ALTER TABLE toc_import_sessions ADD COLUMN document_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_toc_import_sessions_document ON toc_import_sessions(document_id);
    `,
};
