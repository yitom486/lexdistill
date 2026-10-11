import { expect, it, mock } from 'bun:test';
import React from 'react';
import { COURSE_UNITS, courseUnitPlanStep } from '@study-studio/learner-core';
import { KANA_SEEDS } from '../../../../../packages/storage-sqlite/src/seeds/kana-seed.js';
import { act, setupDom } from '../toc/__tests__/dom-setup.js';

it('daily tasks and route links focus words, kana, cards and grammar and clear stale intent', async () => {
  if (process.env['LINGUA_TODAY_DOM_CHILD'] !== '1') {
    const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_TODAY_DOM_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ exit, output: exit ? stdout + stderr : '' }).toEqual({ exit: 0, output: '' });
    return;
  }
  const dom = await setupDom(true);
  const greet = COURSE_UNITS.find(u => u.id === 'ja-u-greet')!;
  const dakuten = COURSE_UNITS.find(u => u.id === 'ja-u-dakuten')!;
  const grammar = COURSE_UNITS.find(u => u.id === 'ja-u-lesson-nide')!;
  const inert = () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false });
  mock.module('../../utils/audio.js', () => ({ sound: { playClick() {} }, speechStudio: { speak: async () => {} } }));
  mock.module('../magicui/index.js', () => ({ NumberTicker: ({ value }: { value: number }) => <span>{value}</span>,
    ShimmerButton: ({ children, ...props }: React.ComponentProps<'button'>) => <button {...props}>{children}</button>, fireSuccessConfetti() {} }));
  mock.module('../../queries/useLearnerQueries.js', () => ({
    useDailyPlanQuery: () => ({ data: { planDate: '2026-10-07', totalCount: 1, completedCount: 0,
      steps: [{ ...courseUnitPlanStep(greet), done: false, currentCount: 0, progressText: '1/3' }] }, isLoading: false }),
    useCompletePlanStepMutation: inert,
    useCourseRouteQuery: () => ({ data: { units: [{ unit: dakuten, status: 'available', progress: '2/20' }], nextUpId: dakuten.id } }),
    courseStageName: () => '零基础',
    useCardsQuery: () => ({ data: [] }), useUpdateCardMutation: inert,
    useCardFormatsQuery: () => ({ data: { formats: [] } }), useExportApkgMutation: inert,
    usePracticeCollectionsQuery: () => ({ data: [] }),
    useCurriculumKanaQuery: () => ({ data: KANA_SEEDS, isLoading: false, refetch() {} }),
    useAdaptiveKanaQueueQuery: () => ({ data: [], isLoading: false }), useKanaPracticeMutation: inert,
    useGenerateKanaWordsMutation: inert, useCollectDictionaryEntryMutation: inert,
    useQuestionsQuery: () => ({ data: [
      { id: 'target', testedSkill: grammar.activity.skillId },
      { id: 'unrelated', testedSkill: 'jp.grammar.other' },
    ] }),
  }));
  mock.module('../../queries/wordlists.js', () => ({ useWordlistsQuery: () => ({ data: [] }) }));
  mock.module('../../queries/vocabulary.js', () => ({ useVocabularyQuery: () => ({ data: [] }), selectVocabularyForCard: () => undefined }));
  mock.module('../../queries/lessons.js', () => ({ useLessonsQuery: () => ({ data: [] }) }));
  mock.module('../../queries/useAgentMutations.js', () => ({ useGenerateAdaptiveQuizMutation: inert }));
  mock.module('../daily-study/DailyWordStudyHub.js', () => ({ DailyWordStudyHub: ({ courseUnitId }: { courseUnitId?: string }) => <div data-study-unit={courseUnitId}>学词</div> }));
  mock.module('../CardReviewTabContent.js', () => ({ CardReviewTabContent: () => <div data-review>到期复习</div> }));
  mock.module('../practice/QuizRound.js', () => ({ QuizRound: ({ questions }: { questions: { id: string }[] }) => <div data-questions={questions.map(q => q.id).join(',')} /> }));
  for (const name of ['PracticeQueueToCardsPanel', 'DictionaryLookupPanel', 'ApkgImportDialog', 'DictionaryEntryDialog', 'VocabularyLibraryPanel', 'SubjectiveWritingWorkbench']) {
    mock.module(`../${name}.js`, () => ({ [name]: () => null }));
  }
  const { TodayPlanWorkbench } = await import('../TodayPlanWorkbench.js');
  const { CourseRouteBanner } = await import('../CourseRouteBanner.js');
  const { FsrsCardWorkbench } = await import('../FsrsCardWorkbench.js');
  const { KanaStudioWorkbench } = await import('../KanaStudioWorkbench.js');
  const { AdaptiveQuizWorkbench } = await import('../AdaptiveQuizWorkbench.js');
  const { useStudySessionStore } = await import('../../stores/useStudySessionStore.js');
  const doc = dom.dom.window.document;
  const click = async (label: string) => {
    const button = [...doc.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === label);
    expect(button).toBeDefined();
    await act(async () => button!.click());
  };
  try {
    await act(async () => dom.root.render(<TodayPlanWorkbench />));
    expect(doc.body.textContent).toContain('1/3');
    expect(doc.body.textContent).not.toContain('记录已完成活动');
    await click('开始');
    expect(useStudySessionStore.getState().planIntent?.courseUnitId).toBe(greet.id);
    await act(async () => dom.root.render(<FsrsCardWorkbench />));
    expect(doc.querySelector('[data-study-unit]')?.getAttribute('data-study-unit')).toBe(greet.id);
    await act(async () => dom.root.render(<CourseRouteBanner />));
    await click('去学 →');
    expect(useStudySessionStore.getState().planIntent?.courseUnitId).toBe(dakuten.id);
    await act(async () => dom.root.render(<KanaStudioWorkbench />));
    expect(doc.querySelector('[aria-label="查看 が 的发音与记忆详情"]')).not.toBeNull();
    expect(doc.querySelector('[aria-label="查看 あ 的发音与记忆详情"]')).toBeNull();
    await act(async () => useStudySessionStore.getState().startPlanStep({ id: 'cards', kind: 'CARDS', title: '复习', summary: '', navigateTo: 'CARDS' }));
    await act(async () => dom.root.render(<FsrsCardWorkbench />));
    expect(doc.querySelector('[data-review]')).not.toBeNull();
    await act(async () => useStudySessionStore.getState().startPlanStep(courseUnitPlanStep(grammar)));
    await act(async () => dom.root.render(<AdaptiveQuizWorkbench onOpenTutor={() => {}} />));
    expect(doc.querySelector('[data-questions]')?.getAttribute('data-questions')).toBe('target');
    await act(async () => useStudySessionStore.getState().setActiveTab('READING'));
    expect(useStudySessionStore.getState().planIntent).toBeNull();
  } finally { dom.teardown(); }
}, 15000);
