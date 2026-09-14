import type { SchemaMigration } from './types.js';

/**
 * Schema v23 `content-segments`（P1-3）。
 * 段地址表：课程文档由 lines 投影， reflux 用户文档由 content 切分。
 * hash 为作用域身份（含 document/lesson/ord），UNIQUE(hash) 保证并发投影零重复。
 */
export const migration: SchemaMigration = {
  version: 23,
  name: 'content-segments',
  sql: `
      CREATE TABLE IF NOT EXISTS content_segments (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL DEFAULT '',
        ord INTEGER NOT NULL,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        start_offset INTEGER,
        end_offset INTEGER,
        hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_content_segments_scope
        ON content_segments(document_id, lesson_id, ord);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_content_segments_hash ON content_segments(hash);
      CREATE INDEX IF NOT EXISTS idx_content_segments_doc ON content_segments(document_id, lesson_id, ord);
    `,
};
