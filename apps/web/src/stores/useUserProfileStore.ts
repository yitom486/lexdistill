import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createMigratedStorage } from './store-storage.js';
import type {
  LearnerProfile,
  DailyTaskProgress,
  StudyGoal,
  LearnerLevel,
} from '@lexdistill/protocol';
import { sound } from '../utils/audio.js';
import { logger } from '@lexdistill/shared';
import { fireTaskCompletedConfetti, fireGoldenBurstConfetti } from '../utils/confetti.js';
import { GATEWAY_BASE_URL } from '../lib/api-client.js';
import { defaultGoalForTrack, findStudyGoalOption } from '../config/learner-profile-options.js';
import type { TargetLanguage } from '@lexdistill/learner-core';

const DEFAULT_USER_ID = 'student_web_01';

/**
 * 语言与备考目标只有一份事实：两者跨语言时必须一起改。
 *
 * 只改目标 → 语言跟随目标；只改语言 → 目标落到该语言的默认赛道。
 * 缺这一步时会出现「顶栏说日语、档案弹窗说英语」这种同屏两套语言的错位。
 */
function normalizeLanguageAndGoal(
  profile: Pick<LearnerProfile, 'targetLanguage' | 'studyGoal'>,
  updates: Partial<LearnerProfile>
): Pick<LearnerProfile, 'targetLanguage' | 'studyGoal'> {
  const goalLang = updates.studyGoal ? findStudyGoalOption(updates.studyGoal)?.lang : undefined;
  const nextLanguage = (goalLang ?? updates.targetLanguage ?? profile.targetLanguage) as TargetLanguage;
  const candidateGoal = updates.studyGoal ?? profile.studyGoal;
  const goalMatches = findStudyGoalOption(candidateGoal)?.lang === nextLanguage;
  return {
    targetLanguage: nextLanguage,
    studyGoal: goalMatches ? candidateGoal : defaultGoalForTrack(nextLanguage),
  };
}

const getTodayDateString = () => new Date().toISOString().slice(0, 10);

const defaultProfile: LearnerProfile = {
  userId: DEFAULT_USER_ID,
  displayName: '极光学者',
  targetLanguage: 'en',
  studyGoal: 'CET6',
  learnerLevel: 'BEGINNER',
  overallLevel: '待评测',
  overallProficiency: 0,
  streakDays: 0,
  maxStreakDays: 0,
  lastActiveDate: null,
  retentionRate: 1.0,
  dailyGoalQuizzes: 5,
  dailyGoalCards: 10,
  dailyGoalNewWords: 10,
  wordLevelFilter: null,
  totalStudyMinutes: 0,
  totalCardsReviewed: 0,
  totalQuizzesAnswered: 0,
  updatedAt: new Date().toISOString(),
};

const defaultDailyTask: DailyTaskProgress = {
  userId: DEFAULT_USER_ID,
  activityDate: getTodayDateString(),
  language: 'en',
  quizzesCount: 0,
  dailyGoalQuizzes: 5,
  cardsReviewedCount: 0,
  dailyGoalCards: 10,
  listeningMinutes: 0,
  mistakesResolvedCount: 0,
  readingCount: 0,
  isGoalCompleted: false,
  streakDays: 0,
  intensityLevel: 0,
  isOvertimeBurst: false,
  completedAt: null,
};

export interface UserProfileState {
  profile: LearnerProfile;
  dailyTask: DailyTaskProgress;
  isProfileModalOpen: boolean;
  lastCelebratedDate: string | null;
  isLoading: boolean;

  setProfileModalOpen: (open: boolean) => void;
  fetchProfile: (userId?: string) => Promise<void>;
  updateProfile: (updates: Partial<LearnerProfile>) => Promise<boolean>;
  recordActivity: (delta: {
    quizzes?: number;
    cards?: number;
    listeningMinutes?: number;
    mistakesResolved?: number;
    reading?: number;
  }) => Promise<void>;
}

