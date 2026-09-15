import type { SchemaMigration } from './types.js';

/**
 * Schema v29 `artifact-user`（P4-2 item2）。
 * ai_artifact_runs 加 user_id（历史行回填 ''＝未知；新写入非空）。
 * 模板 CREATE 保持 v028 形状（v017 先例：加列只走 migration，新库由重放补齐）。
 */
export const migration: SchemaMigration = {
  version: 29,
  name: 'artifact-user',
  sql: `
      ALTER TABLE ai_artifact_runs ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
    `,
};
