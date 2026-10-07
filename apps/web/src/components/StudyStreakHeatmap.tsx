import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Flame, Calendar, Target } from 'lucide-react';
import { sound } from '../utils/audio.js';
import { Button } from './ui/button.js';
import { Progress } from './ui/progress.js';
import { DEFAULT_USER_ID } from '../queries/query-keys.js';
import { useUserProfileStore } from '../stores/useUserProfileStore.js';
import { useActivityHistoryQuery } from '../queries/useLearnerQueries.js';

interface HeatmapDay {
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

const WEEKDAY_HEADERS = ['一', '二', '三', '四', '五', '六', '日'];

export function StudyStreakHeatmap() {
  const profile = useUserProfileStore((s) => s.profile);
  const dailyTask = useUserProfileStore((s) => s.dailyTask);
  const setOpenProfile = useUserProfileStore((s) => s.setProfileModalOpen);
  const recordActivity = useUserProfileStore((s) => s.recordActivity);

  const effectiveUserId = profile.userId || DEFAULT_USER_ID;
  const { data: activityHistory = [] } = useActivityHistoryQuery(
    28,
    effectiveUserId,
    profile.targetLanguage
  );

  const [selectedDay, setSelectedDay] = useState<HeatmapDay | null>(null);

  const streakDays = profile.streakDays;
  const todayCompleted = dailyTask.quizzesCount + dailyTask.cardsReviewedCount;
  const todayTarget = dailyTask.dailyGoalQuizzes + dailyTask.dailyGoalCards;
  const targetPercent = Math.min(100, Math.round((todayCompleted / Math.max(todayTarget, 1)) * 100));

  // 构造最近 4 周 (28 天) 结构化日历数据，按周一至周日自然周对齐
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const currentDayOfWeek = (now.getDay() + 6) % 7; // 0=Mon, ..., 6=Sun
  const startMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - currentDayOfWeek - 21);