export const useUserProfileStore = create<UserProfileState>()(
  persist(
    (set, get) => ({
      profile: defaultProfile,
      dailyTask: defaultDailyTask,
      isProfileModalOpen: false,
      lastCelebratedDate: null,
      isLoading: false,

      setProfileModalOpen: (open: boolean) => set({ isProfileModalOpen: open }),

      fetchProfile: async (userId = DEFAULT_USER_ID) => {
        set({ isLoading: true });
        try {
          const lang = get().profile.targetLanguage || 'en';
          const res = await fetch(
            `${GATEWAY_BASE_URL}/api/profile/${userId}?lang=${encodeURIComponent(lang)}`
          );
          if (res.ok) {
            const data = await res.json();
            if (data.profile) {
              set((state) => ({
                profile: { ...state.profile, ...data.profile },
                dailyTask: data.dailyTask
                  ? {
                      ...state.dailyTask,
                      ...data.dailyTask,
                      language:
                        data.dailyTask.language ||
                        data.profile.targetLanguage ||
                        state.dailyTask.language,
                    }
                  : {
                      ...state.dailyTask,
                      language: data.profile.targetLanguage || state.dailyTask.language,
                    },
              }));
            }
          }
        } catch {
          // 网关未启动或网络异常时优雅使用缓存的 local persisted state
        } finally {
          set({ isLoading: false });
        }
      },

      updateProfile: async (updates: Partial<LearnerProfile>) => {
        const currentProfile = get().profile;
        const normalized = normalizeLanguageAndGoal(currentProfile, updates);
        const newProfile = { ...currentProfile, ...updates, ...normalized };
        const nextLang = normalized.targetLanguage;

        // 乐观更新本地状态（含打卡语种戳，驱动壳层即时刷新）
        set({
          profile: newProfile,
          dailyTask: {
            ...get().dailyTask,
            language: nextLang,
            dailyGoalQuizzes: updates.dailyGoalQuizzes ?? get().dailyTask.dailyGoalQuizzes,
            dailyGoalCards: updates.dailyGoalCards ?? get().dailyTask.dailyGoalCards,
          },
        });

        try {
          const res = await fetch(`${GATEWAY_BASE_URL}/api/profile/${currentProfile.userId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...updates, ...normalized }),
          });
          if (res.ok) {
            const updated = await res.json();
            set({
              profile: { ...newProfile, ...updated },
              dailyTask: {
                ...get().dailyTask,
                language: updated.targetLanguage || nextLang,
              },
            });
            return true;
          }
        } catch (e) {
          logger.debug('[UserProfileStore] 更新远端档案失败，已保存在本地:', e);
        }
        return true;
      },

      recordActivity: async (delta) => {
        const currentTask = get().dailyTask;
        const currentProfile = get().profile;
        const today = getTodayDateString();

        // 计算新计数
        const newQuizzes = currentTask.quizzesCount + (delta.quizzes ?? 0);
        const newCards = currentTask.cardsReviewedCount + (delta.cards ?? 0);
        const newListening = currentTask.listeningMinutes + (delta.listeningMinutes ?? 0);
        const newMistakes = currentTask.mistakesResolvedCount + (delta.mistakesResolved ?? 0);
        const newReading = (currentTask.readingCount ?? 0) + (delta.reading ?? 0);

        const wasCompleted = currentTask.isGoalCompleted;
        const isCompleted =
          newQuizzes >= currentProfile.dailyGoalQuizzes &&
          newCards >= currentProfile.dailyGoalCards;

        const isBurst =
          newQuizzes >= currentProfile.dailyGoalQuizzes * 1.5 ||
          (newQuizzes >= currentProfile.dailyGoalQuizzes &&
            newCards >= currentProfile.dailyGoalCards * 1.5);

        let newStreak = currentProfile.streakDays;
        if (!wasCompleted && isCompleted) {
          newStreak = currentProfile.streakDays + 1;
        }

        const optimisticTask: DailyTaskProgress = {
          ...currentTask,
          activityDate: today,
          quizzesCount: newQuizzes,
          cardsReviewedCount: newCards,
          listeningMinutes: newListening,
          mistakesResolvedCount: newMistakes,
          readingCount: newReading,
          isGoalCompleted: isCompleted,
          streakDays: newStreak,
          isOvertimeBurst: isBurst,
          completedAt: isCompleted ? (currentTask.completedAt ?? new Date().toISOString()) : null,
        };

        const optimisticProfile: LearnerProfile = {
          ...currentProfile,
          streakDays: newStreak,
          maxStreakDays: Math.max(currentProfile.maxStreakDays, newStreak),
          totalQuizzesAnswered: currentProfile.totalQuizzesAnswered + (delta.quizzes ?? 0),
          totalCardsReviewed: currentProfile.totalCardsReviewed + (delta.cards ?? 0),
          totalStudyMinutes: currentProfile.totalStudyMinutes + (delta.listeningMinutes ?? 0),
          lastActiveDate: today,
        };

        // 庆祝彩蛋触发逻辑
        const lastCelebrated = get().lastCelebratedDate;
        if (!wasCompleted && isCompleted && lastCelebrated !== today) {
          sound.playFanfare();
          fireTaskCompletedConfetti();
          set({ lastCelebratedDate: today });
        } else if (isBurst && !currentTask.isOvertimeBurst) {
          sound.playSuccess();
          fireGoldenBurstConfetti();
        }

        set({
          dailyTask: optimisticTask,
          profile: optimisticProfile,
        });

        // 异步同步至 Gateway 后端
        try {
          await fetch(`${GATEWAY_BASE_URL}/api/task/activity/${currentProfile.userId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...delta, date: today }),
          });
        } catch (e) {
          logger.debug('[UserProfileStore] 同步足迹打卡至网关失败:', e);
        }
      },
    }),
    {
      name: 'lexdistill_user_profile',
      storage: createMigratedStorage(['study_studio_user_profile']),
      partialize: (state) => ({
        profile: state.profile,
        dailyTask: state.dailyTask,
        lastCelebratedDate: state.lastCelebratedDate,
      }),
    }
  )
);
