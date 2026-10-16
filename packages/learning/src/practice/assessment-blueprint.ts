import type { LearnerLevel } from '@lexdistill/protocol';

/**
 * M6-2 自 learner-core 迁入（C6 起归属 learning/src/practice；字节一致，行为不变）。
 *
 * 阶段测评蓝图 v1（先定义考什么，再组卷）。
 * - 每档 = 若干技能组（组内技能 + 题数 + 答对线）+ 机动题 + 总分线；
 * - 组从真实题库存开（pool 种子 + learning.content 模板），库存不足的组装配时
 *   标记 thin（题量不够去重，判线不强制、仅报告），绝不拿重复题凑数判升级；
 * - 答对线为整数（小题量下百分比无意义）；全部阈值为待验证初始参数，
 *   须按真实考生表现校准（见 codex 方案 §5）。
 * - 平行卷：题池浅时重考可能遇到重复题（结果中 distinct 可见）；
 *   真正的平行卷待题池扩充（路线图步骤 5），此处如实报告不伪装。
 */

export const ASSESSMENT_BLUEPRINT_VERSION = 'v1';

export interface BlueprintGroup {
  key: string;
  label: string;
  skillIds: string[];
  items: number;
  minCorrect: number;
}

export interface AssessmentBlueprint {
  version: string;
  track: 'ja' | 'en' | 'ko';
  targetLevel: LearnerLevel;
  /** 总题数（与 examVocabQuestions=20 对齐） */
  totalItems: number;
  /** 总分线（沿用 examPass=0.8，不擅自改口径） */
  overallPass: number;
  groups: BlueprintGroup[];
  /** 机动题数（total - 各组之和，补齐用，不设分项线） */
  flexItems: number;
}

const JA_BEGINNER: AssessmentBlueprint = {
  version: ASSESSMENT_BLUEPRINT_VERSION,
  track: 'ja',
  targetLevel: 'BEGINNER',
  totalItems: 20,
  overallPass: 0.8,
  groups: [
    {
      key: 'particle-basic',
      label: '助词基础',
      skillIds: ['jp.particle.ni_vs_de', 'jp.particle.destination_ni', 'jp.particle.ka', 'jp.particle.no'],
      items: 6,
      minCorrect: 5,
    },
    {
      key: 'kara-keigo',
      label: '原因与敬语',
      skillIds: ['jp.grammar.reason_kara', 'jp.keigo.self_introduction'],
      items: 4,
      minCorrect: 3,
    },
    {
      key: 'tara',
      label: '条件形たら',
      skillIds: ['jp.grammar.conditional_tara'],
      items: 4,
      minCorrect: 3,
    },
  ],
  flexItems: 6,
};

const JA_HIGHER = (targetLevel: LearnerLevel): AssessmentBlueprint => ({
  version: ASSESSMENT_BLUEPRINT_VERSION,
  track: 'ja',
  targetLevel,
  totalItems: 20,
  overallPass: 0.8,
  groups: [
    {
      key: 'particle-basic',
      label: '助词基础',
      skillIds: ['jp.particle.ni_vs_de', 'jp.particle.destination_ni', 'jp.particle.ka', 'jp.particle.no'],
      items: 4,
      minCorrect: 3,
    },
    {
      key: 'tara',
      label: '条件形たら',
      skillIds: ['jp.grammar.conditional_tara'],
      items: 4,
      minCorrect: 3,
    },
    {
      key: 'causative',
      label: '使役态',
      skillIds: ['jp.grammar.causative_active'],
      items: 4,
      minCorrect: 3,
    },
  ],
  flexItems: 8,
});

const EN_BEGINNER: AssessmentBlueprint = {
  version: ASSESSMENT_BLUEPRINT_VERSION,
  track: 'en',
  targetLevel: 'BEGINNER',
  totalItems: 20,
  overallPass: 0.8,
  groups: [
    {
      key: 'subjunctive',
      label: '虚拟语气',
      skillIds: ['en.grammar.subjunctive'],
      items: 6,
      minCorrect: 5,
    },
    {
      key: 'inversion',
      label: '倒装',
      skillIds: ['en.grammar.inversion'],
      items: 4,
      minCorrect: 3,
    },
    {
      key: 'article',
      label: '冠词',
      skillIds: ['en.grammar.article'],
      items: 4,
      minCorrect: 3,
    },
  ],
  flexItems: 6,
};

