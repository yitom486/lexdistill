import type { LearnerLevel, TargetLanguage } from './types.js';

export const DAILY_PLAN_STEP_KINDS = [
  'NEW_WORDS',
  'CARDS',
  'GRAMMAR',
  'READING',
  'QUIZ',
  'MISTAKES',
  'PRACTICE_PLAN',
  /** 字母门：五十音/谚文未过关时的跟读 drill 步（零基础专属） */
  'ALPHABET',
] as const;

export type DailyPlanStepKind = (typeof DAILY_PLAN_STEP_KINDS)[number];

export type DailyPlanNavigateTarget =
  | 'CARDS'
  | 'QUIZ'
  | 'READING'
  | 'MISTAKES'
  | 'PRACTICE_PLAN'
  | 'KANA'
  | 'HANGUL'
  | 'TEXTBOOK'
  | 'RADAR';

/** P5-E3：练习计划 run 步骤的确定性 id（同一天多次读取/完成状态稳定） */
export const PRACTICE_PLAN_STEP_ID = 'step_practice_plan';

/** 持久化模板：不含 live `done`，当日顺序稳定 */
export interface DailyPlanStepTemplate {
  id: string;
  kind: DailyPlanStepKind;
  title: string;
  summary: string;
  navigateTo: DailyPlanNavigateTarget;
  skillId?: string | undefined;
  skillName?: string | undefined;
  targetCount?: number | undefined;
  /** 带路映射步：关联带路 stage id（进度走当日带路计数，而非通用打卡口径）。 */
  trailStageId?: string | undefined;
}

export interface DailyPlanStep extends DailyPlanStepTemplate {
  done: boolean;
  currentCount: number;
}

export interface DailyStudyPlan {
  id: string;
  userId: string;
  language: TargetLanguage;
  planDate: string;
  steps: DailyPlanStep[];
  completedCount: number;
  totalCount: number;
  createdAt: string;
}

export interface DailyPlanSignals {
  learnerLevel?: LearnerLevel;
  track: TargetLanguage;
  dailyGoalQuizzes: number;
  dailyGoalCards: number;
  dueCardsCount: number;
  unresolvedMistakesCount: number;
  topWeakness?: { skillId: string; name: string } | undefined;
  /**
   * 路线单元步（网关课程路线求值出的可学单元转模板，至多取 3 个置顶；
   * 通用步中路线已覆盖的种类自动让路）。
   */
  unitSteps?: DailyPlanStepTemplate[] | undefined;
  /**
   * 教材焦点（投影仪装配，由网关 reading_positions 推导“学到哪课”）：
   * - displayTitle 由网关保守归一（P1-B lesson-display-title），learner-core 只消费不懂规则；
   * - 有 displayTitle：READING 步点名“精读《X》${displayTitle}”；
   * - 无（null）：用通用跟读文本，绝不把 lessonNumber 当教材编号，也不展示 ambiguous raw title；
   * - lessonTitle（raw）/lessonNumber（legacy）仅留诊断，不进用户可见文本。
   */
  textbookFocus?: { bookTitle: string; lessonTitle: string; lessonNumber: number; displayTitle: string | null } | undefined;
  /**
   * 字母门：五十音/谚文是否已过关（累计字母尝试≥15；en 恒 true）。
   * 未过关时只排字母跟读（+到期卡/错题），不推精读与自适应难题——
   * 五十音没认完的人做精读纯属劝退。
   */
  alphabetReady: boolean;
}

export interface DailyPlanProgressSignals {
  quizzesCount: number;
  cardsReviewedCount: number;
  readingCount: number;
  mistakesResolvedCount: number;
  unresolvedMistakesCount: number;
  completedStepIds: string[];
  /**
   * P5-E3：练习计划 run 进度（活跃 run 或当日已完成 run 时存在）。
   * 由仓储从 practice_plan_runs / practice_item_attempts 聚合，不在 UI 侧累计。
   */
  practicePlan?: { submittedItems: number; totalItems: number } | undefined;
  /**
   * 带路当日计数（stageId → 今日进度；带路映射步专用，与通用打卡口径解耦）。
   * 由仓储在带路未走完时随模板一起提供；缺省时带路步按 0 计。
   */
  trail?: Record<string, number> | undefined;
}

