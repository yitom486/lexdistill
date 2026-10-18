import React, { useState } from 'react';
import { toast } from 'sonner';
import { GraduationCap, Footprints, Sparkles } from 'lucide-react';
import { sound } from '../utils/audio.js';
import { useUserProfileStore } from '../stores/useUserProfileStore.js';
import { useStudySessionStore } from '../stores/useStudySessionStore.js';
import { usePreferencesStore } from '../stores/usePreferencesStore.js';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateAllLearningQueries, useLearnerProfileQuery } from '../queries/useLearnerQueries.js';
import { getLearningShellConfig } from '../learning/learning-shell.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog.js';
import { Button } from './ui/button.js';
import type { LearnerLevel } from '@lexdistill/protocol';

type Track = 'ja' | 'en' | 'ko';

const TRACKS: Array<{ id: Track; name: string; hint: string }> = [
  { id: 'ja', name: '日语', hint: '五十音 · JLPT' },
  { id: 'en', name: '英语', hint: '四六级 · 考研' },
  { id: 'ko', name: '韩语', hint: '谚文 · TOPIK' },
];

const LEVELS: Array<{ id: LearnerLevel; name: string; desc: Record<Track, string> }> = [
  {
    id: 'NOVICE',
    name: '零基础',
    desc: {
      ja: '五十音还没认完，从字母跟读开始',
      en: '从最基础的日常单词开始',
      ko: '谚文还没认完，从字母跟读开始',
    },
  },
  {
    id: 'BEGINNER',
    name: '初级',
    desc: {
      ja: 'N5 左右，能认假名，会一点单词',
      en: '四级左右，能读短文',
      ko: 'TOPIK1 左右，能认谚文',
    },
  },
  {
    id: 'INTERMEDIATE',
    name: '中级及以上',
    desc: {
      ja: 'N4 以上——建议考个级，免得内容太浅',
      en: '六级/考研以上——建议考个级',
      ko: 'TOPIK2 以上——建议考个级',
    },
  },
];

/** 新人是否 virgin：网关画像 lastActiveDate 为空且零产出（种子卡不算）。 */
function useIsFresh(): boolean {
  const profile = useUserProfileStore((s) => s.profile);
  if (profile.lastActiveDate) return false;
  if ((profile.totalQuizzesAnswered ?? 0) > 0) return false;
  if ((profile.totalCardsReviewed ?? 0) > 0) return false;
  return true;
}

/**
 * 引导是否该出现：只判状态，不碰副作用，便于单测锁定门禁。
 * 已选过（onboardingCompleted）或本会话已跳过（dismissed）都不再出现。
 */
export function shouldShowOnboarding(state: {
  fresh: boolean;
  isFetched: boolean;
  dismissed: boolean;
  onboardingCompleted: boolean;
}): boolean {
  return state.fresh && state.isFetched && !state.dismissed && !state.onboardingCompleted;
}

/**
 * 首次启动定级（纯前端，无迁移）：
 * 选轨道 → 自评水平 → 入门进带路，自评高档指去画像页定级考。
 * 完成或跳过都会写 `onboardingCompleted`（Zustand persist），之后不再出现；
 * 需要改档位去设置页。
 */
export function OnboardingDialog() {
  const fresh = useIsFresh();
  // 画像是异步拉的：没拉完之前不弹，避免每次刷新闪一下
  const { isFetched } = useLearnerProfileQuery();
  const profile = useUserProfileStore((s) => s.profile);
  const updateProfile = useUserProfileStore((s) => s.updateProfile);
  const setActiveTab = useStudySessionStore((s) => s.setActiveTab);
  const onboardingCompleted = usePreferencesStore((s) => s.onboardingCompleted);
  const completeOnboarding = usePreferencesStore((s) => s.completeOnboarding);
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState(false);
  const [track, setTrack] = useState<Track>('ja');
  const [level, setLevel] = useState<LearnerLevel>('NOVICE');
  const [saving, setSaving] = useState(false);

  /** 完成或跳过：本地标记一次，之后不再弹（跨重启生效）。 */
  const finish = () => {
    setDismissed(true);
    completeOnboarding();
  };

  const open = shouldShowOnboarding({ fresh, isFetched, dismissed, onboardingCompleted });
  if (!open) return null;

  const shell = getLearningShellConfig(track);

  const handleDone = async (goExam: boolean) => {
    if (saving) return;
    sound.playClick();
    setSaving(true);
    await updateProfile({
      targetLanguage: track,
      learnerLevel: level,
      studyGoal: profile.studyGoal,
    });
    await invalidateAllLearningQueries(queryClient);
    setSaving(false);
    sound.playCorrect();
    finish();
    if (goExam) {
      setActiveTab('RADAR');
      toast.success(`已切到${shell.trackName}轨道，去画像页考个级，免得内容太浅`);
    } else {
      setActiveTab('TODAY');
      toast.success(`已切到${shell.trackName}轨道，跟着今日学习走就行`);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) finish();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-tone-amber-500" />
            先定个起点，内容才不会劝退你
          </DialogTitle>
          <DialogDescription>
            两个问题，10 秒钟。选错了随时在设置里改，高估了自己可以去考级。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <p className="text-xs font-bold text-ink-stone-500">1 · 学哪门？</p>
            <div className="grid grid-cols-3 gap-2">
              {TRACKS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    sound.playClick();
                    setTrack(t.id);
                  }}
                  className={`rounded-xl border p-3 text-left text-ink transition-colors cursor-pointer ${
                    track === t.id
                      ? 'border-tone-amber-500 bg-wash-amber-500o10'
                      : 'border-line hover:border-tone-amber-500o40'
                  }`}
                >
                  <span className="block text-sm font-bold">{t.name}</span>
                  <span className="block text-[11px] text-ink-stone-400">{t.hint}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-bold text-ink-stone-500">2 · 现在什么水平？（实话实说）</p>
            <div className="space-y-2">
              {LEVELS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => {
                    sound.playClick();
                    setLevel(l.id);
                  }}
                  className={`w-full rounded-xl border p-3 text-left text-ink transition-colors cursor-pointer ${
                    level === l.id
                      ? 'border-tone-amber-500 bg-wash-amber-500o10'
                      : 'border-line hover:border-tone-amber-500o40'
                  }`}
                >
                  <span className="block text-sm font-bold">{l.name}</span>
                  <span className="block text-[11px] text-ink-stone-400">{l.desc[track]}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {level === 'NOVICE' ? (
              <Button size="sm" disabled={saving} onClick={() => void handleDone(false)}>
                <Footprints className="w-3.5 h-3.5" />
                {saving ? '保存中…' : '开始带路'}
              </Button>
            ) : (
              <Button size="sm" disabled={saving} onClick={() => void handleDone(true)}>
                <Sparkles className="w-3.5 h-3.5" />
                {saving ? '保存中…' : '去考个级'}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={finish}>
              先逛逛
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