const EN_HIGHER = (targetLevel: LearnerLevel): AssessmentBlueprint => ({
  ...EN_BEGINNER,
  targetLevel,
  groups: [
    ...EN_BEGINNER.groups,
    { key: 'collocation', label: '学术搭配', skillIds: ['en.vocab.collocation'], items: 2, minCorrect: 2 },
  ],
  flexItems: 4,
});

const KO_BEGINNER: AssessmentBlueprint = {
  version: ASSESSMENT_BLUEPRINT_VERSION,
  track: 'ko',
  targetLevel: 'BEGINNER',
  totalItems: 20,
  overallPass: 0.8,
  groups: [
    {
      key: 'eseo',
      label: '处所助词에/에서',
      skillIds: ['ko.grammar.particle_eseo'],
      items: 8,
      minCorrect: 6,
    },
  ],
  flexItems: 12,
};

const KO_HIGHER = (targetLevel: LearnerLevel): AssessmentBlueprint => ({
  ...KO_BEGINNER,
  targetLevel,
});

/** 目标档 → 蓝图（NOVICE 不设考试，返回 null 走旧逻辑…实际上 NOVICE 不可为考级目标）。 */
export function blueprintFor(
  track: 'ja' | 'en' | 'ko',
  targetLevel: LearnerLevel
): AssessmentBlueprint | null {
  if (targetLevel === 'NOVICE') return null;
  if (track === 'ja') return targetLevel === 'BEGINNER' ? JA_BEGINNER : JA_HIGHER(targetLevel);
  if (track === 'en') return targetLevel === 'BEGINNER' ? EN_BEGINNER : EN_HIGHER(targetLevel);
  return targetLevel === 'BEGINNER' ? KO_BEGINNER : KO_HIGHER(targetLevel);
}

/** 技能归属组（机动题返回 null；未知技能不硬归）。 */
export function attributeGroup(
  blueprint: AssessmentBlueprint,
  skillId: string | null | undefined
): BlueprintGroup | null {
  if (!skillId) return null;
  return blueprint.groups.find((g) => g.skillIds.includes(skillId)) ?? null;
}

export interface GroupSubscore {
  key: string;
  label: string;
  /** 本组应考题数（蓝图） */
  items: number;
  /** 实际组到的去重题数 */
  distinct: number;
  /** 已判题数 */
  graded: number;
  correct: number;
  minCorrect: number;
  /** 题量不足（去重题 < 应考题）：判线不强制，仅报告 */
  thin: boolean;
  met: boolean;
}

export interface ExamVerdict {
  passed: boolean;
  failReasons: string[];
}

/**
 * 晋级判定（纯函数）：总分线 + 覆盖充足的组全达线 + 字母线，缺一不可。
 * 语义铁律：任一必需分项题量不足（thin/未覆盖）→ 证据不足，不可晋级，
 * 不得跳过该项缩小分母重算通过率。
 */
export function evaluateExamVerdict(
  accuracy: number,
  overallPass: number,
  groups: GroupSubscore[],
  alphabetOk: boolean
): ExamVerdict {
  const failReasons: string[] = [];
  const pct = Math.round(accuracy * 100);
  if (!(accuracy >= overallPass)) {
    failReasons.push(`总正确率 ${pct}% 未达 ${Math.round(overallPass * 100)}% 线`);
  }
  for (const g of groups) {
    if (g.distinct === 0) {
      failReasons.push(`${g.label}无有效题目，证据不足，暂不可晋级`);
    } else if (g.thin) {
      failReasons.push(`${g.label}题量不足（${g.distinct}/${g.items}），证据不足，暂不可晋级`);
    } else if (!g.met) {
      failReasons.push(`${g.label}未达标（${g.correct}/${g.graded}，线 ${g.minCorrect}）`);
    }
  }
  if (!alphabetOk) {
    failReasons.push('字母基础未达标（量或正确率不够）');
  }
  return { passed: failReasons.length === 0, failReasons };
}