  const days: HeatmapDay[] = Array.from({ length: 28 }, (_, i) => {
    const d = new Date(startMonday.getFullYear(), startMonday.getMonth(), startMonday.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    const isToday = dateStr === todayStr;
    const isFuture = d > now && !isToday;
    const dayOfWeek = (d.getDay() + 6) % 7;

    const hist = activityHistory.find((h) => h.activityDate === dateStr);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const dateLabel = isToday ? '今天' : `${month}月${day < 10 ? '0' + day : day}日`;

    if (isToday) {
      const quizCount = Math.max(dailyTask.quizzesCount, hist?.quizzesCount ?? 0);
      const cardCount = Math.max(dailyTask.cardsReviewedCount, hist?.cardsReviewedCount ?? 0);
      const intensity = ((dailyTask.intensityLevel || hist?.intensityLevel || 0) as 0 | 1 | 2 | 3 | 4);
      return {
        date: dateLabel,
        dayNumber: day,
        dayOfWeek,
        intensity,
        quizCount,
        cardCount,
        mistakesResolvedCount: Math.max(dailyTask.mistakesResolvedCount, hist?.mistakesResolvedCount ?? 0),
        isGoalCompleted: dailyTask.isGoalCompleted || (hist?.isGoalCompleted ?? false),
        isToday: true,
        isFuture: false,
      };
    }

    const quizCount = hist?.quizzesCount ?? 0;
    const cardCount = hist?.cardsReviewedCount ?? 0;
    const intensity = (Math.min(4, hist?.intensityLevel ?? 0) as 0 | 1 | 2 | 3 | 4);

    return {
      date: dateLabel,
      dayNumber: day,
      dayOfWeek,
      intensity: isFuture ? 0 : intensity,
      quizCount,
      cardCount,
      mistakesResolvedCount: hist?.mistakesResolvedCount ?? 0,
      isGoalCompleted: hist?.isGoalCompleted ?? false,
      isToday: false,
      isFuture,
    };
  });

  const getIntensityColor = (intensity: number, isToday?: boolean, isFuture?: boolean) => {
    if (isFuture) {
      return 'opacity-40 border-dashed border-line-soft bg-transparent text-ink-ghost cursor-default';
    }
    if (isToday && dailyTask.isOvertimeBurst) {
      return 'bg-gradient-to-tr from-tone-amber-500 to-grad-yellow-400 border-line-yellow-300 text-tone-stone-950 font-bold shadow-md animate-pulse';
    }
    if (isToday && dailyTask.isGoalCompleted) {
      return 'bg-tone-emerald-500 dark:bg-tone-emerald-600 border-ink-emerald-400 text-tone-white font-bold shadow-sm';
    }
    switch (intensity) {
      case 1:
        return 'bg-ink-amber-200 dark:bg-wash-amber-950o60 border-ink-amber-300 dark:border-ink-amber-900';
      case 2:
        return 'bg-ink-amber-400 dark:bg-wash-amber-800o80 border-tone-amber-500 dark:border-tone-amber-700';
      case 3:
        return 'bg-tint-amber-500-amber-600 border-tint-amber-600-amber-500 text-tone-stone-950';
      case 4:
        return 'bg-tint-amber-600-amber-500 border-accent-ink-warm text-surface-abyss shadow-sm';
      default:
        return 'bg-veil-stone-200o60 dark:bg-line-stone-800o50 border-line-stone-300o40 dark:border-line-stone-700o50';
    }
  };

  return (
    <div className="bg-paper-soft rounded-2xl p-5 border border-line-accent shadow-sm space-y-4">
      {/* 顶部统计摘要 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-3 border-b border-line-soft">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-wash-amber-500o15 text-accent-ink">
            <Flame className="w-5 h-5 fill-tone-amber-500" />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-ink">
                {streakDays}
              </span>
              <span className="text-xs font-semibold text-accent-ink-warm">
                天连续学习
              </span>
            </div>
            <p className="text-xs text-ink-ghost">
              保持每日习惯，提升长期记忆留存
            </p>
          </div>
        </div>

        {/* 每日目标进度 */}
        <div className="w-full sm:w-64 space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-ink-faint-soft flex items-center gap-1 font-medium">
              <Target className="w-3.5 h-3.5 text-accent-ink" />
              今日练习进度
            </span>
            <span className="font-mono font-bold text-accent-ink-strong">
              {todayCompleted} / {todayTarget} ({targetPercent}%)
            </span>
          </div>
          <Progress value={targetPercent} indicatorClassName="bg-gradient-to-r from-tone-amber-500 to-tone-amber-600" />
        </div>
      </div>

      {/* 28 天热力方格 (自然周对齐) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-ink-ghost">
          <span className="flex items-center gap-1 font-medium text-ink-mute">
            <Calendar className="w-3.5 h-3.5 text-accent-ink" />
            最近 4 周学习投入热力图 (周一 ~ 周日)
          </span>
          <div className="flex items-center gap-1 text-[10px]">
            <span>少</span>
            <span className="w-2.5 h-2.5 rounded bg-line-soft inline-block" />
            <span className="w-2.5 h-2.5 rounded bg-tint-amber-200-amber-950 inline-block" />
            <span className="w-2.5 h-2.5 rounded bg-tint-amber-400-amber-800 inline-block" />
            <span className="w-2.5 h-2.5 rounded bg-tint-amber-500-amber-600 inline-block" />
            <span className="w-2.5 h-2.5 rounded bg-tint-amber-600-amber-500 inline-block" />
            <span>多</span>
          </div>
        </div>

        {/* 星期表头 */}
        <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] font-semibold text-ink-stone-400">
          {WEEKDAY_HEADERS.map((h, idx) => (
            <div key={idx}>{h}</div>
          ))}
        </div>

        {/* 日历方格 */}
        <div className="grid grid-cols-7 gap-1.5 pt-0.5">
          {days.map((day, i) => {
            const isSelected = selectedDay?.date === day.date;
            return (
              <Button
                key={`${day.date}-${i}`}
                size="icon"
                variant="ghost"
                disabled={day.isFuture}
                onClick={() => {
                  if (day.isFuture) return;
                  sound.playClick();
                  setSelectedDay(day);
                }}
                className={`h-8 sm:h-9 w-full rounded-lg border text-xs font-mono transition-all ${getIntensityColor(
                  day.intensity,
                  day.isToday,
                  day.isFuture
                )} ${isSelected ? 'ring-2 ring-tone-amber-600 scale-105' : day.isFuture ? '' : 'hover:scale-105'}`}
              >
                {day.isToday ? '今' : day.isFuture ? '·' : day.dayNumber}
              </Button>
            );
          })}
        </div>
      </div>

      {/* 选中日期详情弹层 */}
      {selectedDay && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3.5 rounded-2xl bg-wash-amber-500o10-amber-500o15 border border-tone-amber-500o25 flex flex-col sm:flex-row items-start sm:items-center justify-between text-xs gap-3"
        >
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4">
            <span className="font-bold text-ink-amber-950-amber-200 flex items-center gap-1.5">
              📅 {selectedDay.date} 学习战报
              {selectedDay.isToday && (
                <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                  dailyTask.isOvertimeBurst
                    ? 'bg-tone-amber-500 text-tone-stone-950'
                    : dailyTask.isGoalCompleted
                    ? 'bg-tone-emerald-600 text-tone-white'
                    : 'bg-line-stone-300-stone-700 text-ink-soft'
                }`}>
                  {dailyTask.isOvertimeBurst ? '⚡超额连刷' : dailyTask.isGoalCompleted ? '✓已打卡' : '进行中'}
                </span>
              )}
            </span>
            {selectedDay.intensity > 0 || (selectedDay.isToday && (dailyTask.quizzesCount > 0 || dailyTask.cardsReviewedCount > 0)) ? (
              <span className="text-ink-mute">
                完成做题 <strong className="text-accent-ink-warm font-mono">{selectedDay.quizCount}</strong> 道 ·
                复习卡片 <strong className="text-accent-ink-warm font-mono">{selectedDay.cardCount}</strong> 张
                {selectedDay.mistakesResolvedCount > 0 && (
                  <> · 攻克错题 <strong className="text-accent-ink-warm font-mono">{selectedDay.mistakesResolvedCount}</strong> 项</>
                )}
                {selectedDay.isGoalCompleted && (
                  <span className="ml-1.5 text-tone-emerald-600 dark:text-tone-emerald-400 font-semibold">✓ 达成目标</span>
                )}
              </span>
            ) : (
              <span className="text-ink-stone-500">当日暂未记录学习足迹</span>
            )}
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            {selectedDay.isToday && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    sound.playClick();
                    recordActivity({ quizzes: 1 });
                  }}
                  className="h-7 text-[11px] px-2 py-0 border-line-amber-500o30"
                >
                  答题+1
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    sound.playClick();
                    recordActivity({ cards: 1 });
                  }}
                  className="h-7 text-[11px] px-2 py-0 border-line-amber-500o30"
                >
                  卡片+1
                </Button>
                <Button
                  variant="amber"
                  size="sm"
                  onClick={() => {
                    sound.playClick();
                    setOpenProfile(true);
                  }}
                  className="h-7 text-[11px] px-2.5 py-0"
                >
                  目标设置
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedDay(null)}
              className="h-7 text-[11px] text-ink-stone-400 hover:text-tone-stone-600 px-2 py-0"
            >
              关闭
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
