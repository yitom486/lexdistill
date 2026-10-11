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
 * 首字 Monogram + 衬线姓名 + 等宽微标 + 古籍金微火苗 + 极细进度微线。
 * 纯展示组件：数据由容器组装后传入。
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
    <div
      onClick={() => {
        sound.playClick();
        onOpenProfile();
      }}
      title="点击配置学员画像与每日打卡目标"
      className={cn(
        'border-b border-line-hairline cursor-pointer hover:bg-surface-coal/60 transition-colors',
        collapsed ? 'p-2.5' : 'p-3.5'
      )}
    >
      <div className={cn('flex items-center gap-2.5', collapsed && 'justify-center')}>
        <div
          title={displayName}
          className="surface-elevated w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-serif text-base font-semibold text-ink select-none"
        >
          {monogram}
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-sm font-serif font-semibold truncate text-ink">
                {displayName}
              </span>
              <span className="font-mono text-[10px] px-1.5 py-px rounded border border-line-hairline bg-surface/80 text-ink-faint-soft shrink-0">
                {levelBadge}
              </span>
            </div>
            <p className="text-[11px] text-ink-faint-soft truncate flex items-center gap-1 mt-0.5">
              <Flame className="w-3 h-3 text-gold-warm fill-gold-warm shrink-0" />
              连续{' '}
              <NumberTicker value={streakDays} className="font-mono font-bold inline" />{' '}
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
            onGoToday();
          }}
          className="group mt-3 space-y-1.5 w-full text-left cursor-pointer"
          title="前往今日学习"
        >
          <div className="flex justify-between text-[10px] text-ink-faint-soft">
            <span>{todayGoalLabel}</span>
            <span className="font-mono">{todayGoalPercent}%</span>
          </div>
          <Progress
            value={todayGoalPercent}
            className="h-1 transition-shadow duration-150 group-hover:shadow-[0_0_12px_0_var(--line-glow-hover)]"
            indicatorClassName="bg-gold-warm"
          />
        </button>
      )}
    </div>
  );
}
