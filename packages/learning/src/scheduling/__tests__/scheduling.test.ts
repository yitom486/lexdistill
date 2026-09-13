import { describe, expect, it } from 'bun:test';
import { isOk } from '@study-studio/shared';
import { scheduleFsrsReviewV1 } from '../index.js';

/**
 * M6-1 版本化复习排程应用入口（自 learner-core 迁入；C6 起归属 learning/src/scheduling，行为不变）。
 * - 输出含 fsrs/1.0.0 版本戳与确定性 trace；
 * - 不依赖 learner-core：此处不用 learner-core 旧裸函数作 oracle，
 *   只断言版本戳、trace 自洽（输入快照/输出/评估时刻）与确定性。
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

describe('M6-1 scheduleFsrsReviewV1', () => {
  it('输出含版本戳与自洽 trace', () => {
    const res = scheduleFsrsReviewV1({ state: INIT, rating: 'GOOD', now: NOW });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.algorithmId).toBe('fsrs');
    expect(res.value.algorithmVersion).toBe('1.0.0');
    expect(res.value.trace.algorithmId).toBe('fsrs');
    expect(res.value.trace.algorithmVersion).toBe('1.0.0');
    expect(res.value.trace.evaluatedAt).toBe('2026-09-07T12:00:00.000Z');
    expect(res.value.trace.rating).toBe('GOOD');
    expect(res.value.trace.inputState).toEqual(INIT);
    expect(res.value.trace.outputState).toEqual(res.value.state);
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
