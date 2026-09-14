import path from 'node:path';
import { Database } from 'bun:sqlite';
import { planLessonOrdering, formatOrderingPlan } from '@study-studio/storage-sqlite';

/**
 * lesson-ordering dry-run CLI：只读输出回填计划。
 * 用法：bun src/scripts/lesson-ordering-plan.ts [dbPath]
 * - SQLite readonly 打开；不调用网关/initSchema/seed/shred/网络；
 * - exit code：unresolved>0 时为 2（提示人工处理），仅 nameless 成功为 0。
 */
const target =
  process.argv[2] ??
  process.env.STUDY_STUDIO_DB ??
  path.resolve(import.meta.dir, '../../../..', 'study-studio.db');
const db = new Database(target, { readonly: true });
try {
  const plan = planLessonOrdering(db);
  console.log(formatOrderingPlan(plan));
  console.log(`\n库：${target}`);
  process.exit(plan.unresolvedCount > 0 ? 2 : 0);
} finally {
  db.close();
}