const KIND_SET = new Set<string>(DAILY_PLAN_STEP_KINDS);

export function isDailyPlanStepKind(value: unknown): value is DailyPlanStepKind {
  return typeof value === 'string' && KIND_SET.has(value);
}

/**
 * 按教学顺序组当日步骤（最多 5 项）：
 * 路线单元优先（课程路线求值出的可学单元，最多 3 个）；
 * 到期闪卡优先复习；无到期则改学新词 → 薄弱语法 → 阅读 → 自适应做题 → 未消错题。
 * 路线覆盖的通用步自动让路（字母跟读/查词学新词/同技能薄弱项不重复排）。
 * 字母门：ja/ko 且 alphabetReady=false 时，不推精读与自适应难题。
 */
export function buildDailyPlanStepTemplates(signals: DailyPlanSignals): DailyPlanStepTemplate[] {
  const steps: DailyPlanStepTemplate[] = [];
  const quizGoal = Math.max(1, signals.dailyGoalQuizzes);
  const cardGoal = Math.max(1, signals.dailyGoalCards);
  const novice = signals.learnerLevel === 'NOVICE';
  const alphabetGate = (novice || !signals.alphabetReady) && (signals.track === 'ja' || signals.track === 'ko');
  // 路线单元优先：取前 3 个可学单元，标题/入口由单元自带。
  const unitSteps = (signals.unitSteps ?? []).slice(0, 3);
  const unitKinds = new Set(unitSteps.map((s) => s.kind));
  const unitSkills = new Set(
    unitSteps.map((s) => s.skillId).filter((s): s is string => typeof s === 'string')
  );
  for (const u of unitSteps) steps.push(u);

  if (alphabetGate && !unitKinds.has('ALPHABET')) {
    steps.push({
      id: 'step_alphabet',
      kind: 'ALPHABET',
      title: signals.track === 'ko' ? '谚文跟读' : '五十音跟读',
      summary: '每次选一小组字母，先听音跟读，再做 5 道已学内容小测；完成次数不代表掌握。',
      navigateTo: signals.track === 'ko' ? 'HANGUL' : 'KANA',
      targetCount: 5,
    });
  }

  if (signals.dueCardsCount > 0) {
    const targetCount = Math.max(1, Math.min(signals.dueCardsCount, cardGoal));
    steps.push({
      id: 'step_cards',
      kind: 'CARDS',
      title: '复习到期闪卡',
      summary: `按 FSRS 处理今日 ${targetCount} 张到期卡片，巩固已学词汇。`,
      navigateTo: 'CARDS',
      targetCount,
    });
  } else if (!unitKinds.has('NEW_WORDS')) {
    steps.push({
      id: 'step_new_words',
      kind: 'NEW_WORDS',
      title: '查词学新词',
      summary: '词典或阅读划词加入生词本，并复习至少 1 张新卡。',
      navigateTo: 'CARDS',
      targetCount: 1,
    });
  }

  if (
    signals.topWeakness &&
    !alphabetGate &&
    !novice &&
    !unitSkills.has(signals.topWeakness.skillId)
  ) {
    steps.push({
      id: 'step_grammar',
      kind: 'GRAMMAR',
      title: `攻克薄弱项 · ${signals.topWeakness.name}`,
      summary: '先看一句规则与例句，再做靶向练习，把薄弱点写回学情。',
      navigateTo: isAlphabetWeakness(signals.topWeakness.skillId)
        ? signals.track === 'ko'
          ? 'HANGUL'
          : 'KANA'
        : 'QUIZ',
      skillId: signals.topWeakness.skillId,
      skillName: signals.topWeakness.name,
      targetCount: 1,
    });
  }

  if (!alphabetGate && !novice) {
    const focus = signals.textbookFocus;
    // P1-B：displayTitle 为 null 时不得用 lessonNumber 凑“第 N 课”，也不展示 ambiguous raw title。
    const display = focus?.displayTitle ?? null;
    steps.push({
      id: 'step_reading',
      kind: 'READING',
      title: focus ? (display ? `精读《${focus.bookTitle}》${display}` : `继续精读《${focus.bookTitle}》`) : '精读一篇',
      summary: focus
        ? display
          ? `继续读${display}：划词即转生词本；切到下一课后计划自动跟过去。`
          : `按阅读位置继续精读《${focus.bookTitle}》；划词可直接转入 FSRS 生词本。`
        : '完成一篇阅读理解；划词可直接转入 FSRS 生词本。',
      // 有焦点进教材页（按阅读位置自动恢复到该课）；无焦点去通用阅读。
      navigateTo: focus ? 'TEXTBOOK' : 'READING',
      targetCount: 1,
    });

    steps.push({
      id: 'step_quiz',
      kind: 'QUIZ',
      title: '自适应练习',
      summary: `完成今日 ${quizGoal} 道练习，把做题记录写回技能雷达。`,
      navigateTo: 'QUIZ',
      targetCount: quizGoal,
    });
  }

  if (signals.unresolvedMistakesCount > 0) {
    steps.push({
      id: 'step_mistakes',
      kind: 'MISTAKES',
      title: '错题回炉',
      summary: `待攻克 ${signals.unresolvedMistakesCount} 道；两连对即可出库。`,
      navigateTo: 'MISTAKES',
      targetCount: 1,
    });
  }

  return steps.slice(0, 5);
}

