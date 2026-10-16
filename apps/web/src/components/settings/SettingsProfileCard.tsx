import { ChevronRight, Flame, User } from 'lucide-react';
import { Badge } from '../ui/badge.js';
import { sound } from '../../utils/audio.js';
import { useUserProfileStore } from '../../stores/useUserProfileStore.js';

/** 学习者画像与打卡入口：展示已保存画像，管理走画像弹窗。 */
export function SettingsProfileCard() {
  const profile = useUserProfileStore((s) => s.profile);
  const dailyTask = useUserProfileStore((s) => s.dailyTask);
  const setProfileModalOpen = useUserProfileStore((s) => s.setProfileModalOpen);

  return (
    <div className="space-y-4 rounded-3xl border border-line bg-surface p-5 shadow-sm sm:p-6">
      <div className="flex items-center justify-between font-medium text-ink-mute">
        <div className="flex items-center gap-1.5">
          <User className="w-3.5 h-3.5 text-tone-amber-500" />
          <span>学习者画像与打卡</span>
        </div>
        <Badge variant="outline" className="text-sm px-1.5 py-0 border-line-amber-500o30 text-accent-ink">
          {profile.studyGoal.replace('JLPT_', '')}
        </Badge>
      </div>

      <button
        type="button"
        onClick={() => {
          sound.playClick();
          setProfileModalOpen(true);
        }}
        className="group flex w-full cursor-pointer items-center justify-between rounded-xl border border-line bg-surface-dim p-2.5 text-left transition-colors hover:border-line-amber-500o30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-tone-amber-500 to-tone-amber-600 text-tone-stone-950 font-bold flex items-center justify-center text-sm shrink-0">
            {profile.displayName.slice(0, 1) || '学'}
          </div>
          <div className="min-w-0">
            <div className="font-medium text-ink-soft truncate">
              {profile.displayName || '学员'}
            </div>
            <div className="text-sm text-ink-ghost flex items-center gap-1.5">
              <span className="flex items-center gap-0.5 text-accent-ink font-medium">
                <Flame className="w-2.5 h-2.5 fill-current" />
                {profile.streakDays} 天连续
              </span>
              <span>·</span>
              <span>
                {dailyTask.quizzesCount + dailyTask.cardsReviewedCount}/
                {dailyTask.dailyGoalQuizzes + dailyTask.dailyGoalCards} 任务
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 text-sm text-ink-stone-400 group-hover:text-tone-amber-500 transition-colors shrink-0">
          <span>管理</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </div>
      </button>
    </div>
  );
}
