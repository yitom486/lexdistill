import { describe, expect, it } from 'bun:test';
import { resolveAllowedExerciseTypes, diffExerciseTypeGap } from '../application/exercise-type-gate.js';

/**
 * 能力-题型门矩阵：等级解锁 × 教材交集 × 强者拓展 × 缺口。
 */
describe('exercise-type-gate（能力-题型门）', () => {
  it('等级逐档解锁：NOVICE 只认读，写作/听写最后', () => {
    expect(resolveAllowedExerciseTypes({ level: 'NOVICE' })).toEqual(['MULTIPLE_CHOICE']);
    expect(resolveAllowedExerciseTypes({ level: 'BEGINNER' })).toEqual([
      'MULTIPLE_CHOICE',
      'FILL_IN_BLANK',
    ]);
    expect(resolveAllowedExerciseTypes({ level: 'INTERMEDIATE' })).toContain('TRANSLATION');
    expect(resolveAllowedExerciseTypes({ level: 'INTERMEDIATE' })).not.toContain('LISTENING_DICTATION');
    expect(resolveAllowedExerciseTypes({ level: 'ADVANCED' })).toContain('LISTENING_DICTATION');
  });

  it('教材约束优先：没写作的教材出不了写作', () => {
    const minna = ['MULTIPLE_CHOICE', 'FILL_IN_BLANK', 'LISTENING_DICTATION'];
    expect(resolveAllowedExerciseTypes({ level: 'ADVANCED', textbookTypes: minna }).sort()).toEqual(
      [...minna].sort()
    );
    // 初级 + 教材只有选择：填空也被教材卡掉
    expect(resolveAllowedExerciseTypes({ level: 'BEGINNER', textbookTypes: ['MULTIPLE_CHOICE'] })).toEqual([
      'MULTIPLE_CHOICE',
    ]);
  });

  it('未知教材（空数组）不过滤，只按 BASE', () => {
    expect(resolveAllowedExerciseTypes({ level: 'BEGINNER', textbookTypes: [] })).toEqual([
      'MULTIPLE_CHOICE',
      'FILL_IN_BLANK',
    ]);
  });

  it('强者拓展只高一档：BEGINNER 可吃 SHORT.../INTERMEDIATE 档，NOVICE 吃不到 INTERMEDIATE', () => {
    const expanded = resolveAllowedExerciseTypes({ level: 'BEGINNER', allowExpansion: true });
    expect(expanded).toContain('TRANSLATION');
    expect(expanded).not.toContain('LISTENING_DICTATION');
    const novice = resolveAllowedExerciseTypes({ level: 'NOVICE', allowExpansion: true });
    expect(novice).toContain('FILL_IN_BLANK');
    expect(novice).not.toContain('TRANSLATION');
    // ADVANCED 已顶，无更高档可加
    expect(resolveAllowedExerciseTypes({ level: 'ADVANCED', allowExpansion: true })).toEqual(
      resolveAllowedExerciseTypes({ level: 'ADVANCED' })
    );
  });

  it('未知题型 fail-closed：不在 BASE 即使教材有也不出', () => {
    expect(
      resolveAllowedExerciseTypes({ level: 'ADVANCED', textbookTypes: ['MULTIPLE_CHOICE', 'ESSAY'] })
    ).toEqual(['MULTIPLE_CHOICE']);
  });

  it('缺口 = 允许 − 已有；零缺口不生产', () => {
    expect(diffExerciseTypeGap(['MULTIPLE_CHOICE', 'FILL_IN_BLANK'], ['MULTIPLE_CHOICE'])).toEqual([
      'FILL_IN_BLANK',
    ]);
    expect(diffExerciseTypeGap(['MULTIPLE_CHOICE'], ['MULTIPLE_CHOICE', 'FILL_IN_BLANK'])).toEqual([]);
  });
});
