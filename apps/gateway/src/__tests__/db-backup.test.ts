import { describe, expect, it, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isOk } from '@lexdistill/shared';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';

/**
 * P5-1 门面接线：repo.exportDatabaseSnapshot 直通 storage 实现。
 * （桌面 save-dialog 集成点见 docs/db-backup-recovery.md；取消即不调用。）
 */
describe('repo.exportDatabaseSnapshot wiring (P5-1)', () => {
  const dirs: string[] = [];
  const repos: DrizzleLearnerRepository[] = [];
  afterEach(async () => {
    for (const r of repos.splice(0)) {
      try {
        r.getRawDb().close();
      } catch {
        /* ignore */
      }
    }
    // Windows 文件锁滞后：退避重试。
    for (const d of dirs.splice(0)) {
      let last: unknown = null;
      for (let i = 0; i < 10; i++) {
        try {
          await rm(d, { recursive: true, force: true });
          last = null;
          break;
        } catch (e) {
          last = e;
          await new Promise((r) => setTimeout(r, 50));
        }
      }
      if (last) throw last;
    }
  });

  it('文件库导出成功并携带表计数', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ss-backup-gw-'));
    dirs.push(dir);
    const repo = new DrizzleLearnerRepository(join(dir, 'gw.db'));
    repos.push(repo);
    const res = await repo.exportDatabaseSnapshot(join(dir, 'gw-backup.db'));
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.bytes).toBeGreaterThan(0);
    expect(res.value.tables).toBeGreaterThan(0);
  });

  it(':memory: 库拒绝（无文件可拷）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ss-backup-gw-'));
    dirs.push(dir);
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const res = await repo.exportDatabaseSnapshot(join(dir, 'out.db'));
    expect(isOk(res)).toBe(false);
  });
});
