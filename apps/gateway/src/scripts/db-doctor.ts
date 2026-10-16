import path from 'node:path';
import { Database } from 'bun:sqlite';
import { runDoctor, formatDoctorReport } from '@lexdistill/storage-sqlite';

/**
 * db doctor CLI：只读检查，无 FK 架构下的完整性巡检。
 * 用法：bun src/scripts/db-doctor.ts [dbPath]
 * 缺省库与网关同源（仓库根 lexdistill.db；STUDY_STUDIO_DB 优先）。
 * exit code：FAIL>0 时为 1，可进 CI。
 * 注意：脚本不得 import bootstrap（G5-R1），库路径按 config.ts 同规则内联。
 */
const target =
  process.argv[2] ??
  process.env.STUDY_STUDIO_DB ??
  path.resolve(import.meta.dir, '../../../..', 'lexdistill.db');
const db = new Database(target, { readonly: true });
try {
  const report = runDoctor(db);
  console.log(formatDoctorReport(report));
  console.log(`\n库：${target}`);
  process.exit(report.errors.length > 0 ? 1 : 0);
} finally {
  db.close();
}