/** 字母类薄弱项（假名/谚文）：应回字母工作室，而非自适应做题。 */
function isAlphabetWeakness(skillId: string): boolean {
  return skillId.startsWith('jp.kana.') || skillId.startsWith('ko.hangul.');
}

export type TrailStepKind = 'kana' | 'hangul' | 'cards' | 'quiz' | 'reading';

export interface TrailStageInput {
  id: string;
  day: string;
  title: string;
  hint: string;
  tab: 'KANA' | 'HANGUL' | 'CARDS' | 'QUIZ' | 'READING';
  criterionKind: TrailStepKind;
  goal: number;
}

/**
 * 带路未走完时的当日步骤：带路 stage 直映射为计划步（做完的 stage 不再列入）。
 * kind/tab 映射：kana|hangul→ALPHABET（回字母工作室），cards→NEW_WORDS，
 * quiz→QUIZ，reading→READING；id 取 `step_trail_<stageId>` 保证幂等。
 */
export function buildTrailStepTemplates(stages: TrailStageInput[]): DailyPlanStepTemplate[] {
  return stages.map((s) => {
    const kind: DailyPlanStepKind =
      s.criterionKind === 'kana' || s.criterionKind === 'hangul'
        ? 'ALPHABET'
        : s.criterionKind === 'cards'
          ? 'NEW_WORDS'
          : s.criterionKind === 'quiz'
            ? 'QUIZ'
            : 'READING';
    return {
      id: `step_trail_${s.id}`,
      kind,
      title: `${s.day} · ${s.title}`,
      summary: s.hint,
      navigateTo: s.tab,
      targetCount: s.goal,
      trailStageId: s.id,
    };
  });
}

export function overlayDailyPlanProgress(
  templates: DailyPlanStepTemplate[],
  progress: DailyPlanProgressSignals
): DailyPlanStep[] {
  return templates.map((step) => {
    // 带路映射步：走当日带路计数（仓储随模板提供），不吃通用打卡口径。
    const currentCount = step.trailStageId
      ? (progress.trail?.[step.trailStageId] ?? 0)
      : currentCountForStep(step.kind, progress);
    return {
      ...step,
      currentCount,
      done: isStepDone(step, progress, currentCount),
    };
  });
}

/**
 * P5-E3：把用户练习计划 run 追加为今日计划的真实步骤。
 * - 不占用核心 5 步容量（核心教学顺序 slices 后再追加）；
 * - 确定性 id 保证幂等：已存在则原样返回；
 * - 仓储层在「run 晚于计划冻结创建」时调用，使当日新开的 run 也能出现在计划里。
 */
