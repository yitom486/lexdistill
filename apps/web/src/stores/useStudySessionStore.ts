import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { GeneratedQuestion } from '@lexdistill/protocol';
import type { DailyPlanStepKind, DailyPlanStepTemplate, DailyPlanNavigateTarget } from '@lexdistill/learner-core';
import type { AiTutorContext } from './tutor-context.js';
import { usePreferencesStore } from './usePreferencesStore.js';

export type NavigationTab =
  | 'TODAY'
  | 'PRACTICE_PLAN'
  | 'QUIZ'
  | 'GENERATION'
  | 'CARDS'
  | 'KANA'
  | 'HANGUL'
  | 'TEXTBOOK'
  | 'READING'
  | 'WRITING'
  | 'SHADOWING'
  | 'PITCH'
  | 'MISTAKES'
  | 'RADAR'
  | 'STATS'
  | 'SETTINGS';

export interface PlanIntent {
  stepId: string;
  kind: DailyPlanStepKind;
  title: string;
  skillId?: string | undefined;
  skillName?: string | undefined;
  courseUnitId?: string | undefined;
  navigateTo?: DailyPlanNavigateTarget | undefined;
}

export type TutorSurface = 'free' | 'question';

export interface PresentedQuizPackage {
  surface: 'quiz' | 'cards' | 'kana_drill' | 'hangul_drill' | 'reading_quiz' | 'writing';
  layout?: 'SPLIT_PASSAGE_QUESTIONS' | 'SINGLE_COLUMN' | undefined;
  collectionId?: string | undefined;
  questions: GeneratedQuestion[];
  stepIndex: number;
  passageId?: string | undefined;
  presentedAt: string;
}

export interface StudySessionState {
  activeTab: NavigationTab;
  isCommandOpen: boolean;
  cardFilter: 'ALL' | 'VOCAB' | 'GRAMMAR' | 'CONFUSION';
  workbenchTab: 'study' | 'review' | 'library' | 'dictionary' | 'queue';
  questionIndex: number;
  reviewCardIndex: number;
  reviewCardFlipped: boolean;
  isTutorOpen: boolean;
  /** free=自由教练；question=题目追问抽屉 */
  tutorSurface: TutorSurface;
  tutorContext: AiTutorContext | null;
  /** Agent ui.present 灌入的临时题包（优先于静态/RPC 队列展示） */
  presentedQuiz: PresentedQuizPackage | null;
  /** 从今日计划点入某个模块时的引导意图 */
  planIntent: PlanIntent | null;

  setActiveTab: (tab: NavigationTab) => void;
  setIsCommandOpen: (open: boolean) => void;
  toggleCommandOpen: () => void;
  setCardFilter: (filter: 'ALL' | 'VOCAB' | 'GRAMMAR' | 'CONFUSION') => void;
  setWorkbenchTab: (tab: 'study' | 'review' | 'library' | 'dictionary' | 'queue') => void;
  setQuestionIndex: (index: number) => void;
  setReviewCardIndex: (index: number) => void;
  setReviewCardFlipped: (flipped: boolean) => void;
  resetReviewCardState: () => void;
  openTutor: (ctx?: AiTutorContext | null) => void;
  closeTutor: () => void;
  presentQuiz: (pkg: Omit<PresentedQuizPackage, 'presentedAt'> & { presentedAt?: string }) => void;
  clearPresentedQuiz: () => void;
  setPlanIntent: (intent: PlanIntent | null) => void;
  startPlanStep: (step: DailyPlanStepTemplate) => void;
  applyUiNavigate: (target: string, openTutor?: boolean) => void;
}

const TAB_SET = new Set<string>([
  'TODAY',
  'PRACTICE_PLAN',
  'QUIZ',
  'GENERATION',
  'CARDS',
  'KANA',
  'HANGUL',
  'TEXTBOOK',
  'READING',
  'WRITING',
  'SHADOWING',
  'PITCH',
  'MISTAKES',
  'RADAR',
  'STATS',
  'SETTINGS',
]);

function snapshotTutorContext(ctx: AiTutorContext) {
  return {
    questionText: ctx.questionText,
    ...(ctx.userAnswer !== undefined ? { userAnswer: ctx.userAnswer } : {}),
    correctAnswer: ctx.correctAnswer,
    skillTag: ctx.skillTag,
    explanation: ctx.explanation,
  };
}

