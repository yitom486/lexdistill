import type { SchemaMigration } from './types.js';

/** Schema v19 `toc-import-sessions` — 已发布，禁止改 version / name / sql。 */
export const migration: SchemaMigration = {
  version: 19,
  name: 'toc-import-sessions',
  sql: `
      CREATE TABLE IF NOT EXISTS toc_import_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        request_key TEXT NOT NULL,
        plan_fingerprint TEXT NOT NULL,
        pdf_sha256 TEXT NOT NULL,
        page_count INTEGER NOT NULL,
        lesson_count INTEGER NOT NULL,
        chunk_count INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'prepared',
        doc_title TEXT NOT NULL DEFAULT '',
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_toc_import_sessions_user_key ON toc_import_sessions(user_id, request_key);
      CREATE TABLE IF NOT EXISTS toc_import_chunks (
        session_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        lesson_index INTEGER NOT NULL,
        lesson_title TEXT NOT NULL DEFAULT '',
        physical_start INTEGER NOT NULL,
        physical_end INTEGER NOT NULL,
        chunk_fingerprint TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'prepared',
        document_id TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (session_id, ordinal)
      );
      CREATE INDEX IF NOT EXISTS idx_toc_import_chunks_session ON toc_import_chunks(session_id, ordinal);
    `,
};
