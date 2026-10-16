import { motion } from 'framer-motion';
import { Button } from '../ui/button.js';
import { sound } from '../../utils/audio.js';

export interface HeatmapDay {
  date: string;
  dayNumber: number;
  dayOfWeek: number; // 0=Mon, ..., 6=Sun
  intensity: 0 | 1 | 2 | 3 | 4; // 0=未打卡, 1=轻度, 2=中度, 3=高, 4=满负荷
  quizCount: number;
  cardCount: number;
  mistakesResolvedCount: number;
  isGoalCompleted: boolean;
  isToday?: boolean;
  isFuture?: boolean;
}

interface StreakDayDetailProps {
  day: HeatmapDay;
  todayBurst: boolean;
  todayDone: boolean;
  onRecordQuiz: () => void;
  onRecordCards: () => void;
  onOpenProfile: () => void;
  onClose: () => void;
}

/** 选中日期的学习战报：计数来自真实足迹，无记录日如实说明，不虚构。 */
export function StreakDayDetail({
  day,
  todayBurst,
  todayDone,
  onRecordQuiz,
  onRecordCards,
  onOpenProfile,
  onClose,
}: StreakDayDetailProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-3.5 rounded-2xl bg-wash-amber-500o10-amber-500o15 border border-tone-amber-500o25 flex flex-col sm:flex-row items-start sm:items-center justify-between text-xs gap-3"
      role="status"
      aria-label={`${day.date}学习战报`}
    >
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4">
        <span className="font-bold text-ink-amber-950-amber-200 flex items-center gap-1.5">
          {day.date} 学习战报
          {day.isToday && (
            <span className={`px-1.5 py-px rounded text-xs font-bold ${
              todayBurst
                ? 'bg-tone-amber-500 text-tone-stone-950'
                : todayDone
                ? 'bg-tone-emerald-600 text-tone-white'
                : 'bg-line-stone-300-stone-700 text-ink-soft'
            }`}>
              {todayBurst ? '超额连刷' : todayDone ? '已打卡' : '进行中'}
            </span>
          )}
        </span>
        {day.intensity > 0 || (day.isToday && (day.quizCount > 0 || day.cardCount > 0)) ? (
          <span className="text-ink-mute">
            完成做题 <strong className="text-accent-ink-warm font-mono">{day.quizCount}</strong> 道 ·
            复习卡片 <strong className="text-accent-ink-warm font-mono">{day.cardCount}</strong> 张
            {day.mistakesResolvedCount > 0 && (
              <> · 攻克错题 <strong className="text-accent-ink-warm font-mono">{day.mistakesResolvedCount}</strong> 项</>
            )}
            {day.isGoalCompleted && (
              <span className="ml-1.5 text-tone-emerald-600 dark:text-tone-emerald-400 font-semibold">达成目标</span>
            )}
          </span>
        ) : (
          <span className="text-ink-stone-500">当日暂未记录学习足迹</span>
        )}
      </div>
      <div className="flex items-center gap-2 self-end sm:self-auto">
        {day.isToday && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                sound.playClick();
                onRecordQuiz();
              }}
              className="h-7 text-xs px-2 py-0 border-line-amber-500o30"
            >
              答题+1
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                sound.playClick();
                onRecordCards();
              }}
              className="h-7 text-xs px-2 py-0 border-line-amber-500o30"
            >
              卡片+1
            </Button>
            <Button
              variant="amber"
              size="sm"
              onClick={() => {
                sound.playClick();
                onOpenProfile();
              }}
              className="h-7 text-xs px-2.5 py-0"
            >
              目标设置
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-7 text-xs text-ink-stone-400 hover:text-tone-stone-600 px-2 py-0"
        >
          关闭
        </Button>
      </div>
    </motion.div>
  );
}
