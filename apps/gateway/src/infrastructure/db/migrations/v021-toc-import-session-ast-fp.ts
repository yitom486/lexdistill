import type { SchemaMigration } from './types.js';

/** Schema v21 `toc-import-session-ast-fp` — 已发布，禁止改 version / name / sql。 */
export const migration: SchemaMigration = {
  version: 21,
  name: 'toc-import-session-ast-fp',
  sql: `
      ALTER TABLE toc_import_sessions ADD COLUMN ast_fingerprint TEXT;
    `,
};
