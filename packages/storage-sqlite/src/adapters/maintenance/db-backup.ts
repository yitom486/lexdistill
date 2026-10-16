import { Database } from 'bun:sqlite';
import { copyFile, rename, stat, unlink } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
  generateId,
} from '@lexdistill/shared';

/**
 * 整库只读快照导出（P5-1）。
 * - 一致性：WAL 库先 `wal_checkpoint(TRUNCATE)`（busy 即 retryable err），
 *   再拷贝主库文件——WAL 写入不碰主文件，拷贝即检查点时刻的一致快照；
 *   不用 VACUUM（本批禁令），不动源库；
 * - 路径先验：非法路径在任何 IO 前拒绝（取消保存零副作用）；
 * - 临时文件＋原子替换：同目录 tmp 写→校验→rename，失败清 tmp，目标无半成品；
 * - 校验：只读打开＋`integrity_check`＋migrations 表可读，三者缺一即失败。
 */

export interface ExportDatabaseSnapshotInput {
  /** 源库文件路径（':memory:'／空拒绝）。 */
  sourcePath: string;
  /** 目标文件路径（父目录须存在；已存在则原子覆盖，覆盖确认由调用方 UI 负责）。 */
  targetPath: string;
}

export interface DatabaseSnapshotInfo {
  sourcePath: string;
  targetPath: string;
  bytes: number;
  tables: number;
}

function isValidFilePath(p: string): boolean {
  const v = p.trim();
  if (!v || v === ':memory:') return false;
  if (v.includes('\0')) return false;
  return true;
}

export async function exportDatabaseSnapshot(
  deps: { sqlite: Database },
  input: ExportDatabaseSnapshotInput
): Promise<Result<DatabaseSnapshotInfo, BusinessError>> {
  const sourcePath = input.sourcePath.trim();
  const targetPath = input.targetPath.trim();
  // 零副作用前置校验：非法路径直接拒绝，不建 tmp、不碰目标。
  if (!isValidFilePath(sourcePath) || !isValidFilePath(targetPath)) {
    return err(new BusinessError('E_INVALID_INPUT', '备份源或目标路径非法', 'VALIDATION'));
  }
  let sourceStat: Stats;
  try {
    sourceStat = await stat(sourcePath);
  } catch {
    return err(new BusinessError('E_NOT_FOUND', '源数据库文件不存在', 'DATABASE'));
  }
  if (!sourceStat.isFile()) {
    return err(new BusinessError('E_INVALID_INPUT', '源数据库不是常规文件', 'VALIDATION'));
  }
  try {
    await stat(dirname(targetPath));
  } catch {
    return err(new BusinessError('E_INVALID_INPUT', '目标目录不存在', 'VALIDATION'));
  }
  if (dirname(targetPath) === dirname(sourcePath) && basename(targetPath) === basename(sourcePath)) {
    return err(new BusinessError('E_INVALID_INPUT', '目标路径与源库相同', 'VALIDATION'));
  }

  // WAL 检查点：忙即 retryable 失败，不拷贝半截状态。
  try {
    const ck = deps.sqlite
      .query('PRAGMA wal_checkpoint(TRUNCATE)')
      .get() as { busy: number; log: number; checkpointed: number } | null;
    if (ck && ck.busy !== 0) {
      return err(
        new BusinessError('E_DB_BUSY', '备份时数据库忙，请稍后重试。', 'DATABASE', true)
      );
    }
  } catch (error) {
    return err(
      translateToBusinessError(error, { category: 'DATABASE', action: 'exportSnapshotCheckpoint' })
    );
  }

  // 同目录 tmp（同文件系统，rename 原子）。
  const tmpPath = join(dirname(targetPath), `.${basename(targetPath)}.${generateId('snap')}.tmp`);
  try {
    await copyFile(sourcePath, tmpPath);
  } catch (error) {
    return err(
      translateToBusinessError(error, { category: 'DATABASE', action: 'exportSnapshotCopy' })
    );
  }
  try {
    validateSnapshotFile(tmpPath);
  } catch (error) {
    await unlink(tmpPath).catch(() => {});
    return err(
      translateToBusinessError(error, { category: 'DATABASE', action: 'exportSnapshotValidate' })
    );
  }
  try {
    await rename(tmpPath, targetPath);
  } catch (error) {
    await unlink(tmpPath).catch(() => {});
    return err(
      translateToBusinessError(error, { category: 'DATABASE', action: 'exportSnapshotCommit' })
    );
  }
  try {
    const out = await stat(targetPath);
    return ok({
      sourcePath,
      targetPath,
      bytes: out.size,
      tables: countTables(targetPath),
    });
  } catch (error) {
    return err(
      translateToBusinessError(error, { category: 'DATABASE', action: 'exportSnapshotStat' })
    );
  }
}

function validateSnapshotFile(path: string): void {
  let db: Database | null = null;
  try {
    db = new Database(path, { readonly: true, create: false });
    const rows = db
      .query('PRAGMA integrity_check')
      .all() as Array<{ integrity_check: string }>;
    if (rows.length !== 1 || rows[0]!.integrity_check !== 'ok') {
      throw new BusinessError('E_DB_CORRUPT', '备份校验失败：完整性检查未通过。', 'DATABASE');
    }
    db.query('SELECT COUNT(*) AS n FROM schema_migrations').get();
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}

function countTables(path: string): number {
  let db: Database | null = null;
  try {
    db = new Database(path, { readonly: true, create: false });
    const row = db
      .query("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'")
      .get() as { n: number };
    return row.n;
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}

