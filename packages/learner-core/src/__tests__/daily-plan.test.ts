import { describe, expect, it } from 'bun:test';
import {
  buildDailyPlanStepTemplates,
  buildTrailStepTemplates,
  overlayDailyPlanProgress,
  parseDailyPlanStepTemplates,
  appendPracticePlanStep,
  PRACTICE_PLAN_STEP_ID,
} from '../daily-plan.js';

describe('daily plan sequencing', () => {
  it('reviews due cards before reading and quiz when FSRS has work', () => {
    const steps = buildDailyPlanStepTemplates({
      track: 'en',
      dailyGoalQuizzes: 5,
      dailyGoalCards: 10,
      dueCardsCount: 8,
      unresolvedMistakesCount: 2,
      topWeakness: { skillId: 'en.grammar.tense', name: '时态一致' },
      alphabetReady: true,
    });

    expect(steps.map((s) => s.kind)).toEqual([
      'CARDS',
      'GRAMMAR',
      'READING',
      'QUIZ',
      'MISTAKES',
    ]);
    expect(steps[0]?.targetCount).toBe(8);
    expect(steps[3]?.targetCount).toBe(5);
  });

  it('starts with new-word collection when nothing is due', () => {
    const steps = buildDailyPlanStepTemplates({
      track: 'en',
      dailyGoalQuizzes: 5,
      dailyGoalCards: 10,
      dueCardsCount: 0,
      unresolvedMistakesCount: 0,
      alphabetReady: true,
    });

    expect(steps.map((s) => s.kind)).toEqual(['NEW_WORDS', 'READING', 'QUIZ']);
    expect(steps[0]?.navigateTo).toBe('CARDS');
  });

  it('教材焦点：READING 步点名跟读并进教材页；无焦点保持通用', () => {
    const focused = buildDailyPlanStepTemplates({
      track: 'ja',
      dailyGoalQuizzes: 5,
      dailyGoalCards: 10,
      dueCardsCount: 0,
      unresolvedMistakesCount: 0,
      alphabetReady: true,
      textbookFocus: { bookTitle: '标日初上', lessonTitle: '第 3 課', lessonNumber: 3, displayTitle: '第 3 課' },
    });
    const reading = focused.find((s) => s.kind === 'READING');
    expect(reading?.title).toContain('标日初上');
    expect(reading?.title).toContain('第 3 課');
    expect(reading?.navigateTo).toBe('TEXTBOOK');

    const generic = buildDailyPlanStepTemplates({
      track: 'ja',
      dailyGoalQuizzes: 5,
      dailyGoalCards: 10,
      dueCardsCount: 0,
      unresolvedMistakesCount: 0,
      alphabetReady: true,
    });
    const reading2 = generic.find((s) => s.kind === 'READING');
    expect(reading2?.title).toBe('精读一篇');
    expect(reading2?.navigateTo).toBe('READING');
  });

  it('P1-B：displayTitle 为 null 时不得用 lessonNumber 当教材编号，也不得展示 raw 噪声标题', () => {
    const steps = buildDailyPlanStepTemplates({
      track: 'ja',
      dailyGoalQuizzes: 5,
      dailyGoalCards: 10,
      dueCardsCount: 0,
      unresolvedMistakesCount: 0,
      alphabetReady: true,
      // 线上真实错位形：positional 26 + 噪声 raw title
      textbookFocus: { bookTitle: '标日初下', lessonTitle: 'だい -第11課', lessonNumber: 26, displayTitle: null },
    });
    const reading = steps.find((s) => s.kind === 'READING');
    expect(reading?.title).toBe('继续精读《标日初下》');
    expect(reading?.title).not.toContain('26');
    expect(reading?.title).not.toContain('第11課');
    expect(reading?.summary).not.toContain('だい -第11課');
    expect(reading?.summary).not.toContain('26');
    expect(reading?.navigateTo).toBe('TEXTBOOK');
  });

  it('路线单元置顶：单元步在前，路线覆盖的通用步让路', () => {
    const unit = (id: string, kind: 'ALPHABET' | 'NEW_WORDS' | 'GRAMMAR', skillId?: string) => ({
      id,
      kind,
      title: `单元${id}`,
      summary: '单元',
      navigateTo: 'KANA' as const,
      ...(skillId ? { skillId } : {}),
    });
    // NOVICE + 字母单元：通用五十音跟读让路（路线 own 住字母线）
    const steps = buildDailyPlanStepTemplates({
      track: 'ja',
      learnerLevel: 'NOVICE',
      dailyGoalQuizzes: 5,
      dailyGoalCards: 10,
      dueCardsCount: 0,
      unresolvedMistakesCount: 0,
      alphabetReady: false,
      unitSteps: [unit('step_unit_a', 'ALPHABET'), unit('step_unit_b', 'NEW_WORDS')],
    });
    expect(steps[0]?.id).toBe('step_unit_a');
    expect(steps[1]?.id).toBe('step_unit_b');
    expect(steps.some((s) => s.id === 'step_alphabet')).toBe(false);
    expect(steps.some((s) => s.id === 'step_new_words')).toBe(false);
    // 到期卡仍保留（复习欠账与路线无关）
    const withDue = buildDailyPlanStepTemplates({
      track: 'ja',
      learnerLevel: 'NOVICE',
      dailyGoalQuizzes: 5,
      dailyGoalCards: 10,
      dueCardsCount: 4,
      unresolvedMistakesCount: 0,
      alphabetReady: false,
      unitSteps: [unit('step_unit_a', 'ALPHABET')],
    });
    expect(withDue.map((s) => s.id)).toEqual(['step_unit_a', 'step_cards']);
    // 同技能薄弱项不重复排
    const dedup = buildDailyPlanStepTemplates({
      track: 'ja',
      learnerLevel: 'BEGINNER',
      dailyGoalQuizzes: 5,
      dailyGoalCards: 10,
      dueCardsCount: 0,
      unresolvedMistakesCount: 0,
      alphabetReady: true,
      topWeakness: { skillId: 'jp.grammar.conditional_tara', name: 'たら' },
      unitSteps: [unit('step_unit_t', 'GRAMMAR', 'jp.grammar.conditional_tara')],
    });
    expect(dedup.filter((s) => s.kind === 'GRAMMAR').length).toBe(1);
    // 无单元步时行为不变（旧快照兼容）
    const legacy = buildDailyPlanStepTemplates({
      track: 'ja',
      dailyGoalQuizzes: 5,
      dailyGoalCards: 10,
      dueCardsCount: 0,
      unresolvedMistakesCount: 0,
      alphabetReady: true,
    });
    expect(legacy.map((s) => s.kind)).toEqual(['NEW_WORDS', 'READING', 'QUIZ']);
  });

  it('overlays live stats without changing stored order', () => {
    const templates = buildDailyPlanStepTemplates({
      track: 'ja',
      dailyGoalQuizzes: 5,
      dailyGoalCards: 10,
      dueCardsCount: 3,
      unresolvedMistakesCount: 1,
      alphabetReady: true,
    });
    const overlayed = overlayDailyPlanProgress(templates, {
      quizzesCount: 5,
      cardsReviewedCount: 3,
      readingCount: 0,
      mistakesResolvedCount: 0,
      unresolvedMistakesCount: 1,
      completedStepIds: ['step_reading'],
    });

    expect(overlayed.find((s) => s.kind === 'CARDS')?.done).toBe(true);
    expect(overlayed.find((s) => s.kind === 'QUIZ')?.done).toBe(true);
    expect(overlayed.find((s) => s.kind === 'READING')?.done).toBe(true);
    expect(overlayed.find((s) => s.kind === 'MISTAKES')?.done).toBe(false);
  });

  it('rejects corrupt persisted templates instead of inventing steps', () => {
    expect(parseDailyPlanStepTemplates([{ id: 'x' }])).toBeNull();
    expect(parseDailyPlanStepTemplates([])).toBeNull();
    const ok = parseDailyPlanStepTemplates([
      {
        id: 'step_quiz',
        kind: 'QUIZ',
        title: '自适应练习',
        summary: '做题',
        navigateTo: 'QUIZ',
        targetCount: 5,
      },
    ]);
    expect(ok?.[0]?.kind).toBe('QUIZ');
  });

  it('accepts textbook and assessment destinations when restoring a stored plan', () => {
    for (const navigateTo of ['TEXTBOOK', 'RADAR'] as const) {
      expect(parseDailyPlanStepTemplates([{ id: 'step', kind: 'QUIZ', title: '学习', summary: '学习', navigateTo }])?.[0]?.navigateTo).toBe(navigateTo);
    }
  });

  it('course units ignore unrelated activities and manual checkmarks', () => {
    const template = { id: 'step_unit_ja-u-greet', courseUnitId: 'ja-u-greet', kind: 'NEW_WORDS' as const,
      title: '问候', summary: '问候', navigateTo: 'CARDS' as const, targetCount: 3 };
    const progress = { quizzesCount: 99, cardsReviewedCount: 99, readingCount: 99,
      mistakesResolvedCount: 0, unresolvedMistakesCount: 0, completedStepIds: [template.id] };
    expect(overlayDailyPlanProgress([template], progress)[0]?.done).toBe(false);
    const actual = overlayDailyPlanProgress([template], { ...progress,
      courseUnits: { 'ja-u-greet': { done: false, progressText: '1/3' } } });
    expect(actual[0]?.done).toBe(false);
    expect(actual[0]?.progressText).toBe('1/3');
    expect(overlayDailyPlanProgress([template], { ...progress,
      courseUnits: { 'ja-u-greet': { done: true, progressText: '已掌握' } } })[0]?.done).toBe(true);
    expect(parseDailyPlanStepTemplates([template])?.[0]?.courseUnitId).toBe('ja-u-greet');
  });
});

