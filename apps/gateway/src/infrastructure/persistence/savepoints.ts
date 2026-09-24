import type { Database } from 'bun:sqlite';

/**
 * SQLite 异步事务原语（由 DrizzleLearnerRepository 搬迁而来，行为不变）。
 * bun:sqlite 的 transaction() 回调不支持跨 await 持有事务（M4-2 回滚测试实证部分提交），
 * 显式 SAVEPOINT 包裹 await 链才对异步委托链生效；调用方签名与语义不变。
 * 本文件只依赖 bun:sqlite，不引用任何领域模块（G5-R3）。
 */

/** 在独立事务中执行操作（回调 resolve 即提交，throw 即整体回滚）。 */
export async function runWithTransaction<T>(sqlite: Database, fn: () => Promise<T>): Promise<T> {
  const savepoint = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  sqlite.run(`SAVEPOINT ${savepoint};`);
  try {
    const value = await fn();
    sqlite.run(`RELEASE ${savepoint};`);
    return value;
  } catch (e) {
    try {
      sqlite.run(`ROLLBACK TO ${savepoint};`);
    } catch {
      // 回滚语句自身失败已无可为，下面的 RELEASE 尽力清理
    }
    try {
      sqlite.run(`RELEASE ${savepoint};`);
    } catch {
      // 清理失败可忽略：调用方收到的仍是原始错误
    }
    throw e;
  }
}

/** 沙盒执行，完毕后无条件回滚，确保测试数据绝不污染真实数据库。 */
export async function runWithSavepointSandbox<T>(
  sqlite: Database,
  fn: () => Promise<T>
): Promise<T> {
  const savepointName = `sp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  sqlite.run(`SAVEPOINT ${savepointName};`);
  try {
    return await fn();
  } finally {
    sqlite.run(`ROLLBACK TO ${savepointName};`);
    sqlite.run(`RELEASE ${savepointName};`);
  }
}
