import React, { useState, useEffect, useRef, useCallback, Suspense, lazy } from 'react';
import { motion } from 'framer-motion';
import { toast, Toaster } from 'sonner';
import { DotPattern } from './components/magicui/index.js';
import { CommandPalette } from './components/CommandPalette.js';
import { AiTutorDrawer } from './components/AiTutorDrawer.js';
import { OnboardingDialog } from './components/OnboardingDialog.js';
import { LessonDialog } from './components/LessonDialog.js';
import { SelectionLookupPopup } from './components/SelectionLookupPopup.js';
import { AgentChatPanel } from './components/AgentChatPanel.js';
import { AppHeader } from './components/AppHeader.js';
import { AppSidebar } from './components/AppSidebar.js';
import { TodayPlanWorkbench } from './components/TodayPlanWorkbench.js';
import { AdaptiveQuizWorkbench } from './components/AdaptiveQuizWorkbench.js';
import { FsrsCardWorkbench } from './components/FsrsCardWorkbench.js';
import { CardDraftWorkbench } from './components/CardDraftWorkbench.js';
import { LearnerRadarDashboard } from './components/LearnerRadarDashboard.js';
// 首屏高频 Tab（TODAY/QUIZ/CARDS/RADAR）保持直连；其余重型工作台懒加载拆包，压 index 主包体积
const PracticePlanPanel = lazy(() =>
  import('./components/practice/PracticePlanPanel.js').then((m) => ({ default: m.PracticePlanPanel }))
);
const ReadingComprehensionWorkbench = lazy(() =>
  import('./components/ReadingComprehensionWorkbench.js').then((m) => ({
    default: m.ReadingComprehensionWorkbench,
  }))
);
const WritingStudioWorkbench = lazy(() =>
  import('./components/WritingStudioWorkbench.js').then((m) => ({ default: m.WritingStudioWorkbench }))
);
const TextbookCurriculum = lazy(() =>
  import('./components/TextbookCurriculum.js').then((m) => ({ default: m.TextbookCurriculum }))
);
const ListeningShadowingWorkbench = lazy(() =>
  import('./components/ListeningShadowingWorkbench.js').then((m) => ({
    default: m.ListeningShadowingWorkbench,
  }))
);
const PitchAccentCoach = lazy(() =>
  import('./components/PitchAccentCoach.js').then((m) => ({ default: m.PitchAccentCoach }))
);
const KanaStudioWorkbench = lazy(() =>
  import('./components/KanaStudioWorkbench.js').then((m) => ({ default: m.KanaStudioWorkbench }))
);
const HangulStudioWorkbench = lazy(() =>
  import('./components/HangulStudioWorkbench.js').then((m) => ({ default: m.HangulStudioWorkbench }))
);
const MistakeSprintWorkbench = lazy(() =>
  import('./components/MistakeSprintWorkbench.js').then((m) => ({ default: m.MistakeSprintWorkbench }))
);
import { ErrorBoundary } from './components/common/ErrorBoundary.js';
import { useEnsureGateway } from './hooks/useAgentGateway.js';
import { useLearningShell } from './hooks/useLearningShell.js';
import { resolveGuardTab } from './learning/learning-shell.js';
import { useCommandActions, useStartLessonQuiz } from './hooks/useCommandActions.js';
import { usePreferencesStore } from './stores/usePreferencesStore.js';
import { useStudySessionStore } from './stores/useStudySessionStore.js';
import { useUserProfileStore } from './stores/useUserProfileStore.js';
import {
  useCardsQuery,
  useMistakesQuery,
  useLearnerProfileQuery,
  useAddCardsMutation,
  useAddMistakeMutation,
  vocabToStudyCard,
} from './queries/useLearnerQueries.js';
import { sound } from './utils/audio.js';
import { cn } from './lib/utils.js';
import { checkForAppUpdate, logUpdaterFailure } from './platform/app-updater.js';

const COACH_WIDTH_MIN = 320;
const COACH_WIDTH_MAX = 960;

