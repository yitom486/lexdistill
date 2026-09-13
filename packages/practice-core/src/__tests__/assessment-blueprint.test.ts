import { describe, it, expect } from 'bun:test';
import { evaluateExamVerdict, type GroupSubscore } from '../index.js';

function group(over: Partial<GroupSubscore> = {}): GroupSubscore {
  return {
    key: 'g1',
    label: '测试组',
    items: 4,
    distinct: 4,
    graded: 4,
    correct: 3,
    minCorrect: 3,
    thin: false,
    met: true,
    ...over,
  };
}

/** 晋级判定：总分线 + 覆盖充足的组全达线 + 字母线；题量不足直接阻断。 */
describe('evaluateExamVerdict', () => {
  it('全达标通过', () => {
    const v = evaluateExamVerdict(0.85, 0.8, [group()], true);
    expect(v.passed).toBe(true);
    expect(v.failReasons).toEqual([]);
  });

  it('总分不够阻断', () => {
    const v = evaluateExamVerdict(0.7, 0.8, [group()], true);
    expect(v.passed).toBe(false);
    expect(v.failReasons.join('')).toContain('总正确率');
  });

  it('覆盖组未达标阻断（一票否决）', () => {
    const v = evaluateExamVerdict(0.9, 0.8, [group({ correct: 2, graded: 4, met: false })], true);
    expect(v.passed).toBe(false);
    expect(v.failReasons.join('')).toContain('未达标');
  });

  it('题量不足直接阻断（不得跳过缩小分母）', () => {
    // thin：即使答对率 100% 也不可晋级
    const thin = evaluateExamVerdict(
      1.0,
      0.8,
      [group({ distinct: 2, graded: 2, correct: 2, thin: true, met: false })],
      true
    );
    expect(thin.passed).toBe(false);
    expect(thin.failReasons.join('')).toContain('题量不足');
    // 未覆盖（0 题）：同样阻断
    const uncovered = evaluateExamVerdict(
      1.0,
      0.8,
      [group({ distinct: 0, graded: 0, correct: 0, thin: true, met: false })],
      true
    );
    expect(uncovered.passed).toBe(false);
    expect(uncovered.failReasons.join('')).toContain('无有效题目');
  });

  it('字母线不过阻断', () => {
    const v = evaluateExamVerdict(1.0, 0.8, [group()], false);
    expect(v.passed).toBe(false);
    expect(v.failReasons.join('')).toContain('字母');
  });

  it('无蓝图老卷只看总分', () => {
    expect(evaluateExamVerdict(0.8, 0.8, [], true).passed).toBe(true);
    expect(evaluateExamVerdict(0.79, 0.8, [], true).passed).toBe(false);
  });
});
