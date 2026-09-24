import React, { useMemo, useState } from 'react';
import {
  Zap,
  Layers,
  BookOpen,
  Headphones,
  Mic,
  AlertTriangle,
  TrendingUp,
  Newspaper,
  PenLine,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeft,
  User,
  Flame,
  Sparkles,
  CalendarCheck,
  ClipboardList,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { NumberTicker } from './magicui/index.js';
import { Button } from './ui/button.js';
import { Badge } from './ui/badge.js';
import { Progress } from './ui/progress.js';
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
  type SidebarIconKey,
  type SidebarNavItemDef,
  type SidebarRuntimeCounts,
} from '../config/sidebar-nav.js';
import {
  useCardsQuery,
  useMistakesQuery,
  useQuestionsQuery,
  useDailyPlanQuery,
} from '../queries/useLearnerQueries.js';

export interface AppSidebarProps {
  /** 可选覆盖；缺省由 TanStack Query 实时计算 */
  quizProgress?: string | undefined;
  cardCount?: number | undefined;
  unresolvedMistakeCount?: number | undefined;
  planProgress?: string | undefined;
  mobileOpen?: boolean | undefined;
  onMobileOpenChange?: ((open: boolean) => void) | undefined;
}

const SIDEBAR_ICONS: Record<SidebarIconKey, LucideIcon> = {
  Zap,
  Layers,
  BookOpen,
  Headphones,
  Mic,
  AlertTriangle,
  TrendingUp,
  Newspaper,
  PenLine,
  User,
  Flame,
  Sparkles,
  CalendarCheck,
  ClipboardList,
};

type ResolvedNavItem = {
  id: NavigationTab;
  label: string;
  icon: LucideIcon;
  badge?: string | undefined;
};

function resolveNavItem(def: SidebarNavItemDef, runtime: SidebarRuntimeCounts): ResolvedNavItem {
  return {
    id: def.id,
    label: def.label,
    icon: SIDEBAR_ICONS[def.icon],
    badge: resolveSidebarBadge(def.badge, runtime),
  };
}

