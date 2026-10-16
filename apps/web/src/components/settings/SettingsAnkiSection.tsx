import { Plug } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '../ui/badge.js';
import { sound } from '../../utils/audio.js';
import {
  useAnkiStatusQuery,
  useSaveAnkiSettingsMutation,
} from '../../queries/useLearnerQueries.js';
import { Switch } from '../ui/switch.js';

interface SettingsAnkiSectionProps {
  isConnected: boolean;
  active: boolean;
}

/** Anki 推送（本机 AnkiConnect 桥接，默认关闭）：状态未知时开关禁用，不拿关闭冒充已知。 */
export function SettingsAnkiSection({ isConnected, active }: SettingsAnkiSectionProps) {
  const ankiStatus = useAnkiStatusQuery(active);
  const saveAnkiSettings = useSaveAnkiSettingsMutation();
  const known = ankiStatus.isSuccess;
  const enabled = ankiStatus.data?.enabled ?? false;

  return (
    <div className="space-y-4 rounded-3xl border border-line bg-surface p-5 shadow-sm sm:p-6">
      <div className="flex items-center justify-between font-medium text-ink-mute">
        <div className="flex items-center gap-1.5">
          <Plug className="w-3.5 h-3.5 text-tone-amber-500" />
          <span>推送到 Anki</span>
        </div>
        {ankiStatus.isPending ? (
          <Badge variant="outline" className="border-line px-1.5 py-0 text-sm text-ink-ghost">
            读取中…
          </Badge>
        ) : ankiStatus.isError ? (
          <button
            type="button"
            onClick={() => void ankiStatus.refetch()}
            title="重新读取 Anki 推送状态"
            className="border-line-amber-500o30 px-1.5 py-0 text-sm text-accent-ink rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            读取失败，点击重试
          </button>
        ) : ankiStatus.data ? (
          <Badge
            variant="outline"
            className="border-line-amber-500o30 px-1.5 py-0 text-sm text-accent-ink"
          >
            {ankiStatus.data.connected
              ? `已连接 v${ankiStatus.data.ankiVersion ?? '?'}`
              : '本机 Anki 未连接'}
          </Badge>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-2 rounded-xl border border-line-stone-200o80 bg-veil-stone-50o70 p-2.5 dark:border-tone-stone-800 dark:bg-veil-stone-900o50 transition-colors">
        <div className="min-w-0">
          <p className="text-sm leading-relaxed text-ink-ghost">
            把生词本卡片推送到本机 Anki（需打开 Anki + 安装 AnkiConnect 插件）。关闭时查词面板不显示推送入口。
          </p>
          <p className="mt-1 text-xs text-ink-ghost">
            {!known
              ? ankiStatus.isError
                ? '当前开关状态未知（读取失败），已禁用操作。'
                : '当前开关状态未知（读取中），已禁用操作。'
              : !isConnected
                ? '离线时不可更改推送开关，需连接网关。'
                : enabled
                  ? '推送已开启。'
                  : '推送已关闭。'}
          </p>
        </div>
        <Switch
          aria-label="推送到 Anki 开关"
          checked={enabled}
          disabled={!isConnected || saveAnkiSettings.isPending || !known}
          onCheckedChange={(v) => {
            sound.playClick();
            saveAnkiSettings.mutate(
              { enabled: v },
              {
                onError: (e) =>
                  toast.error(e instanceof Error ? e.message : 'Anki 设置保存失败。'),
              }
            );
          }}
        />
      </div>
    </div>
  );
}
