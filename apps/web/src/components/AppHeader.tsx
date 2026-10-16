import React from 'react';
import { motion } from 'framer-motion';
import { UpdateAvailableDot } from './app-header/UpdateAvailableDot.js';
import {
  BookOpen,
  Search,
  Compass,
  Moon,
  Sun,
  PanelLeft,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import { toast } from 'sonner';
import { sound } from '../utils/audio.js';
import { cn } from '../lib/utils.js';
import { usePreferencesStore } from '../stores/usePreferencesStore.js';
import { useStudySessionStore } from '../stores/useStudySessionStore.js';
import { UserProfileModal } from './UserProfileModal.js';
import { useGatewayStore } from '../stores/useGatewayStore.js';
import { getPlatform } from '../platform/capabilities.js';
import { checkForAppUpdate, logUpdaterFailure } from '../platform/app-updater.js';

interface AppHeaderProps {
  onOpenMobileNav?: () => void;
}

/** 应用更新信号：桌面端挂载时静默预检一次，有新版只点亮金色微标。 */
function useAppUpdateSignal(isDesktop: boolean) {
  const [updateChecking, setUpdateChecking] = React.useState(false);
  const [updateAvailable, setUpdateAvailable] = React.useState(false);

  React.useEffect(() => {
    if (!isDesktop) return;
    let active = true;
    void checkForAppUpdate()
      .then((update) => {
        if (active && update) setUpdateAvailable(true);
      })
      .catch((error) => {
        logUpdaterFailure(error);
      });
    return () => {
      active = false;
    };
  }, [isDesktop]);

  const handleCheckForUpdate = async () => {
    if (updateChecking) return;
    sound.playClick();
    setUpdateChecking(true);
    try {
      const update = await checkForAppUpdate();
      if (!update) {
        setUpdateAvailable(false);
        toast.success('当前已是最新版本');
        return;
      }
      setUpdateAvailable(true);
      toast(`Lingua Studio ${update.version} 已可用`, {
        description: update.notes || '包含稳定性改进与学习体验优化。',
        duration: 12_000,
        action: {
          label: '立即更新',
          onClick: () => {
            void update.install().catch((error) => {
              logUpdaterFailure(error);
              toast.error('更新安装失败，当前版本仍可继续使用。');
            });
          },
        },
      });
    } catch (error) {
      logUpdaterFailure(error);
      toast.error('暂时无法检查更新，请稍后再试。');
    } finally {
      setUpdateChecking(false);
    }
  };

  return { updateChecking, updateAvailable, handleCheckForUpdate };
}

function GhostIconButton({
  label,
  title,
  active,
  onClick,
  dot,
  children,
}: {
  label: string;
  title?: string | undefined;
  active?: boolean | undefined;
  onClick: () => void;
  dot?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      onClick={() => {
        sound.playClick();
        onClick();
      }}
      className={cn(
        'relative h-8 w-8 sm:h-9 sm:w-9 flex items-center justify-center rounded-lg transition-colors cursor-pointer select-none active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
        active
          ? 'text-ink bg-surface-warm/60'
          : 'text-ink-faint-soft hover:text-ink hover:bg-surface-warm/60'
      )}
    >
      {children}
      {dot}
    </button>
  );
}

export function AppHeader({ onOpenMobileNav }: AppHeaderProps) {
  const theme = usePreferencesStore((s) => s.theme);
  const toggleTheme = usePreferencesStore((s) => s.toggleTheme);
  const setIsCommandOpen = useStudySessionStore((s) => s.setIsCommandOpen);
  const openTutor = useStudySessionStore((s) => s.openTutor);
  const activeTab = useStudySessionStore((s) => s.activeTab);
  const setActiveTab = useStudySessionStore((s) => s.setActiveTab);
  const isConnected = useGatewayStore((s) => s.isConnected);
  const latencyMs = useGatewayStore((s) => s.latencyMs);
  const isDesktop = React.useMemo(() => {
    try {
      return getPlatform().isDesktop();
    } catch {
      return false;
    }
  }, []);
  // 快捷键绑定同时支持 ⌘K（macOS）与 Ctrl+K（Windows/Linux），显示必须与平台一致。
  const isMacLike = React.useMemo(() => {
    try {
      return /mac/i.test(getPlatform().getUserAgent());
    } catch {
      return false;
    }
  }, []);
  const { updateChecking, updateAvailable, handleCheckForUpdate } = useAppUpdateSignal(isDesktop);

  return (
    <header data-tauri-drag-region className="shrink-0 border-b border-line-hairline bg-surface-coal/85 backdrop-blur-md sticky top-0 z-40 transition-colors select-none">
      <div data-tauri-drag-region className="px-4 sm:px-6 h-14 sm:h-15 flex items-center justify-between gap-3">
        {/* 左侧：移动端汉堡菜单 + 品牌标志 + 网关微指示灯 */}
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <button
            type="button"
            className="md:hidden shrink-0 h-8 w-8 flex items-center justify-center rounded-lg text-ink-faint-soft hover:text-ink hover:bg-surface-warm/60 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            aria-label="打开导航"
            onClick={() => {
              sound.playClick();
              onOpenMobileNav?.();
            }}
          >
            <PanelLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2.5 shrink-0">
            <motion.button
              type="button"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => {
                sound.playClick();
                setActiveTab('TODAY');
              }}
              aria-label="回到今日学习"
              title="回到今日学习"
              className="w-8 h-8 rounded-lg border border-line-hairline bg-surface-coal text-gold-warm flex items-center justify-center shadow-xs cursor-pointer shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring overflow-hidden p-1"
            >
              <img src="/lexdistill-mark.svg" alt="LexDistill" className="w-full h-full object-contain rounded-xs" />
            </motion.button>

            <div className="flex items-baseline gap-2">
              <span className="font-serif font-semibold text-base sm:text-lg text-ink tracking-tight truncate">
                LexDistill
              </span>
            </div>

            {/* 网关连通微光点 */}
            <span
              className={cn(
                'w-1.5 h-1.5 rounded-full shrink-0 transition-colors',
                isConnected
                  ? 'bg-tone-emerald-500 shadow-xs shadow-line-emerald-500o50'
                  : 'bg-ink-amber-400'
              )}
              title={
                isConnected
                  ? `网关已联通${latencyMs ? ` (${latencyMs}ms)` : ''}`
                  : '离线模式'
              }
            />
          </div>
        </div>

        {/* 中间：Raycast 式指令胶囊 */}
        <div className="hidden sm:flex flex-1 max-w-sm mx-4 justify-center">
          <button
            type="button"
            onClick={() => {
              sound.playClick();
              setIsCommandOpen(true);
            }}
            className="w-full flex items-center justify-between gap-3 px-3 py-1.5 rounded-xl bg-surface-coal/80 border border-line-hairline shadow-2xs hover:border-gold-warm/30 text-ink-faint-soft text-xs transition-all cursor-pointer active:scale-[0.99] group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <span className="flex items-center gap-2 truncate">
              <Search className="w-3.5 h-3.5 text-ink-stone-400 group-hover:text-gold-warm transition-colors shrink-0" />
              <span className="truncate">搜索题库、课文、指令...</span>
            </span>
            <kbd className="text-xs font-mono px-1.5 py-px rounded bg-surface-dim border border-line-hairline text-ink-faint-soft shrink-0">
              {isMacLike ? '⌘K' : 'Ctrl+K'}
            </kbd>
          </button>
        </div>

        {/* 右侧：Action Pill + 幽灵图标组 + 窗体控件 */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* 移动端快捷搜索图标 */}
          <button
            type="button"
            className="sm:hidden h-8 w-8 flex items-center justify-center rounded-lg text-ink-faint-soft hover:text-ink hover:bg-surface-warm/60 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            aria-label="快捷搜索"
            onClick={() => {
              sound.playClick();
              setIsCommandOpen(true);
            }}
          >
            <Search className="w-4 h-4" />
          </button>

          {/* 语言助教：唯一高对比度操作位 */}
          <button
            type="button"
            onClick={() => {
              sound.playClick();
              openTutor(null);
            }}
            className="surface-elevated flex items-center gap-1.5 h-8 sm:h-9 px-2.5 sm:px-3 text-xs font-medium text-ink rounded-xl transition-all cursor-pointer select-none active:scale-[0.98] hover:shadow-[0_0_16px_0_var(--line-glow-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            title="唤起语言助教"
          >
            <Compass className="w-3.5 h-3.5 text-gold-warm shrink-0" />
            <span className="hidden sm:inline">语言助教</span>
          </button>

          <span aria-hidden className="hidden sm:block h-4 w-px bg-line-hairline mx-0.5" />

          <GhostIconButton
            label="打开设置页面"
            active={activeTab === 'SETTINGS'}
            onClick={() => setActiveTab('SETTINGS')}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </GhostIconButton>

          {isDesktop && (
            <GhostIconButton
              label="检查应用更新"
              title="检查应用更新"
              onClick={() => void handleCheckForUpdate()}
              dot={
                updateAvailable && !updateChecking ? (
                  <UpdateAvailableDot />
                ) : undefined
              }
            >
              <RefreshCw
                className={updateChecking ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'}
              />
            </GhostIconButton>
          )}

          <GhostIconButton
            label="切换明暗主题"
            title={theme === 'light' ? '切换到深色模式' : '切换到暖亮模式'}
            onClick={() => toggleTheme()}
          >
            {theme === 'light' ? (
              <Moon className="w-4 h-4" />
            ) : (
              <Sun className="w-4 h-4" />
            )}
          </GhostIconButton>
          {/* 桌面端右侧窗体控制位占位：实际控制按钮由全局置顶的 DesktopWindowChrome 渲染 */}
          {isDesktop && (
            <div
              aria-hidden="true"
              className="w-[101px] sm:w-[113px] shrink-0 pointer-events-none select-none"
            />
          )}
        </div>
      </div>

      <UserProfileModal />
    </header>
  );
}
