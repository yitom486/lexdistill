import { describe, expect, it } from 'bun:test';
import { isOk } from '@study-studio/shared';
import {
  FSRS_ALGORITHM_ID,
  FSRS_ALGORITHM_VERSION,
  createFsrsSchedulerV1,
  initFsrsState,
  scheduleNextReview,
  type FsrsState,
} from '../index.js';

/**
 * M3-1 FSRS v1 固定向量（输入固定 → 输出逐字段稳定；版本戳与 trace 随行）。
 * 与 learner-core 既有 fsrs.test.ts 向量一致（迁移前后行为同一）。
 */
const FIXED_NOW = new Date('2026-01-01T00:00:00Z');

function freshState(): FsrsState {
  return {
    stability: 1.0,
    difficulty: 5.0,
    reps: 0,
    lapses: 0,
    dueAt: '2026-01-01T00:00:00.000Z',
    state: 'NEW',
  };
}

describe('M3-1 FSRS v1 fixed vectors', () => {
  it('init 形状稳定（NEW/reps 0/stability 1.0）', () => {
    const card = initFsrsState();
    expect(card.state).toBe('NEW');
    expect(card.reps).toBe(0);
    expect(card.stability).toBe(1.0);
    expect(card.difficulty).toBe(5.0);
  });

  it('GOOD 固定输出（stability 2.2/difficulty 4.8/两天后到期）', () => {
    const next = scheduleNextReview(freshState(), 'GOOD', FIXED_NOW);
    expect(next).toEqual({
      stability: 2.2,
      difficulty: 4.8,
      reps: 1,
      lapses: 0,
      lastReviewedAt: '2026-01-01T00:00:00.000Z',
      dueAt: '2026-01-03T00:00:00.000Z',
      state: 'REVIEW',
    });
  });

  it('AGAIN 固定输出（stability 0.5/difficulty 6.2/次日到期/LEARNING）', () => {
    const next = scheduleNextReview(freshState(), 'AGAIN', FIXED_NOW);
    expect(next).toEqual({
      stability: 0.5,
      difficulty: 6.2,
      reps: 1,
      lapses: 1,
      lastReviewedAt: '2026-01-01T00:00:00.000Z',
      dueAt: '2026-01-02T00:00:00.000Z',
      state: 'LEARNING',
    });
  });

  it('同输入两次输出逐字节一致（确定性）', () => {
    const a = scheduleNextReview(freshState(), 'HARD', FIXED_NOW);
    const b = scheduleNextReview(freshState(), 'HARD', FIXED_NOW);
    expect(a).toEqual(b);
  });
});

describe('M3-1 FSRS v1 scheduler entry', () => {
  it('版本戳 + trace 随行，状态与裸函数一致', () => {
    const scheduler = createFsrsSchedulerV1();
    expect(scheduler.algorithmId).toBe(FSRS_ALGORITHM_ID);
    expect(scheduler.algorithmVersion).toBe(FSRS_ALGORITHM_VERSION);
    expect(FSRS_ALGORITHM_ID).toBe('fsrs');
    expect(FSRS_ALGORITHM_VERSION).toBe('1.0.0');
    const input = freshState();
    const res = scheduler.schedule({
      algorithmId: 'fsrs',
      algorithmVersion: '1.0.0',
      state: input,
      rating: 'GOOD',
      now: FIXED_NOW,
    });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const out = res.value;
    expect(out.algorithmId).toBe('fsrs');
    expect(out.algorithmVersion).toBe('1.0.0');
    expect(out.state).toEqual(scheduleNextReview(freshState(), 'GOOD', FIXED_NOW));
    expect(out.trace.algorithmId).toBe('fsrs');
    expect(out.trace.algorithmVersion).toBe('1.0.0');
    expect(out.trace.inputState).toEqual(input);
    expect(out.trace.outputState).toEqual(out.state);
    expect(out.trace.rating).toBe('GOOD');
    expect(out.trace.evaluatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('相同完整输入连跑两次：含 trace 在内的完整输出全等', () => {
    const scheduler = createFsrsSchedulerV1();
    const first = scheduler.schedule({
      algorithmId: 'fsrs',
      algorithmVersion: '1.0.0',
      state: freshState(),
      rating: 'HARD',
      now: FIXED_NOW,
    });
    const second = scheduler.schedule({
      algorithmId: 'fsrs',
      algorithmVersion: '1.0.0',
      state: freshState(),
      rating: 'HARD',
      now: FIXED_NOW,
    });
    expect(isOk(first)).toBe(true);
    expect(isOk(second)).toBe(true);
    if (!isOk(first) || !isOk(second)) return;
    expect(second.value).toEqual(first.value);
  });

  it('错误算法 ID 或错误版本一律拒绝（不静默计算）', () => {
    const scheduler = createFsrsSchedulerV1();
    const badId = scheduler.schedule({
      algorithmId: 'sm2',
      algorithmVersion: '1.0.0',
      state: freshState(),
      rating: 'GOOD',
      now: FIXED_NOW,
    });
    expect(isOk(badId)).toBe(false);
    if (isOk(badId)) return;
    expect(badId.error.code).toBe('E_ALGORITHM_VERSION');
    const badVersion = scheduler.schedule({
      algorithmId: 'fsrs',
      algorithmVersion: '2.0.0',
      state: freshState(),
      rating: 'GOOD',
      now: FIXED_NOW,
    });
    expect(isOk(badVersion)).toBe(false);
    if (isOk(badVersion)) return;
    expect(badVersion.error.code).toBe('E_ALGORITHM_VERSION');
  });
});
