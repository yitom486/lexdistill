import { describe, expect, it, beforeEach } from 'bun:test';
import { isOk } from '@study-studio/shared';
import { scheduleFsrsReviewV1, type FsrsState } from '@study-studio/learning';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import type { Flashcard } from '@study-studio/protocol';

/**
 * M4-2 复习提交原子命令集成测试（真 :memory: 库）。
 * - 成功：卡片 FSRS、排程事件、每日 activity 三项同事务落库；
 * - 同一输入重放：事件主键冲突 → 整体回滚（卡片保持首次状态、activity 不多记、事件仍一条）。
 */
describe('M4-2 commitReviewOutcome', () => {
  let repo: DrizzleLearnerRepository;
  const userId = 'rco_user';
  const NOW = new Date('2026-09-07T12:00:00.000Z');

  const SEED_FSRS: FsrsState = {
    stability: 1,
    difficulty: 5,
    reps: 1,
    lapses: 0,
    dueAt: '2026-09-07T11:00:00.000Z',
    state: 'REVIEW',
  };

  function card(id: string): Flashcard {
    return {
      id,
      userId,
      type: 'VOCABULARY',
      front: 'a',
      back: 'b',
      phonetic: undefined,
      audioUrl: undefined,
      tags: [],
      fsrs: SEED_FSRS,
    };
  }

  function eventRows(cardId: string): Array<Record<string, unknown>> {
    return repo
      .getRawDb()
      .query('SELECT * FROM review_schedule_events WHERE card_id = ? ORDER BY created_at')
      .all(cardId) as Array<Record<string, unknown>>;
  }

  function activityCards(): number {
    const rows = repo
      .getRawDb()
      .query('SELECT cards_reviewed_count AS n FROM study_activity_logs WHERE user_id = ?')
      .all(userId) as Array<{ n: number }>;
    return rows.reduce((sum, r) => sum + r.n, 0);
  }

  async function dueCard(id: string): Promise<Flashcard> {
    const res = await repo.getDueCards(userId, 200);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) throw new Error('getDueCards failed');
    const found = res.value.find((c) => c.id === id);
    expect(found).toBeDefined();
    return found as Flashcard;
  }

  beforeEach(async () => {
    repo = new DrizzleLearnerRepository(':memory:');
    await repo.updateLearnerProfile(userId, { targetLanguage: 'ja' });
    const saved = await repo.saveCard(card('card-1'));
    expect(isOk(saved)).toBe(true);
  });

  it('成功时三项同写：卡片 state、事件全字段、activity 计数', async () => {
    const scheduled = scheduleFsrsReviewV1({
      state: SEED_FSRS,
      rating: 'GOOD',
      now: NOW,
    });
    expect(isOk(scheduled)).toBe(true);
    if (!isOk(scheduled)) return;
    const nextCard = { ...card('card-1'), fsrs: scheduled.value.state };
    const res = await repo.commitReviewOutcome({
      userId,
      card: nextCard,
      rating: 'GOOD',
      scheduled: scheduled.value,
    });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.cardId).toBe('card-1');
    expect(res.value.eventId).toBe('rse_card-1_2026-09-07T12:00:00.000Z');

    const stored = await dueCard('card-1');
    expect(stored.fsrs).toEqual(scheduled.value.state);

    const events = eventRows('card-1');
    expect(events).toHaveLength(1);
    const ev = events[0] as Record<string, unknown>;
    expect(ev['user_id']).toBe(userId);
    expect(ev['card_id']).toBe('card-1');
    expect(ev['language']).toBe('ja');
    expect(ev['algorithm_id']).toBe('fsrs');
    expect(ev['algorithm_version']).toBe('1.0.0');
    expect(ev['rating']).toBe('GOOD');
    expect(JSON.parse(ev['input_state_json'] as string)).toEqual(SEED_FSRS);
    expect(JSON.parse(ev['output_state_json'] as string)).toEqual(scheduled.value.state);
    expect(ev['evaluated_at']).toBe('2026-09-07T12:00:00.000Z');
    expect(typeof ev['created_at']).toBe('string');

    expect(activityCards()).toBe(1);
  });

  it('同一输入重放：事件冲突则卡片与 activity 均回滚', async () => {
    const scheduled = scheduleFsrsReviewV1({
      state: SEED_FSRS,
      rating: 'GOOD',
      now: NOW,
    });
    expect(isOk(scheduled)).toBe(true);
    if (!isOk(scheduled)) return;
    const first = await repo.commitReviewOutcome({
      userId,
      card: { ...card('card-1'), fsrs: scheduled.value.state },
      rating: 'GOOD',
      scheduled: scheduled.value,
    });
    expect(isOk(first)).toBe(true);

    // 第二次用更进一步的 state 但同一 evaluatedAt：存卡本可成功，
    // 事件主键冲突必须整体回滚。
    const further = scheduleFsrsReviewV1({
      state: scheduled.value.state,
      rating: 'AGAIN',
      now: NOW,
    });
    expect(isOk(further)).toBe(true);
    if (!isOk(further)) return;
    const second = await repo.commitReviewOutcome({
      userId,
      card: { ...card('card-1'), fsrs: further.value.state },
      rating: 'AGAIN',
      scheduled: further.value,
    });
    expect(isOk(second)).toBe(false);

    const stored = await dueCard('card-1');
    expect(stored.fsrs).toEqual(scheduled.value.state);
    expect(eventRows('card-1')).toHaveLength(1);
    expect(activityCards()).toBe(1);
  });
});
