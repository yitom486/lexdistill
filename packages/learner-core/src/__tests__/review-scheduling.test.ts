import { describe, expect, it } from 'bun:test';
import { isOk } from '@study-studio/shared';
import { scheduleNextReview } from '../index.js';
import { scheduleFsrsReviewV1 } from '../index.js';
import { updateKanaPracticeMemory } from '../index.js';

/**
 * M3-2 版本化复习排程应用入口。
 * - 输出含 fsrs/1.0.0 版本戳与确定性 trace；
 * - kana 经新入口排程，结果与既有行为一致（含 10 分钟短重学覆盖）。
 */
const NOW = new Date('2026-09-07T12:00:00.000Z');

const INIT = {
  stability: 1.0,
  difficulty: 5.0,
  reps: 0,
  lapses: 0,
  dueAt: '2026-09-07T12:00:00.000Z',
  state: 'NEW' as const,
};

describe('M3-2 scheduleFsrsReviewV1', () => {
  it('输出含版本戳与确定性 trace，状态与裸函数一致', () => {
    const res = scheduleFsrsReviewV1({ state: INIT, rating: 'GOOD', now: NOW });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.algorithmId).toBe('fsrs');
    expect(res.value.algorithmVersion).toBe('1.0.0');
    expect(res.value.state).toEqual(scheduleNextReview(INIT, 'GOOD', NOW));
    expect(res.value.trace.algorithmId).toBe('fsrs');
    expect(res.value.trace.algorithmVersion).toBe('1.0.0');
    expect(res.value.trace.evaluatedAt).toBe('2026-09-07T12:00:00.000Z');
  });

  it('同输入连跑两次输出全等（含 trace）', () => {
    const first = scheduleFsrsReviewV1({ state: INIT, rating: 'AGAIN', now: NOW });
    const second = scheduleFsrsReviewV1({ state: INIT, rating: 'AGAIN', now: NOW });
    expect(isOk(first)).toBe(true);
    expect(isOk(second)).toBe(true);
    if (!isOk(first) || !isOk(second)) return;
    expect(second.value).toEqual(first.value);
  });
});

describe('M3-2 kana 经版本化入口（行为兼容）', () => {
  it('答错：LEARNING/短重学 10 分钟/连错 1', () => {
    const memory = updateKanaPracticeMemory(undefined, false, NOW);
    expect(memory.fsrs.state).toBe('LEARNING');
    expect(memory.fsrs.reps).toBe(1);
    expect(memory.fsrs.lapses).toBe(1);
    expect(memory.fsrs.dueAt).toBe('2026-09-07T12:10:00.000Z');
    expect(memory.consecutiveErrors).toBe(1);
  });

  it('答对：REVIEW/两天后到期/清连错', () => {
    const memory = updateKanaPracticeMemory(undefined, true, NOW);
    expect(memory.fsrs.state).toBe('REVIEW');
    expect(memory.fsrs.reps).toBe(1);
    expect(memory.fsrs.dueAt).toBe('2026-09-09T12:00:00.000Z');
    expect(memory.consecutiveErrors).toBe(0);
  });
});
