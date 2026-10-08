import React, { useEffect } from 'react';
import { CheckCircle2, Layers, RefreshCw, Trophy } from 'lucide-react';
import { Button } from '../ui/button.js';
import { fireSuccessConfetti } from '../magicui/index.js';
import { sound } from '../../utils/audio.js';

interface DailyStudyCompleteProps {
  count: number;
  sourceTitle: string;
  onGoToReview: () => void;
  onStudyMore: () => void;
}

export function DailyStudyComplete({
  count,
  sourceTitle,
  onGoToReview,
  onStudyMore,
}: DailyStudyCompleteProps) {
  useEffect(() => {
    sound.playSuccess();
    fireSuccessConfetti();
  }, []);

  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-line-amber-900o10 bg-paper-soft py-14 px-6 text-center space-y-5">
      <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-wash-amber-500o10-stone-900o60 text-accent-ink-warm shadow-xs">
        <Trophy className="h-9 w-9" />
      </div>

      <div className="space-y-2 max-w-md">
        <h3 className="text-xl font-bold font-serif text-ink tracking-tight">
          本组 {count} 词学习已结束
        </h3>
        <p className="text-xs text-ink-ghost leading-relaxed">
          来自「{sourceTitle}」。系统按已保存的学习和复习记录更新进度；浏览或跳过词汇不会计入单元掌握。
          继续复习已加入生词本的词汇，巩固主动回忆。
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3 pt-3">
        <Button
          type="button"
          size="default"
          className="gap-2 text-xs font-semibold h-10 px-5"
          onClick={() => {
            sound.playClick();
            onGoToReview();
          }}
        >
          <Layers className="h-4 w-4" />
          立即去闪卡复习强化（主动回忆）
        </Button>
        <Button
          type="button"
          variant="outline"
          size="default"
          className="gap-2 text-xs h-10 px-4"
          onClick={() => {
            sound.playClick();
            onStudyMore();
          }}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          再学一组新词
        </Button>
      </div>
    </div>
  );
}