describe('practice plan run step (P5-E3)', () => {
  const baseSignals = {
    track: 'en' as const,
    dailyGoalQuizzes: 5,
    dailyGoalCards: 10,
    dueCardsCount: 8,
    unresolvedMistakesCount: 2,
    topWeakness: { skillId: 'en.grammar.tense', name: '时态一致' },
    alphabetReady: true,
  };

  it('appends practice step after the 5-step cap without being dropped', () => {
    const capped = buildDailyPlanStepTemplates(baseSignals);
    expect(capped.length).toBe(5);
    const withPractice = appendPracticePlanStep(capped, 8);
    expect(withPractice.length).toBe(6);
    const practice = withPractice[withPractice.length - 1]!;
    expect(practice.id).toBe(PRACTICE_PLAN_STEP_ID);
    expect(practice.kind).toBe('PRACTICE_PLAN');
    expect(practice.navigateTo).toBe('PRACTICE_PLAN');
    expect(practice.targetCount).toBe(8);
  });

  it('is idempotent: appending twice does not duplicate the step', () => {
    const once = appendPracticePlanStep(buildDailyPlanStepTemplates(baseSignals), 5);
    const twice = appendPracticePlanStep(once, 5);
    expect(twice.filter((s) => s.id === PRACTICE_PLAN_STEP_ID).length).toBe(1);
  });

  it('completes only when submitted items reach frozen total', () => {
    const templates = appendPracticePlanStep(buildDailyPlanStepTemplates(baseSignals), 3);
    const partial = overlayDailyPlanProgress(templates, {
      quizzesCount: 0,
      cardsReviewedCount: 0,
      readingCount: 0,
      mistakesResolvedCount: 0,
      unresolvedMistakesCount: 2,
      completedStepIds: [],
      practicePlan: { submittedItems: 2, totalItems: 3 },
    });
    const partialStep = partial.find((s) => s.id === PRACTICE_PLAN_STEP_ID)!;
    expect(partialStep.done).toBe(false);
    expect(partialStep.currentCount).toBe(2);

    const complete = overlayDailyPlanProgress(templates, {
      quizzesCount: 0,
      cardsReviewedCount: 0,
      readingCount: 0,
      mistakesResolvedCount: 0,
      unresolvedMistakesCount: 2,
      completedStepIds: [],
      practicePlan: { submittedItems: 3, totalItems: 3 },
    });
    expect(complete.find((s) => s.id === PRACTICE_PLAN_STEP_ID)?.done).toBe(true);
  });

  it('stays incomplete without signal but honours manual completion id', () => {
    const templates = appendPracticePlanStep(buildDailyPlanStepTemplates(baseSignals), 4);
    const noSignal = overlayDailyPlanProgress(templates, {
      quizzesCount: 0,
      cardsReviewedCount: 0,
      readingCount: 0,
      mistakesResolvedCount: 0,
      unresolvedMistakesCount: 2,
      completedStepIds: [],
    });
    const step = noSignal.find((s) => s.id === PRACTICE_PLAN_STEP_ID)!;
    expect(step.done).toBe(false);
    expect(step.currentCount).toBe(0);

    const manuallyDone = overlayDailyPlanProgress(templates, {
      quizzesCount: 0,
      cardsReviewedCount: 0,
      readingCount: 0,
      mistakesResolvedCount: 0,
      unresolvedMistakesCount: 2,
      completedStepIds: [PRACTICE_PLAN_STEP_ID],
    });
    expect(manuallyDone.find((s) => s.id === PRACTICE_PLAN_STEP_ID)?.done).toBe(true);
  });

  it('parses persisted PRACTICE_PLAN templates round-trip', () => {
    const templates = appendPracticePlanStep(buildDailyPlanStepTemplates(baseSignals), 6);
    const parsed = parseDailyPlanStepTemplates(JSON.parse(JSON.stringify(templates)));
    expect(parsed).not.toBeNull();
    expect(parsed?.find((s) => s.id === PRACTICE_PLAN_STEP_ID)?.kind).toBe('PRACTICE_PLAN');
  });
});

