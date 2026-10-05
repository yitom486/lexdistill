import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/**
 * R1 snapshot：VACUUM INTO 一致性快照（禁 Copy-Item 主库，尤其 WAL 未 checkpoint 时）。
 * VACUUM 在单语句内读出一致视图并写出全新整理库，等价在线备份。
 * 用法：bun src/scripts/snapshot-db.ts [dbPath] [outDir]
 * 输出 snapshot 路径 + 大小 + SHA-256 + 双方 integrity_check。
 * 默认值均为相对/系统路径，不含机器专属绝对路径。
 */
const src = process.argv[2] ?? resolve(process.cwd(), 'study-studio.db');
const outDir = process.argv[3] ?? join(tmpdir(), 'study-studio-snapshots');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dest = `${outDir}/study-studio-r1-${stamp}.db`;
mkdirSync(dirname(dest), { recursive: true });

const srcDb = new Database(src, { readonly: true });
try {
  const srcCheck = (srcDb.query('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>)
    .map((r) => r.integrity_check)
    .join(',');
  console.log(`source integrity_check: ${srcCheck}`);
  if (srcCheck !== 'ok') throw new Error('源库 integrity_check 非 ok，停止');
  srcDb.run(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
} finally {
  srcDb.close();
}

const snapDb = new Database(dest, { readonly: true });
try {
  const snapCheck = (snapDb.query('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>)
    .map((r) => r.integrity_check)
    .join(',');
  console.log(`snapshot integrity_check: ${snapCheck}`);
  if (snapCheck !== 'ok') throw new Error('快照 integrity_check 非 ok');
} finally {
  snapDb.close();
}

const bytes = await Bun.file(dest).arrayBuffer();
const sha = createHash('sha256').update(Buffer.from(bytes)).digest('hex');
console.log(`snapshot: ${dest}`);
console.log(`size: ${bytes.byteLength}`);
console.log(`sha256: ${sha}`);
