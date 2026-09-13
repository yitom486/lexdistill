import { describe, expect, it } from 'bun:test';
import { isOk } from '@study-studio/shared';
import { updateKanaPracticeMemory } from '@study-studio/learner-core';
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

/**
 * C6 一致性锁：learner-core/kana-adaptive 内联的 7 行 FSRS 委托必须与正典入口
 * 逐行同义（同内核、同版本 pin、同入参）。方向注意：此处以正典入口为 oracle
 * 断言 kana 侧（与文件头“不用 learner-core 作 oracle”不冲突——被测对象是入口，
 * kana 只是内联正确性的见证方）。
 */
describe('C6 kana-adaptive 内联委托与正典入口一致', () => {
  it('答对路径：kana 透传的 fsrs 与正典入口输出全等', () => {
    const memory = updateKanaPracticeMemory({ fsrs: INIT, consecutiveErrors: 0 }, true, NOW);
    const direct = scheduleFsrsReviewV1({ state: INIT, rating: 'GOOD', now: NOW });
    expect(isOk(direct)).toBe(true);
    if (!isOk(direct)) return;
    expect(memory.fsrs).toEqual(direct.value.state);
    expect(memory.consecutiveErrors).toBe(0);
  });

  it('答错路径：短重学覆盖 10 分钟且首轮为 LEARNING', () => {
    const memory = updateKanaPracticeMemory({ fsrs: INIT, consecutiveErrors: 0 }, false, NOW);
    expect(memory.fsrs.state).toBe('LEARNING');
    expect(memory.fsrs.dueAt).toBe(new Date(NOW.getTime() + 10 * 60 * 1000).toISOString());
    expect(memory.consecutiveErrors).toBe(1);
  });
});
