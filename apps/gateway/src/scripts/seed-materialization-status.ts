import path from 'node:path';
import { Database } from 'bun:sqlite';
import { parseTextbookAST } from '@study-studio/document-model';
import { TEXTBOOK_BOOKS } from '../infrastructure/db/seeds/textbook-seed.js';
import {
  describeSeedStatus,
  SEED_MATERIALIZER_VERSION,
  type SeedStatusEntry,
} from '../modules/library/persistence/seed-materialization.js';

/**
 * seed materialization 状态检查 CLI（只读）。
 * 用法：bun src/scripts/seed-materialization-status.ts [dbPath]
 * 缺省库与网关同源（仓库根 study-studio.db；STUDY_STUDIO_DB 优先）。
 * 对每本 TEXTBOOK_BOOK 输出 documentId / state 是否存在 / stored version /
 * current version / shouldSkip / reason；exit code：全 skip 为 0，否则为 1。
 * 注意：只读句柄打开，不运行 migration、不启动 gateway、不 materialize、不写库。
 * 脚本不得 import bootstrap（G5-R1），库路径按 db-doctor.ts 同规则内联。
 */
export function formatSeedStatusLine(s: SeedStatusEntry): string {
  const stored = s.storedVersion === null ? '-' : String(s.storedVersion);
  return `- ${s.documentId}: state=${s.stateExists ? 'present' : 'missing'} storedVersion=${stored} currentVersion=${s.currentVersion} shouldSkip=${s.shouldSkip} reason="${s.reason}"`;
}

export function collectSeedStatus(db: Database): { lines: string[]; clean: number; total: number } {
  const lines: string[] = [];
  let clean = 0;
  let total = 0;
  for (const raw of TEXTBOOK_BOOKS) {
    const id = (raw as { id?: unknown }).id;
    if (typeof id !== 'string' || !id) continue;
    const parsed = parseTextbookAST(JSON.parse(JSON.stringify(raw)));
    if (!parsed.ok) {
      lines.push(`- ${id}: AST 非法，跳过`);
      continue;
    }
    total++;
    const status = describeSeedStatus(db, id, parsed.value, SEED_MATERIALIZER_VERSION);
    if (status.shouldSkip) clean++;
    lines.push(formatSeedStatusLine(status));
  }
  return { lines, clean, total };
}

if (import.meta.main) {
  const target =
    process.argv[2] ??
    process.env.STUDY_STUDIO_DB ??
    path.resolve(import.meta.dir, '../../../..', 'study-studio.db');
  const db = new Database(target, { readonly: true });
  try {
    console.log(`seed-materialization status (db: ${target}, materializer v${SEED_MATERIALIZER_VERSION})`);
    const { lines, clean, total } = collectSeedStatus(db);
    for (const line of lines) console.log(line);
    console.log(`clean: ${clean}/${total} skip`);
    process.exit(total > 0 && clean === total ? 0 : 1);
  } finally {
    db.close();
  }
}
