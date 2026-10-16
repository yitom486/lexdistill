import type { LearnerLevel } from '@lexdistill/protocol';
import { isOk, type Result, type BusinessError } from '@lexdistill/shared';

/**
 * 组卷难度门（教学-first hotfix，见学习闭环“先讲后测”定位）。
 *
 * 问题：自适应出题 / 题池展示 / 装配链只看“错题标签 + 难度数字”，不看学习者
 * 档位——NOVICE 第 1 天能抽到 N4「～たら」变形题。门只做一件事：系统替用户
 * 选考点时，超纲的不出；用户自己点的专项 / 定级考不受影响（调用方豁免）。
 *
 * 两道闸：
 * 1. 技能闸：已知语法点按 JLPT/CEFR/TOPIK 公开分级定最低档（静态语言学
 *    数据，登记见 STATIC 清单；未来由教材解析/课程图谱动态化）；
 * 2. 难度闸：tier 上限 NOVICE 2 / BEGINNER 3 / INTERMEDIATE 4 / ADVANCED 5。
 * 未知技能只走难度闸（不断新内容活路）；缺 tier 按 3 计。
 */

export const GATE_LEVEL_ORDER: LearnerLevel[] = ['NOVICE', 'BEGINNER', 'INTERMEDIATE', 'ADVANCED'];

const TIER_CAP: Record<LearnerLevel, number> = {
  NOVICE: 2,
  BEGINNER: 3,
  INTERMEDIATE: 4,
  ADVANCED: 5,
};

/** 语法点 → 最低可出档（公开分级常识；N5≈NOVICE，N4≈BEGINNER，N3≈INTERMEDIATE）。 */
const SKILL_MIN_LEVEL: Record<string, LearnerLevel> = {
  'jp.particle.ni_vs_de': 'NOVICE',
  'jp.particle.destination': 'NOVICE',
  'jp.particle.destination_ni': 'NOVICE',
  'jp.particle.ka': 'NOVICE',
  'jp.particle.no': 'NOVICE',
  'jp.grammar.reason_kara': 'NOVICE',
  'jp.grammar.tense': 'NOVICE',
  'jp.keigo.self_introduction': 'NOVICE',
  'ko.grammar.particle_eseo': 'NOVICE',
  'en.grammar.article': 'NOVICE',
  'en.vocab.collocation': 'NOVICE',
  'en.grammar.connector': 'NOVICE',
  'jp.grammar.conditional_tara': 'BEGINNER',
  'jp.grammar.causative_active': 'INTERMEDIATE',
  'en.grammar.subjunctive': 'INTERMEDIATE',
  'en.grammar.inversion': 'INTERMEDIATE',
};

/** 这些家族天然跟档位走（生词/句子/字母/复习/阅读难度由内容与 tier 承担）。 */
const NOVICE_FAMILIES = [
  '.vocab.',
  '.sentence.',
  '.kana.',
  '.hangul.',
  '.alphabet.',
  '.review',
  '.reading.',
  '.dictation.',
  '.listening.',
];

/** 系统自动降级时的各轨道安全默认考点（模板库均有 tier2 现货）。 */
export const NOVICE_SAFE_SKILL: Record<'ja' | 'en' | 'ko', string> = {
  ja: 'jp.particle.ni_vs_de',
  ko: 'ko.grammar.particle_eseo',
  en: 'en.grammar.article',
};

function levelIndex(level: LearnerLevel): number {
  const i = GATE_LEVEL_ORDER.indexOf(level);
  return i < 0 ? 0 : i;
}

/** 技能最低档（未知返回 null → 只走难度闸）。 */
export function minLevelForSkill(skillId: string | null | undefined): LearnerLevel | null {
  if (!skillId) return null;
  const exact = SKILL_MIN_LEVEL[skillId];
  if (exact) return exact;
  if (NOVICE_FAMILIES.some((f) => skillId.includes(f))) return 'NOVICE';
  return null;
}

/** 已知技能 id（分类/映射类任务的允许集合；课程讲义技能另从 curriculum_lessons 取）。 */
export function listKnownSkillIds(): string[] {
  return Object.keys(SKILL_MIN_LEVEL);
}

export function tierCapForLevel(level: LearnerLevel): number {
  return TIER_CAP[level] ?? 2;
}

export function isSkillAllowedForLevel(
  skillId: string | null | undefined,
  level: LearnerLevel
): boolean {
  const min = minLevelForSkill(skillId);
  if (!min) return true;
  return levelIndex(level) >= levelIndex(min);
}

/** 单题判定（技能闸 + 难度闸同时过）。 */
export function isQuestionAllowedForLevel(
  skillId: string | null | undefined,
  tier: number | null | undefined,
  level: LearnerLevel
): boolean {
  if (!isSkillAllowedForLevel(skillId, level)) return false;
  const t = typeof tier === 'number' && Number.isFinite(tier) ? tier : 3;
  return t <= tierCapForLevel(level);
}

