import type { SchemaMigration } from './types.js';
export const migration: SchemaMigration = {
  version: 35, name: 'textbook-import-events',
  sql: `CREATE TABLE IF NOT EXISTS textbook_import_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, trace_id TEXT NOT NULL,
    document_id TEXT, job_id TEXT, node_id TEXT, session_id TEXT, thread_id TEXT, attempt_id TEXT, call_id TEXT,
    category TEXT NOT NULL, name TEXT NOT NULL, occurred_at TEXT NOT NULL, detail_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_textbook_import_events_trace ON textbook_import_events(user_id, trace_id, sequence);`,
};
