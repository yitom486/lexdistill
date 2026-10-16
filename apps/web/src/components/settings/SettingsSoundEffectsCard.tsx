import { Volume2, VolumeX } from 'lucide-react';
import { Switch } from '../ui/switch.js';
import { usePreferencesStore } from '../../stores/usePreferencesStore.js';

/**
 * 界面音效开关：按键/答对/答错等短音效，默认开启。
 * 关闭后一律静默；学习朗读与麦克风录音不受影响（由各自入口控制）。
 */
export function SettingsSoundEffectsCard() {
  const enabled = usePreferencesStore((s) => s.soundEffectsEnabled);
  const setEnabled = usePreferencesStore((s) => s.setSoundEffectsEnabled);

  return (
    <div className="space-y-4 rounded-3xl border border-line bg-surface p-5 shadow-sm sm:p-6">
      <div className="flex items-center justify-between font-medium text-ink-mute">
        <div className="flex items-center gap-1.5">
          {enabled ? (
            <Volume2 className="w-3.5 h-3.5 text-tone-amber-500" />
          ) : (
            <VolumeX className="w-3.5 h-3.5 text-ink-ghost" />
          )}
          <span>界面音效</span>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => setEnabled(checked)}
          aria-label="界面音效开关"
        />
      </div>
      <p className="text-xs text-ink-ghost leading-relaxed">
        {enabled
          ? '按键、答对与答错有轻柔提示音。'
          : '已静音：按键与反馈不再发声，学习朗读不受影响。'}
      </p>
    </div>
  );
}
