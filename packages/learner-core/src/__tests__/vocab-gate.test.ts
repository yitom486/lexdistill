import { describe, expect, it } from 'bun:test';
import {
  JLPT_ORDER,
  MASTERED_STABILITY_DAYS,
  MASTERY_UNLOCK_RATIO,
  gateLevelIndex,
  isVocabularyAllowed,
  jlptIndex,
  masteryRatio,
  unlockedJlptMax,
  type VocabMastery,
} from '../vocab-gate.js';

const mastery = (jlpt: VocabMastery['jlpt'], total: number, stable: number): VocabMastery => ({ jlpt, total, stable });

describe('vocab-gate', () => {
  it('档位天花板：NOVICE 到 N5，ADVANCED 直达 N1', () => {
    expect(unlockedJlptMax('NOVICE', [])).toBe('N5');
    expect(unlockedJlptMax('BEGINNER', [])).toBe('N4');
    expect(unlockedJlptMax('INTERMEDIATE', [])).toBe('N3');
    expect(unlockedJlptMax('ADVANCED', [])).toBe('N1');
  });

  it('天花板掌握率达标再开一级；边界 0.8 开，0.8 以下不开', () => {
    expect(MASTERY_UNLOCK_RATIO).toBe(0.8);
    expect(unlockedJlptMax('NOVICE', [mastery('N5', 10, 8)])).toBe('N4');
    expect(unlockedJlptMax('NOVICE', [mastery('N5', 100, 79)])).toBe('N5');
    expect(unlockedJlptMax('ADVANCED', [mastery('N1', 10, 10)])).toBe('N1');
  });

  it('空级视为通过（不断活路），逐日重算自然爬梯', () => {
    expect(unlockedJlptMax('NOVICE', [mastery('N5', 0, 0)])).toBe('N4');
    expect(masteryRatio(0, 0)).toBe(1);
    expect(masteryRatio(10, 0)).toBe(0);
    expect(masteryRatio(10, 20)).toBe(1);
  });

  it('单次放行：未知等级放行；门内放行，门外拦截', () => {
    const noMastery: VocabMastery[] = [];
    expect(isVocabularyAllowed(null, 'NOVICE', noMastery)).toBe(true);
    expect(isVocabularyAllowed('??', 'NOVICE', noMastery)).toBe(true);
    expect(isVocabularyAllowed('N5', 'NOVICE', noMastery)).toBe(true);
    expect(isVocabularyAllowed('N4', 'NOVICE', noMastery)).toBe(false);
    const unlocked = [mastery('N5', 10, 8)];
    expect(isVocabularyAllowed('N4', 'NOVICE', unlocked)).toBe(true);
    expect(isVocabularyAllowed('N3', 'NOVICE', unlocked)).toBe(false);
  });

  it('序数与阈值常量有据可查', () => {
    expect(JLPT_ORDER).toEqual(['N5', 'N4', 'N3', 'N2', 'N1']);
    expect(jlptIndex('n4')).toBe(1);
    expect(jlptIndex(null)).toBe(-1);
    expect(gateLevelIndex('INTERMEDIATE')).toBe(2);
    expect(MASTERED_STABILITY_DAYS).toBe(21);
  });
});
