import type { SchemaMigration } from './types.js';

// P1 专用出题运行器：持久化精确蓝图、运行预算与任务目标。
// v044/v045 已发布，只做加列，不改已有表结构与旧数据。
// blueprint_json / limits_json 为空表示未要求精确蓝图（仅用最大额度约束）。
const statements = [
  'ALTER TABLE generation_tasks ADD COLUMN blueprint_json TEXT CHECK(blueprint_json IS NULL OR json_valid(blueprint_json))',
  'ALTER TABLE generation_tasks ADD COLUMN limits_json TEXT CHECK(limits_json IS NULL OR json_valid(limits_json))',
  'ALTER TABLE generation_tasks ADD COLUMN objective_text TEXT',
];
export const migration: SchemaMigration = { version: 46, name: 'generation-task-blueprint-and-limits', statements, sql: statements.join(';\n') + ';' };