describe('daily plan alphabet gate（零基础不推精读）', () => {
  const gatedBase = {
    track: 'ja' as const,
    dailyGoalQuizzes: 5,
    dailyGoalCards: 10,
    dueCardsCount: 0,
    unresolvedMistakesCount: 0,
    alphabetReady: false,
  };

  it('未过关：字母跟读和词语学习，不推精读/自适应', () => {
    const steps = buildDailyPlanStepTemplates(gatedBase);
    expect(steps.map((s) => s.kind)).toEqual(['ALPHABET', 'NEW_WORDS']);
    expect(steps[0]?.navigateTo).toBe('KANA');
    expect(steps[0]?.targetCount).toBe(5);
  });

  it('未过关但有到期卡/错题：保留复习与回炉，不加新东西', () => {
    const steps = buildDailyPlanStepTemplates({
      ...gatedBase,
      dueCardsCount: 4,
      unresolvedMistakesCount: 2,
    });
    expect(steps.map((s) => s.kind)).toEqual(['ALPHABET', 'CARDS', 'MISTAKES']);
  });

  it('未过关：字母薄弱项不单开 GRAMMAR 步（ALPHABET 已覆盖）', () => {
    const steps = buildDailyPlanStepTemplates({
      ...gatedBase,
      topWeakness: { skillId: 'jp.kana.hiragana', name: '平假名认读' },
    });
    expect(steps.map((s) => s.kind)).toEqual(['ALPHABET', 'NEW_WORDS']);
  });

  it('字母薄弱项回字母工作室，而非自适应做题', () => {
    const steps = buildDailyPlanStepTemplates({
      track: 'ja' as const,
      dailyGoalQuizzes: 5,
      dailyGoalCards: 10,
      dueCardsCount: 0,
      unresolvedMistakesCount: 0,
      alphabetReady: true,
      topWeakness: { skillId: 'jp.kana.katakana', name: '片假名认读' },
    });
    const grammar = steps.find((s) => s.kind === 'GRAMMAR')!;
    expect(grammar.navigateTo).toBe('KANA');
  });

  it('ALPHABET 步只随字母练习完成，不吃其他题型的总数', () => {
    const templates = buildDailyPlanStepTemplates(gatedBase);
    const overlayed = overlayDailyPlanProgress(templates, {
      quizzesCount: 5,
      alphabetCount: 5,
      cardsReviewedCount: 0,
      readingCount: 0,
      mistakesResolvedCount: 0,
      unresolvedMistakesCount: 0,
      completedStepIds: [],
    });
    expect(overlayed.find((s) => s.kind === 'ALPHABET')?.done).toBe(true);
    expect(overlayDailyPlanProgress(templates, { quizzesCount: 99, alphabetCount: 0, cardsReviewedCount: 0,
      readingCount: 0, mistakesResolvedCount: 0, unresolvedMistakesCount: 0, completedStepIds: [] })[0]?.done).toBe(false);
  });

  it('ALPHABET 模板持久化往返', () => {
    const templates = buildDailyPlanStepTemplates({ ...gatedBase, track: 'ko' as const });
    expect(templates[0]?.navigateTo).toBe('HANGUL');
    const parsed = parseDailyPlanStepTemplates(JSON.parse(JSON.stringify(templates)));
    expect(parsed?.[0]?.kind).toBe('ALPHABET');
  });
});

