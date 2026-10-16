import { useState } from 'react';
import { Download, LoaderCircle, DatabaseBackup } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { sound } from '../../utils/audio.js';
import { backupDesktopDatabase } from '../../platform/tauri-capabilities.js';

/** 学习数据管理卡（仅桌面端渲染）：备份走用户明确动作，取消保存对话框不算错误。 */
export function SettingsDataCard() {
  const [backupPending, setBackupPending] = useState(false);

  const handleBackupDatabase = async () => {
    if (backupPending) return;
    sound.playClick();
    setBackupPending(true);
    try {
      const dest = await backupDesktopDatabase();
      toast.success('学习数据库已备份', { description: dest });
    } catch (e) {
      // 用户取消保存对话框不算错误，不打扰
      const message = e instanceof Error ? e.message : '备份失败，请稍后重试。';
      if (!message.includes('未选择保存路径')) {
        toast.error(message);
      }
    } finally {
      setBackupPending(false);
    }
  };

  return (
    <div className="space-y-4 rounded-3xl border border-line bg-surface p-5 shadow-sm sm:p-6">
      <div className="flex items-center gap-1.5 font-medium text-ink-mute">
        <DatabaseBackup className="w-3.5 h-3.5 text-tone-amber-500" />
        <span>学习数据管理</span>
        <Badge variant="outline" className="text-sm px-1.5 py-0 border-line-amber-500o30 text-accent-ink">
          桌面端
        </Badge>
      </div>
      <div className="rounded-xl border border-line-stone-200o80 bg-veil-stone-50o70 p-2.5 dark:border-tone-stone-800 dark:bg-veil-stone-900o50 transition-colors">
        <p className="text-sm leading-relaxed text-ink-ghost">
          学习库保存在本机应用数据目录，随应用重启保留。建议定期备份；恢复时把备份文件放回原目录并重启应用即可。
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2 h-7 gap-1 px-2 text-sm"
          disabled={backupPending}
          onClick={() => void handleBackupDatabase()}
        >
          {backupPending ? (
            <LoaderCircle className="h-3 w-3 animate-spin" />
          ) : (
            <Download className="h-3 w-3" />
          )}
          备份学习数据库
        </Button>
      </div>
    </div>
  );
}
