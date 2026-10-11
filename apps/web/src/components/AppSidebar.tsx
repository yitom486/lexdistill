import React, { useMemo, useState } from 'react';
import { PanelLeftClose, PanelLeft } from 'lucide-react';
import { Button } from './ui/button.js';
import { cn } from '../lib/utils.js';
import { sound } from '../utils/audio.js';
import { usePreferencesStore } from '../stores/usePreferencesStore.js';
import { useUserProfileStore } from '../stores/useUserProfileStore.js';
import { useStudySessionStore, type NavigationTab } from '../stores/useStudySessionStore.js';
import { useLearningShell } from '../hooks/useLearningShell.js';
import { findStudyGoalOption } from '../config/learner-profile-options.js';
import {
  SIDEBAR_NAV_GROUPS,
  buildSidebarOpenState,
  resolveSidebarBadge,
  type SidebarNavItemDef,
  type SidebarRuntimeCounts,
} from '../config/sidebar-nav.js';
import {
  useCardsQuery,
  useMistakesQuery,
  useQuestionsQuery,
  useDailyPlanQuery,
} from '../queries/useLearnerQueries.js';
import { SIDEBAR_ICONS } from './app-sidebar/sidebar-icons.js';
import { LearnerMonogram } from './app-sidebar/LearnerMonogram.js';
import { SidebarGroups, type SidebarGroup } from './app-sidebar/SidebarGroups.js';
import type { NavItem } from './app-sidebar/NavButton.js';

export interface AppSidebarProps {
  /** 可选覆盖；缺省由 TanStack Query 实时计算 */
  quizProgress?: string | undefined;
  cardCount?: number | undefined;
  unresolvedMistakeCount?: number | undefined;
  planProgress?: string | undefined;
  mobileOpen?: boolean | undefined;
  onMobileOpenChange?: ((open: boolean) => void) | undefined;
}

function resolveNavItem(def: SidebarNavItemDef, runtime: SidebarRuntimeCounts): NavItem {
  return {
    id: def.id,
    label: def.label,
    icon: SIDEBAR_ICONS[def.icon],
    badge: resolveSidebarBadge(def.badge, runtime),
  };
}

function resolveLevelBadge(studyGoal: string): string {
  const goalMeta = findStudyGoalOption(studyGoal as Parameters<typeof findStudyGoalOption>[0]);
  if (goalMeta?.lang === 'ko') return goalMeta.id === 'TOPIK_I' ? 'TOPIK I' : 'TOPIK II';
  if (studyGoal === 'KAOYAN_EN') return '考研英语';
  if (studyGoal === 'CET6') return '六级 CET-6';
  if (studyGoal === 'CET4') return '四级 CET-4';
  return studyGoal.replace('JLPT_', '');
}

