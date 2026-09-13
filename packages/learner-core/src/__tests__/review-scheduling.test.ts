import { describe, expect, it } from 'bun:test';
import { updateKanaPracticeMemory } from '../index.js';

/**
 * M6-1 learner-core 兼容行为测试（纯版本化入口测试已随实现迁入 learning）。
 * - kana 经兼容出口排程，结果与既有行为一致（含 10 分钟短重学覆盖）。
 */
const NOW = new Date('2026-09-07T12:00:00.000Z');

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