it('weakness tasks count only attempts for the requested skill', () => {
  const step = { id: 'grammar', kind: 'GRAMMAR' as const, title: '语法', summary: '',
    navigateTo: 'QUIZ' as const, skillId: 'en.grammar.tense', targetCount: 2 };
  const progress = { quizzesCount: 99, cardsReviewedCount: 0, readingCount: 0,
    mistakesResolvedCount: 0, unresolvedMistakesCount: 0, completedStepIds: [], skillQuizzes: { 'en.grammar.other': 99 } };
  expect(overlayDailyPlanProgress([step], progress)[0]?.done).toBe(false);
  expect(overlayDailyPlanProgress([step], { ...progress, skillQuizzes: { 'en.grammar.tense': 1 } })[0]?.done).toBe(false);
  expect(overlayDailyPlanProgress([step], { ...progress, skillQuizzes: { 'en.grammar.tense': 2 } })[0]?.done).toBe(true);
});

describe('trail-mapped plan steps（带路合一）', () => {
  const stages = [
    { id: 'ja-1', day: '第 1 天', title: '开口跟读', hint: '跟读', tab: 'KANA' as const, criterionKind: 'kana' as const, goal: 3 },
    { id: 'ja-3', day: '第 3 天', title: '收藏生词', hint: '收3张', tab: 'CARDS' as const, criterionKind: 'cards' as const, goal: 3 },
    { id: 'ja-4', day: '第 4 天', title: '第一次做题', hint: '做3道', tab: 'QUIZ' as const, criterionKind: 'quiz' as const, goal: 3 },
  ];

  it('stage 直映射为步骤（kind/tab/目标数一致，id 幂等）', () => {
    const templates = buildTrailStepTemplates(stages);
    expect(templates.map((t) => t.kind)).toEqual(['ALPHABET', 'NEW_WORDS', 'QUIZ']);
    expect(templates.map((t) => t.navigateTo)).toEqual(['KANA', 'CARDS', 'QUIZ']);
    expect(templates.map((t) => t.id)).toEqual(['step_trail_ja-1', 'step_trail_ja-3', 'step_trail_ja-4']);
    expect(templates[0]?.trailStageId).toBe('ja-1');
    expect(templates[0]?.title).toContain('第 1 天');
  });

  it('overlay 吃带路当日计数，不吃通用打卡口径', () => {
    const templates = buildTrailStepTemplates(stages);
    const overlayed = overlayDailyPlanProgress(templates, {
      quizzesCount: 99,
      cardsReviewedCount: 99,
      readingCount: 99,
      mistakesResolvedCount: 0,
      unresolvedMistakesCount: 0,
      completedStepIds: [],
      trail: { 'ja-1': 3, 'ja-3': 1, 'ja-4': 0 },
    });
    expect(overlayed.find((s) => s.id === 'step_trail_ja-1')?.done).toBe(true);
    expect(overlayed.find((s) => s.id === 'step_trail_ja-3')?.currentCount).toBe(1);
    expect(overlayed.find((s) => s.id === 'step_trail_ja-4')?.done).toBe(false);
  });

  it('trail 映射步持久化往返', () => {
    const templates = buildTrailStepTemplates(stages);
    const parsed = parseDailyPlanStepTemplates(JSON.parse(JSON.stringify(templates)));
    expect(parsed?.[0]?.trailStageId).toBe('ja-1');
    expect(parsed?.[0]?.kind).toBe('ALPHABET');
  });
});

describe('零基础能力门', () => {
  it('刷够字母次数仍不推精读，允许学词', () => {
    const steps = buildDailyPlanStepTemplates({ track: 'ja', learnerLevel: 'NOVICE', alphabetReady: true, dailyGoalQuizzes: 5, dailyGoalCards: 5, dueCardsCount: 0, unresolvedMistakesCount: 0 });
    expect(steps.map(s => s.kind)).toEqual(['ALPHABET', 'NEW_WORDS']);
  });
  it('英语零基础不因无需假名而自动进入精读', () => {
    const steps = buildDailyPlanStepTemplates({ track: 'en', learnerLevel: 'NOVICE', alphabetReady: true, dailyGoalQuizzes: 5, dailyGoalCards: 5, dueCardsCount: 0, unresolvedMistakesCount: 0 });
    expect(steps.map(s => s.kind)).toEqual(['NEW_WORDS']);
  });
});
