import { eq } from 'drizzle-orm';
import {
  ok,
  err,
  isOk,
  type Result,
  BusinessError,
  translateToBusinessError,
} from '@study-studio/shared';
import type { Flashcard, CardReviewRating } from '@study-studio/protocol';
import type { FsrsState, SchedulerOutput } from '@study-studio/learning-algorithms';
import { reviewScheduleEvents } from '@study-studio/storage-sqlite';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';

/**
 * 复习提交原子命令（review 域，由 DrizzleLearnerRepository 搬迁而来，行为不变）：
 * 存卡片 FSRS state + 追加排程事件 + 每日 cards 计数，同一事务；任一步失败整体回滚。
 * 原子实现用显式 SAVEPOINT 包裹 await 链（与 savepoints 同口径）：
 * bun:sqlite 的 transaction() 回调不支持跨 await 持有事务，
 * SAVEPOINT/RELEASE/ROLLBACK TO 才对异步委托链生效。
 * 事件 id 由 (cardId, evaluatedAt) 确定性派生：同一瞬间的重复提交以后到者
 * 主键冲突拒绝，不静默双记。调用方传入已计算的版本化排程结果，本命令不重算。
 * 跨域调用一律走 `deps.repo`（接口方法）；同域互调直接调模块函数。
 */
export async function commitReviewOutcome(
  deps: RepoDeps,
  input: {
    userId: string;
    card: Flashcard;
    rating: CardReviewRating;
    scheduled: SchedulerOutput<FsrsState>;
  }
): Promise<Result<{ cardId: string; eventId: string }, BusinessError>> {
  const eventId = `rse_${input.card.id}_${input.scheduled.trace.evaluatedAt}`;
  const savepoint = `sp_rco_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    deps.sqlite.run(`SAVEPOINT ${savepoint};`);
  } catch (e) {
    return err(translateToBusinessError(e, 'REVIEW_COMMIT'));
  }
  try {
    const saved = await deps.repo.saveCard(input.card);
    if (!isOk(saved)) throw saved.error;
    // 协议 Flashcard 无 language 字段，运行时行可能自带；缺席回退画像语种。
    const runtimeLanguage = (input.card as { language?: unknown }).language;
    const profileRes = await deps.repo.getLearnerProfile(input.userId);
    if (!isOk(profileRes)) throw profileRes.error;
    const language =
      typeof runtimeLanguage === 'string' && runtimeLanguage
        ? runtimeLanguage
        : profileRes.value.targetLanguage;
    await deps.db
      .insert(reviewScheduleEvents)
      .values({
        id: eventId,
        userId: input.userId,
        cardId: input.card.id,
        language,
        algorithmId: input.scheduled.algorithmId,
        algorithmVersion: input.scheduled.algorithmVersion,
        rating: input.rating,
        inputStateJson: JSON.stringify(input.scheduled.trace.inputState),
        outputStateJson: JSON.stringify(input.scheduled.trace.outputState),
        evaluatedAt: input.scheduled.trace.evaluatedAt,
        createdAt: new Date().toISOString(),
      })
      .run();
    // 写断言（AGENTS.md §1.9：同步事务内显式执行 + 行数断言）：同事务回读确认落库。
    const check = await deps.db
      .select({ id: reviewScheduleEvents.id })
      .from(reviewScheduleEvents)
      .where(eq(reviewScheduleEvents.id, eventId))
      .limit(1);
    if (check.length !== 1) {
      throw new BusinessError('E_REVIEW_COMMIT', '排程事件追加未生效', 'DATABASE', false);
    }
    const activity = await deps.repo.recordDailyActivity(input.userId, { cards: 1 });
    if (!isOk(activity)) throw activity.error;
    try {
      deps.sqlite.run(`RELEASE ${savepoint};`);
    } catch (e) {
      return err(translateToBusinessError(e, 'REVIEW_COMMIT'));
    }
    return ok({ cardId: input.card.id, eventId });
  } catch (e) {
    try {
      deps.sqlite.run(`ROLLBACK TO ${savepoint};`);
    } catch {
      // 回滚语句自身失败已无可为，下面的 RELEASE 尽力清理
    }
    try {
      deps.sqlite.run(`RELEASE ${savepoint};`);
    } catch {
      // 清理失败可忽略：连接级错误会经外层 BusinessError 上报
    }
    return err(e instanceof BusinessError ? e : translateToBusinessError(e, 'REVIEW_COMMIT'));
  }
}
