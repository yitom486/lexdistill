import path from 'node:path';
import { Database } from 'bun:sqlite';
import {
  planLessonOrdering,
  applyLessonOrdering,
  formatOrderingPlan,
} from '../infrastructure/db/lesson-ordering.js';

/**
 * lesson-ordering apply CLI：回填 textbook_lessons.sort_order。
 * 用法：bun src/scripts/lesson-ordering-apply.ts [dbPath] --apply
 * - 无 --apply 只做 preflight（等价 dry-run），绝不写；
 * - 有 --apply：先重跑同一 preflight，任一 unresolved 即整体退出（不做部分回填）；
 * - 仅 UPDATE sort_order；单事务；每行断言；幂等；post-apply 验证；
 * - 不在 Gateway 启动时自动执行；真实库操作前先停 writer 并做 R1 snapshot。
 */
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const target =
  args.find((a) => !a.startsWith('--')) ??
  process.env.STUDY_STUDIO_DB ??
  path.resolve(import.meta.dir, '../../../..', 'study-studio.db');
const db = apply ? new Database(target) : new Database(target, { readonly: true });
try {
  const plan = planLessonOrdering(db);
  console.log(formatOrderingPlan(plan));
  if (!apply) {
    console.log('\n[dry-run] 未加 --apply，未写入。');
    process.exit(plan.unresolvedCount > 0 ? 2 : 0);
  }
  const res = applyLessonOrdering(db, plan);
  console.log(`\n[apply] documents=${res.documents} rows=${res.rows} verified=${res.verified}`);
  console.log(`库：${target}`);
  process.exit(res.verified ? 0 : 1);
} catch (e) {
  console.error(`[apply] 拒绝/失败：${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
} finally {
  db.close();
}
