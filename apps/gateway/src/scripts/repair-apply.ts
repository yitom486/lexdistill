import path from 'node:path';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '../infrastructure/db/schema.js';
import { runDoctor, formatDoctorReport } from '../infrastructure/db/doctor.js';
import { applyOrphanCleanup, formatOrphanApplyReport, applySeedSourceFix } from '../infrastructure/db/repair-apply.js';
import { applySeedAstMigration } from '../modules/library/persistence/seed-repair.js';

/**
 * R1 历史修复 apply（写库！只读 dry-run 见 repair-plan.ts）。
 * 用法：bun src/scripts/repair-apply.ts [dbPath]
 * 顺序：R1-A 孤儿清理 → R1-B 种子 source → R1-C 种子 AST 迁移 → doctor 复验。
 * 前提：snapshot 已做、无其他 writer（见 R1 工单）。幂等：重跑零修改。
 */
const target =
  process.argv[2] ??
  process.env.STUDY_STUDIO_DB ??
  path.resolve(import.meta.dir, '../../../..', 'study-studio.db');

const sqlite = new Database(target);
try {
  console.log('== R1-A orphan cleanup ==');
  const orphan = applyOrphanCleanup(sqlite);
  console.log(formatOrphanApplyReport(orphan));

  console.log('\n== R1-B seed source fix ==');
  const source = applySeedSourceFix(sqlite);
  console.log(`ensured sources: ${source.ensuredSources.join(',')}`);
  for (const u of source.updated) console.log(`  update ${u.group}: ${u.updated}`);
  console.log(`total updated: ${source.totalUpdated}`);
  for (const t of source.thirdParty) console.log(`  third-party kept (report-only): ${t.sourceId} x${t.rows}`);

  console.log('\n== R1-C seed AST migration ==');
  const db = drizzle(sqlite, { schema });
  const migration = applySeedAstMigration(db);
  for (const d of migration.docs) {
    console.log(
      `  ${d.documentId} oldShape=${d.oldShape} migrated=${d.migrated} L${d.lessons}/ln${d.lines}/v${d.vocab}/g${d.grammar}/e${d.exercises}/m${d.termMap}/f${d.ftsRows} ${d.note}`
    );
  }

  console.log('\n== doctor after ==');
  const report = runDoctor(sqlite);
  console.log(formatDoctorReport(report));
  if (report.errors.length > 0) {
    console.log('\nAPPLY DONE WITH REMAINING ERRORS (see above)');
    process.exit(2);
  }
  console.log('\nAPPLY DONE, doctor errors = 0');
} finally {
  sqlite.close();
}
