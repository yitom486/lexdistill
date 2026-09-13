import { describe, expect, it, beforeEach } from 'bun:test';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';

/**
 * M4-3 异步事务语义回归：SAVEPOINT 包裹的 await 链必须整体提交或整体回滚。
 * 背景：bun:sqlite 的 transaction(async () => …) 不能跨 await 保持原子性
 *（M4-2 回滚测试实证部分提交），withTransaction 已改显式 SAVEPOINT 实现。
 */
describe('M4-3 async transaction semantics', () => {
  let repo: DrizzleLearnerRepository;
  const userId = 'tx_user';

  function insertEvent(id: string): void {
    repo
      .getRawDb()
      .run(
        `INSERT INTO review_schedule_events
         (id, user_id, card_id, language, algorithm_id, algorithm_version, rating,
          input_state_json, output_state_json, evaluated_at, created_at)
         VALUES (?, ?, 'card-tx', 'ja', 'fsrs', '1.0.0', 'GOOD', '{}', '{}',
                 '2026-09-07T12:00:00.000Z', '2026-09-07T12:00:01.000Z')`,
        [id, userId]
      );
  }

  function hasEvent(id: string): boolean {
    const row = repo
      .getRawDb()
      .query('SELECT id FROM review_schedule_events WHERE id = ?')
      .get(id) as { id: string } | null;
    return row !== null;
  }

  const tick = async (): Promise<void> => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 10));
  };

  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  it('withTransaction：多写 + 中间 await，成功即整体提交并透传返回值', async () => {
    const value = await repo.withTransaction(async () => {
      insertEvent('tx_commit_a');
      await tick();
      insertEvent('tx_commit_b');
      await tick();
      return 42;
    });
    expect(value).toBe(42);
    expect(hasEvent('tx_commit_a')).toBe(true);
    expect(hasEvent('tx_commit_b')).toBe(true);
  });

  it('withTransaction：await 之后故意失败，两次写入全部回滚', async () => {
    const err = await repo
      .withTransaction(async () => {
        insertEvent('tx_rollback_a');
        await tick();
        insertEvent('tx_rollback_b');
        await tick();
        throw new Error('boom-tx');
      })
      .then(
        () => null,
        (e: unknown) => e
      );
    expect(err instanceof Error).toBe(true);
    expect(hasEvent('tx_rollback_a')).toBe(false);
    expect(hasEvent('tx_rollback_b')).toBe(false);
  });

  it('withSavepointSandbox：成功也无条件回滚（语义保持）', async () => {
    const value = await repo.withSavepointSandbox(async () => {
      insertEvent('tx_sandbox_a');
      await tick();
      return 'done';
    });
    expect(value).toBe('done');
    expect(hasEvent('tx_sandbox_a')).toBe(false);
  });

  it('嵌套：外层提交 + 内层沙箱回滚互不干扰', async () => {
    await repo.withTransaction(async () => {
      insertEvent('tx_nest_outer');
      await tick();
      await repo.withSavepointSandbox(async () => {
        insertEvent('tx_nest_inner');
        await tick();
      });
      await tick();
    });
    expect(hasEvent('tx_nest_outer')).toBe(true);
    expect(hasEvent('tx_nest_inner')).toBe(false);
  });

  it('嵌套：内层事务失败则整棵回滚', async () => {
    const err = await repo
      .withTransaction(async () => {
        insertEvent('tx_nest2_outer');
        await tick();
        await repo.withTransaction(async () => {
          insertEvent('tx_nest2_inner');
          await tick();
          throw new Error('boom-inner');
        });
      })
      .then(
        () => null,
        (e: unknown) => e
      );
    expect(err instanceof Error).toBe(true);
    expect(hasEvent('tx_nest2_outer')).toBe(false);
    expect(hasEvent('tx_nest2_inner')).toBe(false);
  });

  it('串行隔离：第二次失败不影响第一次已提交', async () => {
    await repo.withTransaction(async () => {
      insertEvent('tx_seq_ok');
    });
    await repo
      .withTransaction(async () => {
        insertEvent('tx_seq_fail');
        throw new Error('boom-seq');
      })
      .then(
        () => null,
        (e: unknown) => e
      );
    expect(hasEvent('tx_seq_ok')).toBe(true);
    expect(hasEvent('tx_seq_fail')).toBe(false);
  });
});
