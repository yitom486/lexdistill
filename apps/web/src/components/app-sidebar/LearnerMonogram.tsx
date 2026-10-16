import { Flame } from 'lucide-react';
import { NumberTicker } from '../magicui/index.js';
import { Progress } from '../ui/progress.js';
import { cn } from '../../lib/utils.js';
import { sound } from '../../utils/audio.js';

interface LearnerMonogramProps {
  collapsed: boolean;
  displayName: string;
  levelBadge: string;
  streakDays: number;
  todayGoalLabel: string;
  todayGoalPercent: number;
  onOpenProfile: () => void;
  onGoToday: () => void;
}

/**
 * 学员档案：古典研习名册印章。
 * 档案入口与今日进度入口是两个同级原生 button（Enter/Space 由浏览器原生触发，
 * 互不冒泡）；外壳 div 非交互。数据由容器组装后传入。
 */
export function LearnerMonogram({
  collapsed,
  displayName,
  levelBadge,
  streakDays,
  todayGoalLabel,
  todayGoalPercent,
  onOpenProfile,
  onGoToday,
}: LearnerMonogramProps) {
  const monogram = displayName.trim().charAt(0).toUpperCase() || '学';

  return (
    <div className="border-b border-line-hairline">
      <button
        type="button"
        onClick={() => {
          sound.playClick();
          onOpenProfile();
        }}
        title="点击配置学员画像与每日打卡目标"
        aria-label="配置学员画像与每日打卡目标"
        className={cn(
          'block w-full text-left cursor-pointer transition-colors hover:bg-surface-coal/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring',
          collapsed ? 'p-2.5' : 'px-3.5 pt-3.5 pb-2'
        )}
      >
        <span className={cn('flex items-center gap-2.5', collapsed && 'justify-center')}>
          <span
            title={displayName}
            className="surface-elevated w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-serif text-base font-semibold text-ink select-none"
          >
            {monogram}
          </span>
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="text-sm font-serif font-semibold truncate text-ink">
                  {displayName}
                </span>
                <span className="font-mono text-[10px] px-1.5 py-px rounded border border-line-hairline bg-surface/80 text-ink-faint-soft shrink-0">
                  {levelBadge}
                </span>
              </span>
              <span className="text-[11px] text-ink-faint-soft truncate flex items-center gap-1 mt-0.5">
                <Flame className="w-3 h-3 text-gold-warm fill-gold-warm shrink-0" />
                连续{' '}
                <NumberTicker value={streakDays} className="font-mono font-bold inline" />{' '}
                天
              </span>
            </span>
          )}
        </span>
      </button>
      {!collapsed && (
        <div className="px-3.5 pb-3.5 pt-1">
          <button
            type="button"
            onClick={() => {
              sound.playClick();
              onGoToday();
            }}
            className="group space-y-1.5 w-full text-left cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            title="前往今日学习"
            aria-label={`前往今日学习，${todayGoalLabel}${todayGoalPercent}%`}
          >
            <span className="flex justify-between text-xs text-ink-faint-soft">
              <span>{todayGoalLabel}</span>
              <span className="font-mono">{todayGoalPercent}%</span>
            </span>
            <Progress
              value={todayGoalPercent}
              className="h-1 transition-shadow group-hover:shadow-[0_0_12px_0_var(--line-glow-hover)]"
              indicatorClassName="bg-gold-warm"
            />
          </button>
        </div>
      )}
    </div>
  );
}
