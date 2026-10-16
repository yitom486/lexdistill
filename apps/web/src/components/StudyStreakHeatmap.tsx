import React, { useState } from 'react';
import { Flame, Calendar, Target } from 'lucide-react';
import { sound } from '../utils/audio.js';
import { Button } from './ui/button.js';
import { Progress } from './ui/progress.js';
import { DEFAULT_USER_ID } from '../queries/query-keys.js';
import { useUserProfileStore } from '../stores/useUserProfileStore.js';
import { useActivityHistoryQuery } from '../queries/useLearnerQueries.js';
import { StreakDayDetail, type HeatmapDay } from './learner-dashboard/StreakDayDetail.js';

const WEEKDAY_HEADERS = ['一', '二', '三', '四', '五', '六', '日'];
const INTENSITY_LABELS = ['无记录', '轻度', '中度', '高度', '满负荷'] as const;

export function StudyStreakHeatmap() {
  const profile = useUserProfileStore((s) => s.profile);
  const dailyTask = useUserProfileStore((s) => s.dailyTask);
  const setOpenProfile = useUserProfileStore((s) => s.setProfileModalOpen);
  const recordActivity = useUserProfileStore((s) => s.recordActivity);

  const effectiveUserId = profile.userId || DEFAULT_USER_ID;
  const {
    data: historyData,
    isLoading: historyLoading,
    isError: historyError,
    refetch: refetchHistory,
  } = useActivityHistoryQuery(28, effectiveUserId, profile.targetLanguage);
  const activityHistory = historyData ?? [];
  const historyFailed = historyError && historyData === undefined;
  const historyStale = historyError && historyData !== undefined;

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
      return 'bg-gradient-to-tr from-tone-amber-500 to-grad-yellow-400 border-line-yellow-300 text-tone-stone-950 font-bold shadow-md';
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

  const dayAriaLabel = (day: HeatmapDay): string => {
    if (day.isFuture) return `${day.date}：尚未到来`;
    const parts = [`${day.date}${day.isToday ? '（今天）' : ''}：${INTENSITY_LABELS[day.intensity]}`];
    if (day.quizCount > 0 || day.cardCount > 0) {
      parts.push(`做题 ${day.quizCount} 道，卡片 ${day.cardCount} 张`);
    }
    if (day.isGoalCompleted) parts.push('已达标');
    return parts.join('，');
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
                天连续学习（本地记录）
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
              今日练习进度（本地记录）
            </span>
            <span className="font-mono font-bold text-accent-ink-strong">
              {todayCompleted} / {todayTarget} ({targetPercent}%)
            </span>
          </div>
          <Progress value={targetPercent} indicatorClassName="bg-gradient-to-r from-tone-amber-500 to-tone-amber-600" />
        </div>
      </div>

      {historyData === undefined && historyLoading ? (
        <p className="text-xs text-ink-faint-soft">正在读取学习足迹…</p>
      ) : historyFailed ? (
        <div className="rounded-xl border border-line-rose-500o20 bg-wash-rose-500o5 p-4 text-xs text-ink-rose-800-rose-200 space-y-2">
          <p>学习足迹读取失败，日历暂无数据。</p>
          <Button size="sm" variant="ghost" onClick={() => void refetchHistory()}>
            重试
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-ink-ghost">
            <span className="flex items-center gap-1 font-medium text-ink-mute">
              <Calendar className="w-3.5 h-3.5 text-accent-ink" />
              最近 4 周学习投入热力图 (周一 ~ 周日)
            </span>
            <div className="flex items-center gap-1 text-xs" aria-label="图例：颜色越深投入越多">
              <span>少</span>
              <span className="w-2.5 h-2.5 rounded bg-line-soft inline-block" aria-hidden />
              <span className="w-2.5 h-2.5 rounded bg-tint-amber-200-amber-950 inline-block" aria-hidden />
              <span className="w-2.5 h-2.5 rounded bg-tint-amber-400-amber-800 inline-block" aria-hidden />
              <span className="w-2.5 h-2.5 rounded bg-tint-amber-500-amber-600 inline-block" aria-hidden />
              <span className="w-2.5 h-2.5 rounded bg-tint-amber-600-amber-500 inline-block" aria-hidden />
              <span>多</span>
            </div>
          </div>
          {historyLoading && (
            <p className="text-xs text-ink-faint-soft">正在读取学习足迹…</p>
          )}
          {historyStale && (
            <p className="text-xs text-ink-faint-soft">足迹可能不是最新。</p>
          )}

          {/* 星期表头 */}
          <div className="grid grid-cols-7 gap-1.5 text-center text-xs font-semibold text-ink-stone-400">
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
                  aria-label={dayAriaLabel(day)}
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
      )}

      {/* 选中日期详情 */}
      {selectedDay && historyData !== undefined && !historyFailed && (
        <StreakDayDetail
          day={days.find((day) => day.date === selectedDay.date) ?? selectedDay}
          todayBurst={dailyTask.isOvertimeBurst}
          todayDone={dailyTask.isGoalCompleted}
          onRecordQuiz={() => void recordActivity({ quizzes: 1 })}
          onRecordCards={() => void recordActivity({ cards: 1 })}
          onOpenProfile={() => setOpenProfile(true)}
          onClose={() => setSelectedDay(null)}
        />
      )}
    </div>
  );
}
