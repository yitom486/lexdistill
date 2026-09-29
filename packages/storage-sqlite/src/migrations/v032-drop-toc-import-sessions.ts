import type { SchemaMigration } from './types.js';

/**
 * Schema v32 `drop-toc-import-sessions` —— 清理废弃的旧分块导入临时表：
 * - 淘汰旧的基于流式追加分块的 toc_import_chunks 与 toc_import_sessions 表；
 * - 全面切换至 AI-Native 一条龙流水线（Phase 0 骨架建槽 + Phase 1&2 agentpools Worker 并发提炼回填）。
 */
export const migration: SchemaMigration = {
  version: 32,
  name: 'drop-toc-import-sessions',
  sql: `
    DROP TABLE IF EXISTS toc_import_chunks;
    DROP TABLE IF EXISTS toc_import_sessions;
  `,
};