function NavButton({
  item,
  active,
  collapsed,
  onSelect,
}: {
  item: ResolvedNavItem;
  active: boolean;
  collapsed: boolean;
  onSelect: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      title={item.label}
      onClick={() => {
        sound.playClick();
        onSelect();
      }}
      className={cn(
        'w-full flex items-center gap-2.5 rounded-xl text-left text-xs font-medium transition-colors cursor-pointer',
        collapsed ? 'justify-center px-2 py-2.5' : 'px-2.5 py-2',
        active
          ? 'bg-wash-amber-500o15 text-ink-amber-950-amber-200 border border-tone-amber-500o25'
          : 'text-ink-faint-soft hover:bg-veil-stone-200o60-stone-800o80 border border-transparent'
      )}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {!collapsed && (
        <>
          <span className="truncate flex-1">{item.label}</span>
          {item.badge && (
            <Badge
              variant={active ? 'amber' : 'secondary'}
              className="px-1.5 py-0 text-[10px] font-bold rounded-full pointer-events-none"
            >
              {item.badge}
            </Badge>
          )}
        </>
      )}
    </button>
  );
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

  const [openGroups, setOpenGroups] = useState(buildSidebarOpenState);

  const runtime = useMemo<SidebarRuntimeCounts>(
    () => ({
      quizProgress,
      cardCount,
      unresolvedMistakeCount,
      planProgress,
    }),
    [quizProgress, cardCount, unresolvedMistakeCount, planProgress]
  );

  const groups = useMemo(
    () =>
      SIDEBAR_NAV_GROUPS.map((group) => {
        const filteredItems = group.items.filter((item) => {
          if (item.tracks && !item.tracks.includes(shell.track)) return false;
          return shell.allowedTabs.includes(item.id);
        });
        return {
          ...group,
          items: filteredItems.map((item) => resolveNavItem(item, runtime)),
        };
      }).filter((group) => group.items.length > 0),
    [runtime, shell.track, shell.allowedTabs]
  );

  const toggleGroup = (id: string) => {
    sound.playClick();
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const userProfile = useUserProfileStore((s) => s.profile);
  const dailyTask = useUserProfileStore((s) => s.dailyTask);
  const setOpenProfileModal = useUserProfileStore((s) => s.setProfileModalOpen);

  const todayCompleted = dailyTask.quizzesCount + dailyTask.cardsReviewedCount;
  const todayTarget = dailyTask.dailyGoalQuizzes + dailyTask.dailyGoalCards;
  const todayPercent = Math.min(100, Math.round((todayCompleted / Math.max(todayTarget, 1)) * 100));

  const goalMeta = findStudyGoalOption(userProfile.studyGoal);
  const goalBadge =
    goalMeta?.lang === 'ko'
      ? goalMeta.id === 'TOPIK_I'
        ? 'TOPIK I'
        : 'TOPIK II'
      : userProfile.studyGoal === 'KAOYAN_EN'
        ? '考研英语'
        : userProfile.studyGoal === 'CET6'
          ? '六级 CET-6'
          : userProfile.studyGoal === 'CET4'
            ? '四级 CET-4'
            : userProfile.studyGoal.replace('JLPT_', '');

  const profile = {
    displayName: userProfile.displayName || '学习者',
    levelBadge: goalBadge,
    streakDays: userProfile.streakDays,
    todayGoalLabel: dailyTask.isGoalCompleted ? '今日已打卡' : '今日目标进度',
    todayGoalPercent: todayPercent,
  };

  return (
    <aside
      className={cn(
        'flex flex-col min-h-0 border-r border-tone-stone-200o80-stone-800 bg-veil-whiteo90 dark:bg-surface-h1a1917o95 backdrop-blur-md h-full',
        collapsed ? 'w-[4.25rem]' : 'w-[16.5rem]',
        'transition-[width]'
      )}
    >
      <div
        onClick={() => {
          sound.playClick();
          setOpenProfileModal(true);
        }}
        title="点击配置学员画像与每日打卡目标"
        className={cn(
          'border-b border-tone-stone-200o80-stone-800 cursor-pointer hover:bg-veil-stone-100o60 dark:hover:bg-veil-stone-900o50 transition-colors',
          collapsed ? 'p-2.5' : 'p-3.5'
        )}
      >
        <div className={cn('flex items-center gap-2.5', collapsed && 'justify-center')}>
          <div className="w-9 h-9 rounded-xl bg-wash-amber-500o15 border border-line-amber-500o30 text-ink-amber-800-amber-300 flex items-center justify-center shrink-0">
            <User className="w-4 h-4" />
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold font-serif truncate text-ink">
                  {profile.displayName}
                </span>
                <Badge variant="amber" className="text-[10px] px-1.5 py-0">
                  {profile.levelBadge}
                </Badge>
              </div>
              <p className="text-[11px] text-ink-stone-500 truncate flex items-center gap-1">
                <Flame className="w-3 h-3 text-tone-amber-500 fill-tone-amber-500" />
                连续{' '}
                <NumberTicker value={profile.streakDays} className="font-mono font-bold inline" />{' '}
                天
              </p>
            </div>
          )}
        </div>
        {!collapsed && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              sound.playClick();
              onNavigate('TODAY');
            }}
            className="mt-3 space-y-1.5 w-full text-left cursor-pointer"
          >
            <div className="flex justify-between text-[10px] text-ink-stone-500">
              <span>{profile.todayGoalLabel}</span>
              <span className="font-mono">{profile.todayGoalPercent}%</span>
            </div>
            <Progress value={profile.todayGoalPercent} className="h-1.5" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {groups.map((group) => {
          const expanded = openGroups[group.id] !== false;
          return (
            <div key={group.id}>
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-ink-stone-400 hover:text-ink-faint cursor-pointer"
                >
                  {expanded ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                  {group.label}
                </button>
              )}
              {(collapsed || expanded) && (
                <div className="space-y-0.5 mt-0.5">
                  {group.items.map((item) => (
                    <NavButton
                      key={item.id}
                      item={item}
                      active={activeTab === item.id}
                      collapsed={collapsed}
                      onSelect={() => onNavigate(item.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {shell.comingSoonModules.length > 0 && (
          <div>
            {!collapsed && (
              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-ink-stone-400">
                即将推出 · {shell.trackName}
              </div>
            )}
            <div className="space-y-0.5 mt-0.5">
              {shell.comingSoonModules.map((mod) => {
                const Icon = SIDEBAR_ICONS[mod.icon];
                return (
                  <button
                    key={mod.tab}
                    type="button"
                    title={mod.hint}
                    onClick={() => {
                      sound.playClick();
                      toast.message(mod.hint, {
                        description: `${shell.trackName}轨道 interim · ${mod.label}`,
                      });
                    }}
                    className={cn(
                      'w-full flex items-center gap-2 rounded-lg text-[11px] transition-colors cursor-pointer',
                      'text-ink-hint opacity-70',
                      'hover:bg-veil-stone-100o80 dark:hover:bg-line-stone-800o50',
                      collapsed ? 'justify-center px-0 py-2' : 'px-2 py-1.5'
                    )}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    {!collapsed && (
                      <>
                        <span className="truncate flex-1 text-left">{mod.label}</span>
                        <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">
                          即将
                        </Badge>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {showDesktopCollapse && (
        <div className="p-2 border-t border-tone-stone-200o80-stone-800">
          <Button
            variant="ghost"
            size="sm"
            className={cn('w-full', collapsed && 'px-0')}
            onClick={() => {
              sound.playClick();
              setSidebarCollapsed(!collapsed);
            }}
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
