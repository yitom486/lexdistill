import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { sound } from '../../utils/audio.js';
import { checkForAppUpdate } from '../../platform/app-updater.js';

/** 应用更新卡（仅桌面端渲染）：手动检查更新，安装走用户明确动作。 */
export function SettingsAppUpdateCard() {
  const [updateChecking, setUpdateChecking] = useState(false);

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
      toast(`LexDistill ${update.version} 已可用`, {
        description: update.notes || '包含稳定性改进与学习体验优化。',
        duration: 12_000,
        action: {
          label: '立即更新',
          onClick: () => {
            void update.install().catch(() => {
              toast.error('更新安装失败，当前版本仍可继续使用。');
            });
          },
        },
      });
    } catch {
      toast.error('暂时无法检查更新，请稍后再试。');
    } finally {
      setUpdateChecking(false);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-tone-amber-500o25 bg-wash-amber-50o60-amber-950o20 p-2.5 dark:border-line-amber-400o20 transition-colors">
      <div className="flex items-center justify-between font-medium text-ink-mute">
        <div className="flex items-center gap-1.5">
          <RefreshCw className="h-3.5 w-3.5 text-tone-amber-500" />
          <span>应用更新</span>
        </div>
        <Badge
          variant="outline"
          className="border-line-amber-500o30 px-1.5 py-0 text-sm text-accent-ink"
        >
          桌面端
        </Badge>
      </div>
      <p className="text-sm leading-relaxed text-ink-ghost">
        启动时会自动检查更新；你也可以随时手动检查。更新应用不会覆盖学习数据和本地配置。
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 w-full gap-1.5 border-line-amber-500o30 text-sm text-tone-amber-700 hover:bg-wash-amber-100o70 dark:text-ink-amber-300 dark:hover:bg-grad-amber-950o40 transition-colors"
        disabled={updateChecking}
        onClick={() => void handleCheckForUpdate()}
      >
        <RefreshCw className={updateChecking ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />
        {updateChecking ? '正在检查…' : '检查更新'}
      </Button>
    </div>
  );
}
