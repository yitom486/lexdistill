import type { SchemaMigration } from './types.js';

/**
 * Schema v24 `content-sources`（P1-3）。
 * 统一来源登记：display_name 为可变展示列，不进唯一键；
 * 身份＝(format, origin, origin_ref)。规范行由 Repository
 * `ensureCanonicalContentSources` 显式写入（迁移只建 DDL）。
 */
export const migration: SchemaMigration = {
  version: 24,
  name: 'content-sources',
  sql: `
      CREATE TABLE IF NOT EXISTS content_sources (
        id TEXT PRIMARY KEY,
        format TEXT NOT NULL,
        origin TEXT NOT NULL,
        origin_ref TEXT NOT NULL DEFAULT '',
        display_name TEXT NOT NULL,
        license TEXT,
        attribution TEXT,
        capabilities_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_content_sources_identity
        ON content_sources(format, origin, origin_ref);
    `,
};
