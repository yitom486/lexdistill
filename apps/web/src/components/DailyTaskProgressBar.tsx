import React from 'react';
import { Flame, CheckCircle2, Zap, BookOpen, Layers } from 'lucide-react';
import { Badge } from './ui/badge.js';
import { Progress } from './ui/progress.js';
import { useUserProfileStore } from '../stores/useUserProfileStore.js';
import { sound } from '../utils/audio.js';

export function DailyTaskProgressBar() {
  const dailyTask = useUserProfileStore((s) => s.dailyTask);
  const profile = useUserProfileStore((s) => s.profile);
  const setOpenProfile = useUserProfileStore((s) => s.setProfileModalOpen);

  const quizRatio = Math.min(
    1,
    dailyTask.quizzesCount / Math.max(dailyTask.dailyGoalQuizzes, 1)
  );
  const cardRatio = Math.min(
    1,
    dailyTask.cardsReviewedCount / Math.max(dailyTask.dailyGoalCards, 1)
  );
  const overallRatio = (quizRatio + cardRatio) / 2;

  const isCompleted = dailyTask.isGoalCompleted;
  const isBurst = dailyTask.isOvertimeBurst;

  return (
    <div
      onClick={() => {
        sound.playClick();
        setOpenProfile(true);
      }}
      title="点击配置目标或查看每日打卡进度"
      className={`group flex items-center gap-2.5 px-3 py-1.5 rounded-2xl border transition-all cursor-pointer shadow-xs ${ isBurst ? 'bg-gradient-to-r from-wash-amber-500o15 via-grad-yellow-500o20 to-wash-amber-500o15 border-tone-amber-500o40 hover:border-tone-amber-500 text-ink-amber-950-amber-100 ring-1 ring-line-amber-500o30' : isCompleted ? 'bg-wash-emerald-500o10 border-line-emerald-500o30 hover:border-line-emerald-500o50 text-ink-emerald-950 dark:text-tint-emerald-100' : 'bg-veil-stone-100o80-stone-900o60 border-line-accent hover:border-tone-amber-500o40 text-ink-mute' }`}
    >
      {/* 状态徽章图标 */}
      <div className="flex items-center gap-1.5 shrink-0">
        {isBurst ? (
          <div className="flex items-center gap-1 text-tone-amber-500 animate-pulse font-bold text-xs">
            <Zap className="w-3.5 h-3.5 fill-tone-amber-500" />
            <span className="hidden xl:inline text-[11px]">超额连刷</span>
          </div>
        ) : isCompleted ? (
          <div className="flex items-center gap-1 text-ink-emerald-600-emerald-400 font-semibold text-xs">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span className="hidden xl:inline text-[11px]">已打卡</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 text-accent-ink font-semibold text-xs">
            <Flame className="w-3.5 h-3.5 text-tone-amber-500" />
            <span className="hidden xl:inline text-[11px]">今日目标</span>
          </div>
        )}
      </div>

      {/* 题目进度微胶囊 */}
      <div className="hidden sm:flex items-center gap-1.5 text-[11px]">
        <BookOpen className="w-3 h-3 text-ink-hint shrink-0" />
        <span className="font-mono font-medium">
          {dailyTask.quizzesCount}/{dailyTask.dailyGoalQuizzes}
        </span>
        <span className="text-ink-hint text-[10px]">题</span>
      </div>

      {/* 闪卡进度微胶囊 */}
      <div className="hidden sm:flex items-center gap-1.5 text-[11px]">
        <Layers className="w-3 h-3 text-ink-hint shrink-0" />
        <span className="font-mono font-medium">
          {dailyTask.cardsReviewedCount}/{dailyTask.dailyGoalCards}
        </span>
        <span className="text-ink-hint text-[10px]">卡</span>
      </div>

      {/* 综合打卡进度条 */}
      <div className="w-14 sm:w-16 h-1.5 bg-line-soft rounded-full overflow-hidden shrink-0">
        <div
          className={`h-full transition-all duration-500 rounded-full ${
            isBurst
              ? 'bg-gradient-to-r from-ink-amber-400 to-line-yellow-300'
              : isCompleted
              ? 'bg-tone-emerald-500'
              : 'bg-tone-amber-500'
          }`}
          style={{ width: `${Math.round(overallRatio * 100)}%` }}
        />
      </div>

      {/* 连胜天数统计 */}
      <Badge
        variant="outline"
        className={`text-[10px] px-1.5 py-0 h-4 border shrink-0 ${
          isCompleted
            ? 'border-line-emerald-500o30 text-ink-emerald-700-emerald-300 bg-wash-emerald-500o10'
            : 'border-tone-amber-500o20 text-accent-ink-warm'
        }`}
      >
        {profile.streakDays > 0 ? `连胜 ${profile.streakDays} 天` : '未打卡'}
      </Badge>
    </div>
  );
}
