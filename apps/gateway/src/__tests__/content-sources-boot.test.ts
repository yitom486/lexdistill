import { describe, expect, it, afterAll } from 'bun:test';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { ensureContentSourcesAtBoot } from '../bootstrap/create-gateway.js';

/**
 * P2-2b 启动期来源登记。
 * - 6 规范行存在；二次执行零增长；
 * - 表缺失时 warn 且不抛（启动继续）。
 */
describe('ensureContentSourcesAtBoot (P2-2b)', () => {
  const seen: unknown[][] = [];
  const origWarn = console.warn;
  console.warn = ((...args: unknown[]) => {
    seen.push(args);
  }) as typeof console.warn;
  afterAll(() => {
    console.warn = origWarn;
  });

  function sourceCount(repo: DrizzleLearnerRepository): number {
    return (
      repo.getRawDb().query('SELECT COUNT(*) AS n FROM content_sources').get() as { n: number }
    ).n;
  }

  it('首次执行写入 6 规范行', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    try {
      const res = await ensureContentSourcesAtBoot(repo);
      expect(res).toEqual({ ensured: 6 });
      expect(sourceCount(repo)).toBe(6);
    } finally {
      repo.getRawDb().close();
    }
  });

  it('二次执行零增长', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    try {
      await ensureContentSourcesAtBoot(repo);
      await ensureContentSourcesAtBoot(repo);
      expect(sourceCount(repo)).toBe(6);
    } finally {
      repo.getRawDb().close();
    }
  });

  it('表缺失：warn 且不抛，返回零', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    try {
      repo.getRawDb().run('DROP TABLE content_sources');
      seen.length = 0;
      let threw = false;
      let out: { ensured: number } | null = null;
      try {
        out = await ensureContentSourcesAtBoot(repo);
      } catch {
        threw = true;
      }
      expect(threw).toBe(false);
      expect(out).toEqual({ ensured: 0 });
      expect(seen.length).toBe(1);
      expect(JSON.stringify(seen[0])).toContain('[boot]');
    } finally {
      repo.getRawDb().close();
    }
  });
});
