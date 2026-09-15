import { describe, expect, it, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isOk } from '@study-studio/shared';
import { createDrizzleDb } from '../connection.js';
import { exportDatabaseSnapshot } from '../adapters/maintenance/db-backup.js';

/**
 * P5-1 整库只读快照导出。
 * - 成功：拷贝＋校验＋原子落盘，数据一致；
 * - 空库可导；损坏源失败；非法路径零副作用；同路径拒绝。
 * - Windows 文件锁滞后：句柄统一在 afterEach 关闭，rm 带退避重试。
 */
async function rmRetry(dir: string): Promise<void> {
  let last: unknown = null;
  for (let i = 0; i < 10; i++) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw last;
}

describe('exportDatabaseSnapshot (P5-1)', () => {
  const dirs: string[] = [];
  const dbs: Database[] = [];
  afterEach(async () => {
    for (const db of dbs.splice(0)) {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    }
    for (const d of dirs.splice(0)) await rmRetry(d);
  });

  async function workDir(): Promise<string> {
    const d = await mkdtemp(join(tmpdir(), 'ss-backup-'));
    dirs.push(d);
    return d;
  }

  function fileDb(path: string): Database {
    const { sqlite } = createDrizzleDb(path);
    dbs.push(sqlite);
    return sqlite;
  }

  it('快照成功：文件一致＋integrity＋原子落盘无 tmp 残留', async () => {
    const dir = await workDir();
    const src = join(dir, 'src.db');
    const sqlite = fileDb(src);
    sqlite.run(
      `INSERT INTO documents (id, user_id, title, source_kind, language, content, created_at, updated_at)
       VALUES ('d1', 'u1', 'T', 'user_import', 'ja', 'content-body', 't', 't')`
    );
    const target = join(dir, 'backup.db');
    const res = await exportDatabaseSnapshot({ sqlite }, { sourcePath: src, targetPath: target });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.bytes).toBeGreaterThan(0);
    expect(res.value.tables).toBeGreaterThan(0);
    // 目标可读且数据一致。
    const check = new Database(target, { readonly: true });
    dbs.push(check);
    const row = check
      .query('SELECT content AS c FROM documents WHERE id = ?')
      .get('d1') as { c: string };
    expect(row.c).toBe('content-body');
    const integ = check.query('PRAGMA integrity_check').all() as Array<{
      integrity_check: string;
    }>;
    expect(integ).toEqual([{ integrity_check: 'ok' }]);
    // 同目录无 tmp 残留。
    const names = await readdir(dir);
    expect(names.filter((n) => n.endsWith('.tmp')).length).toBe(0);
    expect(names).toContain('backup.db');
  });

  it('空库可导：零表快照仍合法', async () => {
    const dir = await workDir();
    const src = join(dir, 'empty.db');
    const sqlite = fileDb(src);
    const res = await exportDatabaseSnapshot(
      { sqlite },
      { sourcePath: src, targetPath: join(dir, 'empty-backup.db') }
    );
    expect(isOk(res)).toBe(true);
  });

  it('损坏源失败：垃圾文件拒绝且目标无残留', async () => {
    const dir = await workDir();
    const garbage = join(dir, 'garbage.db');
    await writeFile(garbage, Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe]));
    const sqlite = new Database(garbage);
    dbs.push(sqlite);
    const res = await exportDatabaseSnapshot(
      { sqlite },
      { sourcePath: garbage, targetPath: join(dir, 'out.db') }
    );
    expect(isOk(res)).toBe(false);
    const names = await readdir(dir);
    expect(names).not.toContain('out.db');
    expect(names.filter((n) => n.endsWith('.tmp')).length).toBe(0);
  });

  it('非法路径零副作用：空目标／缺失父目录／同路径／缺失源', async () => {
    const dir = await workDir();
    const src = join(dir, 'src.db');
    const sqlite = fileDb(src);
    const deps = { sqlite };
    const before = await readdir(dir);
    // 空目标（取消保存等价）：E_INVALID_INPUT。
    const emptyTarget = await exportDatabaseSnapshot(deps, { sourcePath: src, targetPath: '   ' });
    expect(isOk(emptyTarget)).toBe(false);
    // 父目录不存在。
    const noParent = await exportDatabaseSnapshot(deps, {
      sourcePath: src,
      targetPath: join(dir, 'no-such-dir', 'out.db'),
    });
    expect(isOk(noParent)).toBe(false);
    // 同路径。
    const same = await exportDatabaseSnapshot(deps, { sourcePath: src, targetPath: src });
    expect(isOk(same)).toBe(false);
    // 缺失源。
    const missing = await exportDatabaseSnapshot(deps, {
      sourcePath: join(dir, 'missing.db'),
      targetPath: join(dir, 'out.db'),
    });
    expect(isOk(missing)).toBe(false);
    if (!isOk(missing)) expect(missing.error.code).toBe('E_NOT_FOUND');
    // 目录内容除源库外无新增。
    const after = await readdir(dir);
    expect(after.sort()).toEqual(before.sort());
    // :memory: 拒绝。
    const mem = await exportDatabaseSnapshot(deps, {
      sourcePath: ':memory:',
      targetPath: join(dir, 'out.db'),
    });
    expect(isOk(mem)).toBe(false);
  });
});
