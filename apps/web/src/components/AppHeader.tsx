import React from 'react';
import { motion } from 'framer-motion';
import {
  GraduationCap,
  Search,
  Sparkles,
  Moon,
  Sun,
  PanelLeft,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button.js';
import { sound } from '../utils/audio.js';
import { usePreferencesStore } from '../stores/usePreferencesStore.js';
import { useStudySessionStore } from '../stores/useStudySessionStore.js';
import { UserProfileModal } from './UserProfileModal.js';
import { useGatewayStore } from '../stores/useGatewayStore.js';
import { getPlatform } from '../platform/capabilities.js';
import { checkForAppUpdate, logUpdaterFailure } from '../platform/app-updater.js';
import { DesktopWindowControls } from './DesktopWindowControls.js';

interface AppHeaderProps {
  onOpenMobileNav?: () => void;
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
  const [updateChecking, setUpdateChecking] = React.useState(false);

  const handleCheckForUpdate = async () => {
    if (updateChecking) return;
    sound.playClick();
    setUpdateChecking(true);
    try {
      const update = await checkForAppUpdate();
      if (!update) {
        toast.success('当前已是最新版本');
        return;
      }
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

  return (
    <header data-tauri-drag-region className="shrink-0 border-b border-line-stone-200o80-stone-800o80 bg-veil-whiteo85 dark:bg-surface-h1a1917o85 backdrop-blur-md sticky top-0 z-40 transition-colors select-none">
      <div data-tauri-drag-region className="px-4 sm:px-6 h-14 sm:h-15 flex items-center justify-between gap-3">
        {/* 左侧：移动端汉堡菜单 + 品牌标志 + 网关微指示灯 */}
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <Button
            variant="outline"
            size="icon"
            className="md:hidden shrink-0 h-8 w-8"
            aria-label="打开导航"
            onClick={() => {
              sound.playClick();
              onOpenMobileNav?.();
            }}
          >
            <PanelLeft className="w-4 h-4" />
          </Button>

          <div className="flex items-center gap-2 shrink-0">
            <motion.div
              whileHover={{ scale: 1.05, rotate: 2 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => sound.playClick()}
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-tr from-tone-amber-500 to-tone-amber-600 text-tone-stone-950 font-bold flex items-center justify-center shadow-xs cursor-pointer shrink-0"
            >
              <GraduationCap className="w-4 h-4 sm:w-5 sm:h-5 text-tone-stone-950" />
            </motion.div>

            <span className="font-bold text-base sm:text-lg text-ink tracking-tight font-serif truncate">
              Lingua Studio
            </span>

            {/* 极简网关连通状态指示灯 */}
            <span
              className={`w-2 h-2 rounded-full shrink-0 transition-colors ${
                isConnected
                  ? 'bg-tone-emerald-500 shadow-xs shadow-line-emerald-500o50'
                  : 'bg-ink-amber-400'
              }`}
              title={
                isConnected
                  ? `网关已联通${latencyMs ? ` (${latencyMs}ms)` : ''}`
                  : '离线模式'
              }
            />
          </div>
        </div>

        {/* 中间：居中全局快捷搜索与指令栏 (桌面端主要导航入口) */}
        <div className="hidden sm:flex flex-1 max-w-sm mx-4 justify-center">
          <button
            type="button"
            onClick={() => {
              sound.playClick();
              setIsCommandOpen(true);
            }}
            className="w-full flex items-center justify-between gap-3 px-3 py-1.5 rounded-xl border border-line-stone-200o90-stone-800o90 bg-veil-stone-100o70-stone-900o60 hover:bg-surface-stone-100-stone-900 hover:border-tone-amber-500o40 text-ink-ghost text-xs transition-all shadow-2xs cursor-pointer group"
          >
            <div className="flex items-center gap-2 truncate">
              <Search className="w-3.5 h-3.5 text-ink-stone-400 group-hover:text-tone-amber-500 transition-colors shrink-0" />
              <span className="truncate">搜索题库、课文、指令...</span>
            </div>
            <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-dim border border-line text-ink-ghost shadow-2xs shrink-0">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* 右侧：精简高价值工具集（移动端快捷搜索、AI助教快速唤起、控制中心设置、主题切换） */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* 移动端快捷搜索图标 */}
          <Button
            variant="ghost"
            size="icon"
            className="sm:hidden h-8 w-8 text-ink-faint"
            aria-label="快捷搜索"
            onClick={() => {
              sound.playClick();
              setIsCommandOpen(true);
            }}
          >
            <Search className="w-4 h-4" />
          </Button>

          {/* AI 助教快速唤起按钮 */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              sound.playClick();
              openTutor(null);
            }}
            className="gap-1.5 border-line-amber-500o30 bg-wash-amber-500o5 hover:bg-wash-amber-500o15 text-ink-amber-900-amber-200 font-medium h-8 sm:h-9 px-2.5 sm:px-3 text-xs"
            title="唤起 AI 交互助教"
          >
            <Sparkles className="w-3.5 h-3.5 text-tone-amber-500" />
            <span className="hidden sm:inline">AI 助教</span>
          </Button>

          <Button
            variant={activeTab === 'SETTINGS' ? 'default' : 'outline'}
            size="sm"
            className="h-8 gap-1.5 px-2.5 text-xs sm:h-9 sm:px-3"
            onClick={() => {
              sound.playClick();
              setActiveTab('SETTINGS');
            }}
            aria-label="打开设置页面"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span className="hidden md:inline">设置</span>
          </Button>

          {/* 桌面端更新入口：放在顶栏，避免用户需要滚动设置面板查找 */}
          {isDesktop && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 border-line-amber-500o30 px-2.5 text-tone-amber-700 hover:bg-wash-amber-100o70 dark:text-ink-amber-300 dark:hover:bg-grad-amber-950o40 sm:h-9 sm:px-3 transition-colors"
              disabled={updateChecking}
              onClick={() => void handleCheckForUpdate()}
              title="检查应用更新"
              aria-label="检查应用更新"
            >
              <RefreshCw className={updateChecking ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
              <span>更新</span>
            </Button>
          )}

          {/* 明暗模式主题切换 */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              sound.playClick();
              toggleTheme();
            }}
            aria-label="切换明暗主题"
            className="h-8 w-8 sm:h-9 sm:w-9 text-ink-faint hover:text-accent-ink"
            title={theme === 'light' ? '切换到深色模式' : '切换到暖亮模式'}
          >
            {theme === 'light' ? (
              <Moon className="w-4 h-4 text-tone-amber-600" />
            ) : (
              <Sun className="w-4 h-4 text-ink-amber-400" />
            )}
          </Button>
          {isDesktop && <DesktopWindowControls />}
        </div>
      </div>

      <UserProfileModal />
    </header>
  );
}

