import type { LearnerLevel } from '@study-studio/protocol';

/**
 * 能力-题型门（纯函数）：学习者等级 × 教材原生题型 → 允许题型集。
 *
 * - BASE 按等级解锁（NOVICE 只认读；写作/听写最后）；
 * - 教材约束优先：交集只出教材里有的题型（大家的日语没写作，初级用户永不见写作）；
 * - 能力拓展：allowExpansion=true 时允许高一档（强者吃超纲一档）；跨两档禁止；
 * - 未知题型 fail-closed（deny）：新题型上线必须显式登记到 BASE，否则默认不出。
 *
 * 输入全来自 ContextSnapshot（等级）+ 教材元数据，不读 UI 状态（§1.3）。
 * 组卷（assembly）与出题 Tool 共用同一函数；缺口 = allowed − 已有（缺口是生产信号，不是错误）。
 */
export type ExerciseTypeGateLevel = LearnerLevel;

const BASE_TYPES: Record<ExerciseTypeGateLevel, readonly string[]> = {
  NOVICE: ['MULTIPLE_CHOICE'],
  BEGINNER: ['MULTIPLE_CHOICE', 'FILL_IN_BLANK'],
  INTERMEDIATE: ['MULTIPLE_CHOICE', 'FILL_IN_BLANK', 'SENTENCE_REORDER', 'TRANSLATION'],
  ADVANCED: ['MULTIPLE_CHOICE', 'FILL_IN_BLANK', 'SENTENCE_REORDER', 'TRANSLATION', 'LISTENING_DICTATION'],
};

const LEVEL_ORDER: readonly ExerciseTypeGateLevel[] = ['NOVICE', 'BEGINNER', 'INTERMEDIATE', 'ADVANCED'];

export interface ExerciseTypeGateInput {
  level: ExerciseTypeGateLevel;
  /** 教材原生题型（如大家的日语某册实际含有的）；空数组=未知教材，不过滤（只按 BASE）。 */
  textbookTypes?: string[] | undefined;
  /** 强者拓展：允许高一档题型；缺省 false。 */
  allowExpansion?: boolean | undefined;
}

export function resolveAllowedExerciseTypes(input: ExerciseTypeGateInput): string[] {
  const base = [...BASE_TYPES[input.level]];
  let allowed = base;
  if (input.allowExpansion) {
    const idx = LEVEL_ORDER.indexOf(input.level);
    const next = LEVEL_ORDER[idx + 1];
    if (next) {
      for (const t of BASE_TYPES[next]) {
        if (!allowed.includes(t)) allowed.push(t);
      }
    }
  }
  if (!input.textbookTypes || input.textbookTypes.length === 0) return allowed;
  const native = new Set(input.textbookTypes);
  return allowed.filter((t) => native.has(t));
}

/** 缺口 = 允许集 − 已有集（调用方按缺口驱动 AI 出题；缺口为零不生产，不报错）。 */
export function diffExerciseTypeGap(allowed: readonly string[], existing: readonly string[]): string[] {
  const have = new Set(existing);
  return allowed.filter((t) => !have.has(t));
}