/** 批量过滤（保留原顺序；调用方决定空集语义：降级或记 skipped）。 */
export function filterQuestionsByLevel<T>(
  items: T[],
  level: LearnerLevel,
  pick: (q: T) => { skillId: string | null | undefined; tier: number | null | undefined }
): T[] {
  return items.filter((q) => {
    const { skillId, tier } = pick(q);
    return isQuestionAllowedForLevel(skillId, tier, level);
  });
}

const LEVEL_TOKENS: Array<{ level: LearnerLevel; tokens: string[] }> = [
  { level: 'NOVICE', tokens: ['NOVICE', 'N5', 'A1', 'TOPIK 1', 'TOPIK 2', 'TOPIK1', 'TOPIK2', '入门', '零基础'] },
  { level: 'BEGINNER', tokens: ['BEGINNER', 'N4', 'A2', 'TOPIK 3', 'TOPIK3', '初级'] },
  { level: 'INTERMEDIATE', tokens: ['INTERMEDIATE', 'N3', 'B1', 'B2', 'TOPIK 4', 'TOPIK4', '中级'] },
  { level: 'ADVANCED', tokens: ['ADVANCED', 'N2', 'N1', 'C1', 'C2', 'TOPIK 5', 'TOPIK 6', '高级'] },
];

/**
 * 前端传来的等级标签（CEFR B1 / JLPT N3 / N5 / 初级……）→ 档位。
 * 解析不出返回 null（调用方再定缺省，不要在这里猜）。
 * 注意：'N1' 包含 'N1' 子串检查要在 'N5' 之前无冲突——各 token 互不为子串，
 * 唯 'TOPIK 1' 是 'TOPIK 10+' 前缀，现实无此值，可接受。
 */
export function parseLevelLabel(raw: unknown): LearnerLevel | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toUpperCase();
  if (!v) return null;
  for (const { level, tokens } of LEVEL_TOKENS) {
    if (tokens.some((t) => v.includes(t))) return level;
  }
  return null;
}

/**
 * 门用档位解析：档位 SSOT（网关画像）优先，前端标签兜底，
 * 都拿不到按 NOVICE 从简供题（教学-first：宁 shallow 勿劝退；
 * 定级考与用户自选专项由调用方豁免，不走这里）。
 */
export function resolveGateLevel(
  known: LearnerLevel | null | undefined,
  fallbackLabel: unknown
): LearnerLevel {
  if (known && (GATE_LEVEL_ORDER as string[]).includes(known)) return known;
  return parseLevelLabel(fallbackLabel) ?? 'NOVICE';
}

/** 出题门快照（网关一次取齐：档位 + 已学完 + 本轨道有讲义）。 */
export interface StudyGateSnapshot {
  level: LearnerLevel;
  completedSkills: string[];
  lessonSkills: string[];
}

/** 门数据源（LearnerRepository 可选能力；缺实现时调用方降级为纯档位门）。 */
export interface StudyGateSource {
  getStudyGate?: (
    userId: string,
    language: string
  ) => Promise<Result<StudyGateSnapshot, BusinessError>>;
}

export interface ResolvedStudyGate {
  level: LearnerLevel;
  completed: Set<string>;
  lessons: Set<string>;
}

/**
 * 门快照解析（各出题口统一入口）：
 * 快照拿到 → 档位 + 讲义锁全量生效；拿不到 → 档位标签兜底、讲义锁 fail-open（旧行为）。
 */
export async function resolveStudyGate(
  source: StudyGateSource,
  userId: string,
  language: string,
  fallbackLabel: unknown
): Promise<ResolvedStudyGate> {
  const open = (level: LearnerLevel): ResolvedStudyGate => ({
    level,
    completed: new Set(),
    lessons: new Set(),
  });
  try {
    const res = await source.getStudyGate?.(userId, language);
    if (!res) return open(resolveGateLevel(null, fallbackLabel));
    if (isOk(res)) {
      return {
        level: resolveGateLevel(res.value.level, fallbackLabel),
        completed: new Set(res.value.completedSkills),
        lessons: new Set(res.value.lessonSkills),
      };
    }
    return open(resolveGateLevel(null, fallbackLabel));
  } catch {
    return open(resolveGateLevel(null, fallbackLabel));
  }
}

/**
 * 讲义锁（先讲后测）：本轨道有讲义且未学完 → 系统代选不出该技能的题。
 * 无讲义的技能永远不锁（不断新内容活路）；用户自选/课内小测/定级考/自家卡由调用方豁免。
 */
export function isLessonLocked(
  skillId: string | null | undefined,
  gate: Pick<ResolvedStudyGate, 'completed' | 'lessons'>
): boolean {
  if (!skillId) return false;
  return gate.lessons.has(skillId) && !gate.completed.has(skillId);
}

/** 单题完整判定（档位门 + 讲义锁同时过）。 */
export function isQuestionAllowed(
  skillId: string | null | undefined,
  tier: number | null | undefined,
  level: LearnerLevel,
  gate: Pick<ResolvedStudyGate, 'completed' | 'lessons'>
): boolean {
  if (isLessonLocked(skillId, gate)) return false;
  return isQuestionAllowedForLevel(skillId, tier, level);
}
