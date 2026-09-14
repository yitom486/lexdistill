import type { SchemaMigration } from './types.js';

/**
 * Schema v25 `selection-contexts`（P1-3）。
 * 选区表＋草稿选区链接（NULL＝历史行）。SI-1/SI-2/SI-3 由 Repository 层执行。
 */
export const migration: SchemaMigration = {
  version: 25,
  name: 'selection-contexts',
  sql: `
      CREATE TABLE IF NOT EXISTS selection_contexts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        language TEXT NOT NULL,
        document_id TEXT,
        segment_id TEXT,
        surface TEXT NOT NULL,
        normalized_text TEXT NOT NULL,
        start_offset INTEGER,
        end_offset INTEGER,
        surrounding_text TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_selection_ctx_user
        ON selection_contexts(user_id, language, created_at);
      ALTER TABLE card_drafts ADD COLUMN selection_context_id TEXT;
    `,
};
