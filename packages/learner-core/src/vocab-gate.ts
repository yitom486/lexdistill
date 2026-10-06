import type { LearnerLevel, JlptLevel } from '@study-studio/protocol';
import { GATE_LEVEL_ORDER } from './skill-gate.js';

/**
 * 词汇门（与题目门同源：同一档位排序、同一阈值求值语义；输入不同而已）。
 *
 * - 题目门输入：skillId + tier；词汇门输入：JLPT + 掌握率。
 * - 等级一元化：JLPT N5..N1 用同一序数比较，不另起等级体系；
 *   档位↔JLPT 的对应只在此一处（LEVEL_JLPT_CEILING）。
 * - 掌握率单一定義见 masterableRatio：分子分母口径由调用方（storage 适配器）
 *   按同一规则统计，画像展示与门判定共用，互不漂移。
 */

export const JLPT_ORDER: JlptLevel[] = ['N5', 'N4', 'N3', 'N2', 'N1'];

/** 档位天然天花板（N2/N1 同属 ADVANCED，一步到位）。 */
export const LEVEL_JLPT_CEILING: Record<LearnerLevel, JlptLevel> = {
  NOVICE: 'N5',
  BEGINNER: 'N4',
  INTERMEDIATE: 'N3',
  ADVANCED: 'N1',
};

/** 天花板等级掌握率达标即再开一级（封顶 N1）。具名阈值，禁魔法数字。 */
export const MASTERY_UNLOCK_RATIO = 0.8;
/** 稳定性（FSRS stability，天）≥ 该值视为掌握该词。 */
export const MASTERED_STABILITY_DAYS = 21;

export function jlptIndex(jlpt: string | null | undefined): number {
  if (!jlpt) return -1;
  return JLPT_ORDER.indexOf(jlpt.trim().toUpperCase() as JlptLevel);
}

export function gateLevelIndex(level: LearnerLevel): number {
  const i = GATE_LEVEL_ORDER.indexOf(level);
  return i < 0 ? 0 : i;
}

export interface VocabMastery {
  jlpt: JlptLevel;
  total: number;
  stable: number;
}

/**
 * 掌握率：空级视为 1（该级无词不断活路；调用方传 total=0 即此语义）。
 * 分子分母含卡与未收词：total = 该级全局词数，stable = 其中 FSRS 达标卡数。
 */
export function masteryRatio(total: number, stable: number): number {
  if (total <= 0) return 1;
  if (stable <= 0) return 0;
  return Math.min(1, stable / total);
}

/** 已解锁最高 JLPT：天花板起，天花板达标再开一级；逐日重算，自然爬梯。 */
export function unlockedJlptMax(userLevel: LearnerLevel, mastery: VocabMastery[]): JlptLevel {
  const ceiling = LEVEL_JLPT_CEILING[userLevel] ?? 'N5';
  let max = jlptIndex(ceiling);
  const byJlpt = new Map(mastery.map(entry => [entry.jlpt, entry] as const));
  const current = byJlpt.get(ceiling);
  if (current && masteryRatio(current.total, current.stable) >= MASTERY_UNLOCK_RATIO && max < JLPT_ORDER.length - 1) {
    max += 1;
  }
  return JLPT_ORDER[max] ?? 'N5';
}

/** 单词放行：未知等级放行（内容不断活路，与未知技能只走难度闸同哲学）。 */
export function isVocabularyAllowed(
  jlpt: string | null | undefined,
  userLevel: LearnerLevel,
  mastery: VocabMastery[]
): boolean {
  const index = jlptIndex(jlpt);
  if (index < 0) return true;
  return index <= jlptIndex(unlockedJlptMax(userLevel, mastery));
}