export function App() {
  useEnsureGateway();
  const theme = usePreferencesStore((s) => s.theme);
  const coachPanelWidthPx = usePreferencesStore((s) => s.coachPanelWidthPx);
  const setCoachPanelWidthPx = usePreferencesStore((s) => s.setCoachPanelWidthPx);
  const coachPanelOpen = usePreferencesStore((s) => s.coachPanelOpen);
  const coachThreadId = usePreferencesStore((s) => s.coachThreadId);
  const tutorDrawerOpen = usePreferencesStore((s) => s.tutorDrawerOpen);
  const tutorContextSnapshot = usePreferencesStore((s) => s.tutorContextSnapshot);
  const tutorPanelWidthPx = usePreferencesStore((s) => s.tutorPanelWidthPx);
  const setTutorPanelWidthPx = usePreferencesStore((s) => s.setTutorPanelWidthPx);
  const shell = useLearningShell();
  const activeTab = useStudySessionStore((s) => s.activeTab);
  const setActiveTab = useStudySessionStore((s) => s.setActiveTab);
  const isCommandOpen = useStudySessionStore((s) => s.isCommandOpen);
  const setIsCommandOpen = useStudySessionStore((s) => s.setIsCommandOpen);
  const isTutorOpen = useStudySessionStore((s) => s.isTutorOpen);
  const tutorSurface = useStudySessionStore((s) => s.tutorSurface);
  const tutorContext = useStudySessionStore((s) => s.tutorContext);
  const openTutor = useStudySessionStore((s) => s.openTutor);
  const closeTutor = useStudySessionStore((s) => s.closeTutor);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const coachResizeRef = useRef(false);
  const tutorResizeRef = useRef(false);

  // 偏好水合后：恢复自由教练 / 题目导师显隐
  useEffect(() => {
    const restore = () => {
      const prefs = usePreferencesStore.getState();
      if (prefs.tutorDrawerOpen && prefs.tutorContextSnapshot) {
        useStudySessionStore.getState().openTutor(prefs.tutorContextSnapshot);
        return;
      }
      if (prefs.coachPanelOpen) {
        useStudySessionStore.getState().openTutor(null);
      }
    };
    if (usePreferencesStore.persist.hasHydrated()) {
      restore();
      return;
    }
    return usePreferencesStore.persist.onFinishHydration(restore);
  }, []);

  // Tab 路由守卫：目标语种切换后当前活跃 Tab 若不合法，按模块语境降级（KANA/HANGUL→QUIZ、WRITING→READING 等）
  useEffect(() => {
    const guarded = resolveGuardTab(shell.track, activeTab);
    if (guarded !== activeTab) {
      setActiveTab(guarded);
    }
  }, [activeTab, shell.track, setActiveTab]);

  // 切轨道时清空 Agent 灌入的临时题包，避免 EN 题包压住 KO Query 结果
  useEffect(() => {
    useStudySessionStore.getState().clearPresentedQuiz();
    useStudySessionStore.getState().setQuestionIndex(0);
    useStudySessionStore.getState().resetReviewCardState();
  }, [shell.track]);

  const fetchProfile = useUserProfileStore((s) => s.fetchProfile);
  const profileUserId = useUserProfileStore((s) => s.profile.userId || 'student_web_01');

  // 等 Zustand persist 水合后再拉远端，避免默认 en 抢先覆盖本地已存的韩语/日语轨道
  useEffect(() => {
    const run = () => {
      void fetchProfile();
    };
    if (useUserProfileStore.persist.hasHydrated()) {
      run();
      return;
    }
    return useUserProfileStore.persist.onFinishHydration(run);
  }, [fetchProfile]);

  // 桌面端启动时静默检查 GitHub Releases；仅提示用户确认，不自动打断学习。
  // updater 只替换应用包，不会覆盖学习库与 Zustand 本地配置。
  useEffect(() => {
    let active = true;
    void checkForAppUpdate()
      .then((update) => {
        if (!active || !update) return;
        toast(`Lingua Studio ${update.version} 已可用`, {
          description: update.notes || '包含稳定性改进与学习体验优化。',
          duration: 12_000,
          action: {
            label: '立即更新',
            onClick: () => {
              void update.install().catch(logUpdaterFailure);
            },
          },
        });
      })
      .catch(logUpdaterFailure);
    return () => {
      active = false;
    };
  }, []);

  const onCoachResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      coachResizeRef.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    []
  );

  const onCoachResizePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!coachResizeRef.current) return;
      const next = window.innerWidth - e.clientX - 12;
      const max = Math.min(COACH_WIDTH_MAX, window.innerWidth - 24);
      setCoachPanelWidthPx(Math.min(max, Math.max(COACH_WIDTH_MIN, next)));
    },
    [setCoachPanelWidthPx]
  );

  const onCoachResizePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    coachResizeRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const onTutorResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      tutorResizeRef.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    []
  );

  const onTutorResizePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!tutorResizeRef.current) return;
      const next = window.innerWidth - e.clientX;
      const max = Math.min(COACH_WIDTH_MAX, window.innerWidth - 24);
      setTutorPanelWidthPx(Math.min(max, Math.max(COACH_WIDTH_MIN, next)));
    },
    [setTutorPanelWidthPx]
  );

  const onTutorResizePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    tutorResizeRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const { data: cards = [] } = useCardsQuery();
  const { data: mistakes = [] } = useMistakesQuery();
  const { data: metrics = [] } = useLearnerProfileQuery();
  const addCards = useAddCardsMutation();
  const addMistake = useAddMistakeMutation();
  const startLessonQuiz = useStartLessonQuiz();

  const unresolvedMistakesCount = mistakes.filter((m) => !m.isResolved).length;
  const commandActions = useCommandActions(unresolvedMistakesCount);

  const freeCoachVisible = isTutorOpen && tutorSurface === 'free';
  // 关闭仅隐藏；有 thread / 曾打开偏好时 keep-alive，避免丢本地气泡与断会话感知
  const freeCoachMounted =
    freeCoachVisible || coachPanelOpen || Boolean(coachThreadId);

  const questionTutorVisible =
    isTutorOpen && tutorSurface === 'question' && Boolean(tutorContext);
  const questionTutorContext = tutorContext ?? tutorContextSnapshot;
  const questionTutorMounted =
    questionTutorVisible ||
    tutorDrawerOpen ||
    Boolean(tutorContext) ||
    Boolean(tutorContextSnapshot);

  return (
    <div
      className={`h-[100dvh] ${
        theme === 'dark' ? 'dark bg-[#141312] text-stone-100' : 'bg-[#fbfaf8] text-stone-800'
      } transition-colors flex font-sans relative overflow-hidden`}
    >
      <Toaster position="top-center" richColors />
      <SelectionLookupPopup />
      <DotPattern
        width={26}
        height={26}
        cx={1.5}
        cy={1.5}
        cr={1}
        className="opacity-45 dark:opacity-15"
      />

      <CommandPalette
        isOpen={isCommandOpen}
        onClose={() => setIsCommandOpen(false)}
        actions={commandActions}
      />
      <AiTutorDrawer
        isOpen={questionTutorVisible}
        mounted={questionTutorMounted}
        onClose={closeTutor}
        context={questionTutorContext}
        widthPx={tutorPanelWidthPx}
        onResizePointerDown={onTutorResizePointerDown}
        onResizePointerMove={onTutorResizePointerMove}
        onResizePointerUp={onTutorResizePointerUp}
      />

      {/* 自由教练：关闭=隐藏不卸载；宽度可拖；Gateway 不断连 */}
      {freeCoachMounted ? (
        <div
          className={cn(
            'fixed inset-y-3 right-3 z-50 flex shadow-2xl',
            !freeCoachVisible && 'invisible pointer-events-none'
          )}
          style={{
            width: `min(100vw - 1.5rem, ${coachPanelWidthPx}px)`,
          }}
          aria-hidden={!freeCoachVisible}
        >
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="调整导师面板宽度"
            tabIndex={freeCoachVisible ? 0 : -1}
            className="w-1.5 shrink-0 cursor-ew-resize rounded-l-xl bg-stone-800/40 hover:bg-sky-500/40 active:bg-sky-500/60"
            onPointerDown={onCoachResizePointerDown}
            onPointerMove={onCoachResizePointerMove}
            onPointerUp={onCoachResizePointerUp}
            onPointerCancel={onCoachResizePointerUp}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') {
                e.preventDefault();
                setCoachPanelWidthPx(coachPanelWidthPx + 24);
              } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                setCoachPanelWidthPx(coachPanelWidthPx - 24);
              }
            }}
          />
          <div className="min-w-0 flex-1 overflow-hidden rounded-r-xl">
            <AgentChatPanel className="h-full" onClose={closeTutor} />
          </div>
        </div>
      ) : null}

      <AppSidebar
        mobileOpen={mobileNavOpen}
        onMobileOpenChange={setMobileNavOpen}
      />

      <div className="flex-1 min-w-0 min-h-0 flex flex-col relative z-10">
        <AppHeader onOpenMobileNav={() => setMobileNavOpen(true)} />

        <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-6">
          {shell.copy.interimBanner && (
            <div
              role="status"
              className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-950/90 dark:text-amber-100/90"
            >
              {shell.copy.interimBanner}
            </div>
          )}
          <ErrorBoundary
            key={`${shell.track}-${activeTab}`}
            variant="embedded"
            title="当前工作区遇到临时渲染异常"
            message="此模块由于外部数据或音频上下文发生了临时异常。您的个人学情资产已安全持久化，可点击下方按钮重新加载。"
          >
            <Suspense
              fallback={
                <div className="rounded-xl border p-8 text-center text-sm text-muted-foreground">
                  工作台加载中…
                </div>
              }
            >
            {activeTab === 'TODAY' && <TodayPlanWorkbench key={shell.track} />}

            {activeTab === 'PRACTICE_PLAN' && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                <PracticePlanPanel
                  key={shell.track}
                  userId={profileUserId}
                  language={shell.track}
                />
              </motion.div>
            )}

            {activeTab === 'QUIZ' && (
              <AdaptiveQuizWorkbench
                key={shell.track}
                onOpenTutor={(ctx) => {
                  sound.playClick();
                  openTutor(ctx);
                }}
              />
            )}

            {activeTab === 'CARDS' && (
              <>
                <CardDraftWorkbench key={`drafts-${shell.track}`} />
                <FsrsCardWorkbench key={shell.track} />
              </>
            )}

            {activeTab === 'READING' && (
              <ReadingComprehensionWorkbench
                key={shell.track}
                onOpenTutor={(ctx) => {
                  sound.playClick();
                  openTutor(ctx);
                }}
              />
            )}

            {activeTab === 'WRITING' && <WritingStudioWorkbench key={shell.track} />}

            {activeTab === 'TEXTBOOK' && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                <TextbookCurriculum
                  onStartLessonQuiz={startLessonQuiz}
                  onAddCardFromTextbook={(vocab) => addCards.mutate([vocabToStudyCard(vocab)])}
                  onAddCardsBatch={(list) =>
                    addCards.mutate(list.map((v, i) => vocabToStudyCard(v, i)))
                  }
                  onAskAiTutor={(selectedText, contextPrompt) => {
                    sound.playClick();
                    openTutor({
                      questionText: `${contextPrompt} “${selectedText}”`,
                      correctAnswer: selectedText,
                      skillTag: '教材精读 · 句法剖析',
                      explanation: `当前选中教材句段：“${selectedText}”。重点关注助词接续与语境敬体/简体用法。`,
                    });
                  }}
                />
              </motion.div>
            )}

            {activeTab === 'SHADOWING' && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                <ListeningShadowingWorkbench
                  onOpenTutor={(ctx) => {
                    sound.playClick();
                    openTutor(ctx);
                  }}
                  onAddMistake={(item) => addMistake.mutate(item)}
                />
              </motion.div>
            )}

            {activeTab === 'PITCH' && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                <PitchAccentCoach
                  onOpenTutor={(ctx) => {
                    sound.playClick();
                    openTutor(ctx);
                  }}
                />
              </motion.div>
            )}

            {activeTab === 'KANA' && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                <KanaStudioWorkbench
                  onOpenTutor={(ctx) => {
                    sound.playClick();
                    openTutor(ctx);
                  }}
                />
              </motion.div>
            )}

            {activeTab === 'HANGUL' && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                <HangulStudioWorkbench
                  onOpenTutor={(ctx) => {
                    sound.playClick();
                    openTutor(ctx);
                  }}
                />
              </motion.div>
            )}

            {activeTab === 'MISTAKES' && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                <MistakeSprintWorkbench
                  onOpenTutor={(ctx) => {
                    sound.playClick();
                    openTutor(ctx);
                  }}
                />
              </motion.div>
            )}

            {activeTab === 'RADAR' && (
              <LearnerRadarDashboard
                metrics={metrics}
                activeCardsCount={cards.length}
                unresolvedMistakesCount={unresolvedMistakesCount}
              />
            )}
            </Suspense>
          </ErrorBoundary>
          </div>
        </main>
        <OnboardingDialog />
        <LessonDialog />
      </div>
    </div>
  );
}
