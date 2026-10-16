import React from 'react';
import { ArrowLeft, ArrowRight, Check, X, Sparkles } from 'lucide-react';
import type { VocabularyEntry } from '@lexdistill/protocol';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { Progress } from '../ui/progress.js';
import { WordStudyDetail } from '../WordStudyDetail.js';
import { sound } from '../../utils/audio.js';

interface DailyStudyStageProps {
  totalCount: number;
  currentIndex: number;
  activeVocab: VocabularyEntry;
  sourceTitle: string;
  isCollected: boolean;
  isStudied: boolean;
  isProcessing: boolean;
  onPrev: () => void;
  onNext: () => void;
  onCollectAndNext: () => void;
  onQuit: () => void;
}

export function DailyStudyStage({
  totalCount,
  currentIndex,
  activeVocab,
  sourceTitle,
  isCollected,
  isStudied,
  isProcessing,
  onPrev,
  onNext,
  onCollectAndNext,
  onQuit,
}: DailyStudyStageProps) {
  const percent = Math.round(((currentIndex + 1) / totalCount) * 100);
  const isLast = currentIndex === totalCount - 1;

  return (
    <div className="space-y-4">
      {/* 顶部学习步进器与状态指示 */}
      <header className="rounded-2xl border border-line-amber-900o10 bg-paper-soft p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-ink">
              第 {currentIndex + 1} / {totalCount} 词
            </span>
            <Badge variant="amber" className="text-xs">
              {sourceTitle}
            </Badge>
            {isStudied && (
              <Badge variant="emerald" className="text-xs">
                已学透
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-ink-ghost hover:text-ink"
              disabled={currentIndex === 0}
              onClick={() => {
                sound.playClick();
                onPrev();
              }}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              上一词
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-ink-stone-400 hover:text-ink"
              onClick={() => {
                sound.playClick();
                onQuit();
              }}
            >
              <X className="h-3.5 w-3.5" />
              暂存退出
            </Button>
          </div>
        </div>

        <Progress value={percent} className="h-1.5" />
      </header>

      {/* 词汇深度学习舞台（直接复用单一大脑 WordStudyDetail） */}
      <div className="rounded-3xl border border-line-amber-900o10 bg-paper-soft p-5">
        <WordStudyDetail word={activeVocab} />
      </div>

      {/* 底部操作与流转推进 */}
      <footer className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-paper-soft p-4">
        <div className="flex items-center gap-2 text-xs text-ink-ghost">
          <span>当前状态：</span>
          {isCollected ? (
            <Badge variant="secondary" className="text-xs">
              已在生词本
            </Badge>
          ) : (
            <span className="text-xs text-ink-stone-400">尚未入库</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!isLast && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 px-3 text-xs text-ink-ghost hover:text-ink"
              onClick={() => {
                sound.playClick();
                onNext();
              }}
            >
              跳过此词
              <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          )}

          <Button
            type="button"
            size="default"
            className="gap-1.5 text-xs font-semibold h-9 px-4"
            disabled={isProcessing}
            onClick={() => {
              sound.playClick();
              onCollectAndNext();
            }}
          >
            <Check className="h-3.5 w-3.5" />
            {isProcessing
              ? '入库中…'
              : isLast
                ? '学透本词，完成今日精学'
                : '学透了，加入复习并学下一词 →'}
          </Button>
        </div>
      </footer>
    </div>
  );
}