export const useStudySessionStore = create<StudySessionState>()(
  persist(
    (set, get) => ({
  activeTab: 'TODAY',
  isCommandOpen: false,
  cardFilter: 'ALL',
  workbenchTab: 'study',
  questionIndex: 0,
  reviewCardIndex: 0,
  reviewCardFlipped: false,
  isTutorOpen: false,
  tutorSurface: 'free',
  tutorContext: null,
  presentedQuiz: null,
  planIntent: null,

  setActiveTab: (activeTab) => set((state) => ({
    activeTab,
    planIntent: state.planIntent?.navigateTo === activeTab ? state.planIntent : null,
  })),
  setIsCommandOpen: (isCommandOpen) => set({ isCommandOpen }),
  toggleCommandOpen: () => set((state) => ({ isCommandOpen: !state.isCommandOpen })),
  setCardFilter: (cardFilter) => set({ cardFilter }),
  setWorkbenchTab: (workbenchTab) => set({ workbenchTab }),
  setQuestionIndex: (questionIndex) => set({ questionIndex }),
  setReviewCardIndex: (reviewCardIndex) => set({ reviewCardIndex }),
  setReviewCardFlipped: (reviewCardFlipped) => set({ reviewCardFlipped }),
  resetReviewCardState: () => set({ reviewCardIndex: 0, reviewCardFlipped: false }),
  openTutor: (tutorContext = null) => {
    const prefs = usePreferencesStore.getState();
    const ctx = tutorContext ?? null;
    if (ctx) {
      set({ isTutorOpen: true, tutorSurface: 'question', tutorContext: ctx });
      prefs.setTutorContextSnapshot(snapshotTutorContext(ctx));
      prefs.setTutorDrawerOpen(true);
      prefs.setCoachPanelOpen(false);
      return;
    }
    // 自由教练：不清掉已有题目上下文（仅切换 surface），便于再开题目抽屉
    set({ isTutorOpen: true, tutorSurface: 'free' });
    prefs.setCoachPanelOpen(true);
    prefs.setTutorDrawerOpen(false);
  },
  closeTutor: () => {
    const { tutorSurface, tutorContext } = get();
    const prefs = usePreferencesStore.getState();
    // 只关显隐，保留 tutorContext，避免卸载丢气泡
    set({ isTutorOpen: false });
    if (tutorSurface === 'question') {
      if (tutorContext) {
        prefs.setTutorContextSnapshot(snapshotTutorContext(tutorContext));
      }
      prefs.setTutorDrawerOpen(false);
    } else {
      prefs.setCoachPanelOpen(false);
    }
  },
  presentQuiz: (pkg) =>
    set({
      presentedQuiz: {
        ...pkg,
        presentedAt: pkg.presentedAt ?? new Date().toISOString(),
        stepIndex: pkg.stepIndex ?? 0,
      },
      questionIndex: pkg.stepIndex ?? 0,
      activeTab:
        pkg.surface === 'reading_quiz'
          ? 'READING'
          : pkg.surface === 'writing'
            ? 'WRITING'
            : pkg.surface === 'kana_drill'
              ? 'KANA'
              : pkg.surface === 'hangul_drill'
                ? 'HANGUL'
                : 'QUIZ',
    }),
  clearPresentedQuiz: () => set({ presentedQuiz: null }),
  setPlanIntent: (planIntent) => set({ planIntent }),
  startPlanStep: (step) => set({
    activeTab: step.navigateTo,
    planIntent: { stepId: step.id, kind: step.kind, title: step.title,
      skillId: step.skillId, skillName: step.skillName, courseUnitId: step.courseUnitId,
      navigateTo: step.navigateTo },
    presentedQuiz: null,
    questionIndex: 0,
    reviewCardIndex: 0,
    reviewCardFlipped: false,
    ...(step.kind === 'NEW_WORDS' ? { cardFilter: 'VOCAB' as const, workbenchTab: 'study' as const } : {}),
    ...(step.kind === 'CARDS' ? { cardFilter: 'ALL' as const, workbenchTab: 'review' as const } : {}),
  }),
  applyUiNavigate: (target, openTutorFlag) => {
    if (target === 'TUTOR' || openTutorFlag) {
      get().openTutor(null);
      return;
    }
    if (TAB_SET.has(target)) {
      get().setActiveTab(target as NavigationTab);
    }
  },
    }),
    {
      name: 'lexdistill_session',
      storage: createJSONStorage(() => ({
        getItem: (name: string) => {
          try {
            const current = sessionStorage.getItem(name);
            if (current !== null) return current;
            return sessionStorage.getItem('lingua_studio_session');
          } catch {
            return null;
          }
        },
        setItem: (name: string, val: string) => {
          try {
            sessionStorage.setItem(name, val);
          } catch {}
        },
        removeItem: (name: string) => {
          try {
            sessionStorage.removeItem(name);
          } catch {}
        },
      })),
      partialize: (state) => ({
        activeTab: state.activeTab,
        cardFilter: state.cardFilter,
        workbenchTab: state.workbenchTab,
        questionIndex: state.questionIndex,
        reviewCardIndex: state.reviewCardIndex,
        reviewCardFlipped: state.reviewCardFlipped,
      }),
    }
  )
);