export function appendPracticePlanStep(
  templates: DailyPlanStepTemplate[],
  totalItems: number
): DailyPlanStepTemplate[] {
  if (templates.some((s) => s.id === PRACTICE_PLAN_STEP_ID)) return templates;
  return [
    ...templates,
    {
      id: PRACTICE_PLAN_STEP_ID,
      kind: 'PRACTICE_PLAN',
      title: '完成练习计划',
      summary: '按自定义块组合完成今日练习运行；全部提交后本步自动完成。',
      navigateTo: 'PRACTICE_PLAN',
      targetCount: Math.max(1, totalItems),
    },
  ];
}

export function summarizeDailyStudyPlan(
  id: string,
  userId: string,
  language: TargetLanguage,
  planDate: string,
  createdAt: string,
  templates: DailyPlanStepTemplate[],
  progress: DailyPlanProgressSignals
): DailyStudyPlan {
  const steps = overlayDailyPlanProgress(templates, progress);
  return {
    id,
    userId,
    language,
    planDate,
    steps,
    completedCount: steps.filter((s) => s.done).length,
    totalCount: steps.length,
    createdAt,
  };
}

export function parseDailyPlanStepTemplates(raw: unknown): DailyPlanStepTemplate[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const templates: DailyPlanStepTemplate[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const rec = item as Record<string, unknown>;
    if (typeof rec.id !== 'string' || !isDailyPlanStepKind(rec.kind)) return null;
    if (typeof rec.title !== 'string' || typeof rec.summary !== 'string') return null;
    if (
      rec.navigateTo !== 'CARDS' &&
      rec.navigateTo !== 'QUIZ' &&
      rec.navigateTo !== 'READING' &&
      rec.navigateTo !== 'MISTAKES' &&
      rec.navigateTo !== 'PRACTICE_PLAN' &&
      rec.navigateTo !== 'KANA' &&
      rec.navigateTo !== 'HANGUL'
    ) {
      return null;
    }
    const template: DailyPlanStepTemplate = {
      id: rec.id,
      kind: rec.kind,
      title: rec.title,
      summary: rec.summary,
      navigateTo: rec.navigateTo,
    };
    if (typeof rec.skillId === 'string') template.skillId = rec.skillId;
    if (typeof rec.skillName === 'string') template.skillName = rec.skillName;
    if (typeof rec.targetCount === 'number' && Number.isFinite(rec.targetCount)) {
      template.targetCount = rec.targetCount;
    }
    if (typeof rec.trailStageId === 'string' && rec.trailStageId) {
      template.trailStageId = rec.trailStageId;
    }
    templates.push(template);
  }
  return templates;
}

export function parseCompletedStepIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === 'string' && id.length > 0);
}

function currentCountForStep(
  kind: DailyPlanStepKind,
  progress: DailyPlanProgressSignals
): number {
  switch (kind) {
    case 'CARDS':
    case 'NEW_WORDS':
      return progress.cardsReviewedCount;
    case 'READING':
      return progress.readingCount;
    case 'QUIZ':
    case 'GRAMMAR':
    case 'ALPHABET':
      // 字母 drill 同步写 activity.quizzes（见 recordKanaPractice），故 ALPHABET 与 QUIZ 同口径。
      return progress.quizzesCount;
    case 'MISTAKES':
      return progress.mistakesResolvedCount;
    case 'PRACTICE_PLAN':
      return progress.practicePlan?.submittedItems ?? 0;
    default:
      return 0;
  }
}

function isStepDone(
  step: DailyPlanStepTemplate,
  progress: DailyPlanProgressSignals,
  currentCount: number
): boolean {
  if (progress.completedStepIds.includes(step.id)) return true;
  const target = Math.max(1, step.targetCount ?? 1);
  switch (step.kind) {
    case 'CARDS':
    case 'NEW_WORDS':
    case 'READING':
    case 'QUIZ':
    case 'ALPHABET':
      return currentCount >= target;
    case 'GRAMMAR':
      return progress.quizzesCount >= 1;
    case 'MISTAKES':
      return progress.mistakesResolvedCount >= 1 || progress.unresolvedMistakesCount === 0;
    case 'PRACTICE_PLAN': {
      const pp = progress.practicePlan;
      return pp !== undefined && pp.totalItems > 0 && pp.submittedItems >= pp.totalItems;
    }
    default:
      return false;
  }
}