function SidebarBody({
  collapsed,
  quizProgress,
  cardCount,
  unresolvedMistakeCount,
  planProgress,
  onNavigate,
  showDesktopCollapse,
}: {
  collapsed: boolean;
  quizProgress?: string | undefined;
  cardCount?: number | undefined;
  unresolvedMistakeCount?: number | undefined;
  planProgress?: string | undefined;
  onNavigate: (tab: NavigationTab) => void;
  showDesktopCollapse?: boolean | undefined;
}) {
  const setSidebarCollapsed = usePreferencesStore((s) => s.setSidebarCollapsed);
  const activeTab = useStudySessionStore((s) => s.activeTab);
  const shell = useLearningShell();
  const userProfile = useUserProfileStore((s) => s.profile);
  const dailyTask = useUserProfileStore((s) => s.dailyTask);
  const setOpenProfileModal = useUserProfileStore((s) => s.setProfileModalOpen);

  const [openGroups, setOpenGroups] = useState(buildSidebarOpenState);

  const runtime = useMemo<SidebarRuntimeCounts>(
    () => ({ quizProgress, cardCount, unresolvedMistakeCount, planProgress }),
    [quizProgress, cardCount, unresolvedMistakeCount, planProgress]
  );

  const groups = useMemo<SidebarGroup[]>(
    () =>
      SIDEBAR_NAV_GROUPS.map((group) => ({
        id: group.id,
        label: group.label,
        items: group.items
          .filter(
            (item) =>
              (!item.tracks || item.tracks.includes(shell.track)) &&
              shell.allowedTabs.includes(item.id)
          )
          .map((item) => resolveNavItem(item, runtime)),
      })).filter((group) => group.items.length > 0),
    [runtime, shell.track, shell.allowedTabs]
  );

  const todayCompleted = dailyTask.quizzesCount + dailyTask.cardsReviewedCount;
  const todayTarget = dailyTask.dailyGoalQuizzes + dailyTask.dailyGoalCards;
  const todayPercent = Math.min(100, Math.round((todayCompleted / Math.max(todayTarget, 1)) * 100));

  return (
    <aside
      className={cn(
        'flex flex-col min-h-0 border-r border-line-hairline bg-surface-coal h-full',
        collapsed ? 'w-[4.25rem]' : 'w-[16.5rem]',
        'transition-[width,background-color,border-color,color]'
      )}
    >
      <LearnerMonogram
        collapsed={collapsed}
        displayName={userProfile.displayName || '学习者'}
        levelBadge={resolveLevelBadge(userProfile.studyGoal)}
        streakDays={userProfile.streakDays}
        todayGoalLabel={dailyTask.isGoalCompleted ? '今日已打卡' : '今日目标进度'}
        todayGoalPercent={todayPercent}
        onOpenProfile={() => setOpenProfileModal(true)}
        onGoToday={() => onNavigate('TODAY')}
      />

      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        <SidebarGroups
          groups={groups}
          collapsed={collapsed}
          activeTab={activeTab}
          openGroups={openGroups}
          comingSoon={shell.comingSoonModules}
          trackName={shell.trackName}
          onToggleGroup={(id) => setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }))}
          onSelect={onNavigate}
        />
      </div>

      {showDesktopCollapse && (
        <div className="p-2 border-t border-line-hairline">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'w-full text-ink-faint-soft hover:text-ink hover:bg-surface-warm/60',
              collapsed && 'px-0'
            )}
            onClick={() => {
              sound.playClick();
              setSidebarCollapsed(!collapsed);
            }}
            title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
            aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
          >
            {collapsed ? (
              <PanelLeft className="w-4 h-4" />
            ) : (
              <>
                <PanelLeftClose className="w-4 h-4" />
                <span>折叠侧栏</span>
              </>
            )}
          </Button>
        </div>
      )}
    </aside>
  );
}

export function AppSidebar({
  quizProgress: quizProgressProp,
  cardCount: cardCountProp,
  unresolvedMistakeCount: mistakeCountProp,
  mobileOpen = false,
  onMobileOpenChange,
}: AppSidebarProps) {
  const collapsed = usePreferencesStore((s) => s.sidebarCollapsed);
  const questionIndex = useStudySessionStore((s) => s.questionIndex);

  const { data: questions = [] } = useQuestionsQuery();
  const { data: cards = [] } = useCardsQuery();
  const { data: mistakes = [] } = useMistakesQuery();
  const { data: dailyPlan } = useDailyPlanQuery();

  const nowIso = new Date().toISOString();
  const dueCardCount = cards.filter((c) => !c.dueAt || c.dueAt <= nowIso).length;
  const unresolvedMistakeCount =
    mistakeCountProp ?? mistakes.filter((m) => !m.isResolved).length;
  const quizProgress =
    quizProgressProp ??
    `${Math.min(questionIndex + 1, questions.length)}/${questions.length || 1}`;
  const cardCount = cardCountProp ?? dueCardCount;
  const planProgress = dailyPlan
    ? `${dailyPlan.completedCount}/${dailyPlan.totalCount || 1}`
    : undefined;

  const navigate = (tab: NavigationTab) => {
    useStudySessionStore.getState().setActiveTab(tab);
    onMobileOpenChange?.(false);
  };

  return (
    <>
      <div className="hidden md:flex h-full sticky top-0 z-30 shrink-0">
        <SidebarBody
          collapsed={collapsed}
          quizProgress={quizProgress}
          cardCount={cardCount}
          unresolvedMistakeCount={unresolvedMistakeCount}
          planProgress={planProgress}
          onNavigate={navigate}
          showDesktopCollapse
        />
      </div>

      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <button
            type="button"
            className="absolute inset-0 bg-veil-stone-950o50 backdrop-blur-sm cursor-pointer border-0"
            aria-label="关闭菜单"
            onClick={() => onMobileOpenChange?.(false)}
          />
          <div className="relative z-10 h-full shadow-2xl">
            <SidebarBody
              collapsed={false}
              quizProgress={quizProgress}
              cardCount={cardCount}
              unresolvedMistakeCount={unresolvedMistakeCount}
              planProgress={planProgress}
              onNavigate={navigate}
            />
          </div>
        </div>
      )}
    </>
  );
}
