import path from 'node:path';
import { Database } from 'bun:sqlite';
import { buildRepairPlan, formatRepairPlan } from '../infrastructure/db/repair-plan.js';

/**
 * repair-plan dry-run CLI：只读输出历史修复候选，不写库、无 apply。
 * 用法：bun src/scripts/repair-plan.ts [dbPath]
 * 执行真实修复另行指令，本工具永远不提供 apply。
 */
const target =
  process.argv[2] ??
  process.env.STUDY_STUDIO_DB ??
  path.resolve(import.meta.dir, '../../../..', 'study-studio.db');
const db = new Database(target, { readonly: true });
try {
  console.log(formatRepairPlan(buildRepairPlan(db)));
  console.log(`\n库：${target}（只读打开，未修改）`);
} finally {
  db.close();
}
