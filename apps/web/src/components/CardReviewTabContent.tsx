import React from 'react';
import { Lightbulb } from 'lucide-react';
import type { CardReviewRating, VocabularyEntry } from '@study-studio/protocol';
import type { AnkiCardFormatInfo } from '../queries/useLearnerQueries.js';
import type { SupportedLanguage } from '../utils/audio.js';
import type { StudyCardItem } from '../models/learning.js';
import { sound } from '../utils/audio.js';
import { Tabs, TabsList, TabsTrigger, TabsIndicator } from './ui/tabs.js';
import { Button } from './ui/button.js';
import { FsrsCardStage } from './FsrsCardStage.js';
import { CardReviewEmptyState } from './CardReviewEmptyState.js';
import { WordStudyDetail } from './WordStudyDetail.js';

interface CardReviewTabContentProps {
  practiceCollectionsCount: number;
  onGoToQueue: () => void;
  filteredCards: StudyCardItem[];
  currentCardIndex: number;
  cardFilter: string;
  onFilterChange: (val: string) => void;
  cardFlipped: boolean;
  onFlip: () => void;
  onReview: (rating: CardReviewRating) => void;
  onAskAi: () => void;
  onOpenDict: (word: string) => void;
  cardSpeechLang: SupportedLanguage;
  reviewFormat?: AnkiCardFormatInfo | undefined;
  deepStudyOpen: boolean;
  onToggleDeepStudy: () => void;
  matchingVocab?: VocabularyEntry | undefined;
  totalCards: number;
  onResetFilter: () => void;
  onGoToStudy: () => void;
  onGoToLibrary: () => void;
  onGoToDictionary: () => void;
  onOpenAnkiImport: () => void;
}

export function CardReviewTabContent({
  practiceCollectionsCount,
  onGoToQueue,
  filteredCards,
  currentCardIndex,
  cardFilter,
  onFilterChange,
  cardFlipped,
  onFlip,
  onReview,
  onAskAi,
  onOpenDict,
  cardSpeechLang,
  reviewFormat,
  deepStudyOpen,
  onToggleDeepStudy,
  matchingVocab,
  totalCards,
  onResetFilter,
  onGoToStudy,
  onGoToLibrary,
  onGoToDictionary,
  onOpenAnkiImport,
}: CardReviewTabContentProps) {
  const activeCard: StudyCardItem | undefined = filteredCards[currentCardIndex] || filteredCards[0];

  return (
    <div className="space-y-4">
      {practiceCollectionsCount > 0 && (
        <div className="flex items-center justify-between rounded-2xl border border-line-amber-900o10 bg-wash-amber-500o5 px-3.5 py-2 text-xs">
          <span className="text-ink-ghost">
            💡 检测到 {practiceCollectionsCount} 组做题条目可转入复习卡片
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-accent-ink-warm hover:text-ink"
            onClick={onGoToQueue}
          >
            去转化 →
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-ink-ghost gap-3">
        <span className="font-mono text-ink-stone-400">
          当前卡片: {filteredCards.length ? currentCardIndex + 1 : 0} / {filteredCards.length}
        </span>

        <Tabs
          value={cardFilter}
          onValueChange={(val) => {
            if (!val) return;
            sound.playClick();
            onFilterChange(val);
          }}
        >
          <TabsList className="bg-veil-stone-200o60-stone-900">
            <TabsIndicator />
            {(
              [
                ['ALL', '全部'],
                ['VOCAB', '生词'],
                ['GRAMMAR', '文法'],
                ['CONFUSION', '混淆'],
              ] as const
            ).map(([value, label]) => (
              <TabsTrigger key={value} value={value} className="px-2.5 py-1 text-xs">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {activeCard ? (
        <div className="space-y-4">
          <FsrsCardStage
            card={activeCard}
            cardSpeechLang={cardSpeechLang}
            reviewFormat={reviewFormat}
            cardFlipped={cardFlipped}
            onFlip={onFlip}
            onReview={onReview}
            onAskAi={onAskAi}
            onOpenDict={() => onOpenDict(activeCard.frontWord)}
            onToggleDeepStudy={onToggleDeepStudy}
            isDeepStudyOpen={deepStudyOpen}
          />

          {deepStudyOpen && matchingVocab && (
            <div className="rounded-2xl border border-line-amber-900o10 bg-paper-soft p-4 transition-all space-y-3">
              <div className="flex items-center justify-between border-b border-line pb-2">
                <span className="text-xs font-bold text-ink flex items-center gap-1.5">
                  <Lightbulb className="w-3.5 h-3.5 text-accent-ink-warm" />
                  「{matchingVocab.word}」AI 深度学习详情（情境对话 · 避坑 · 小测）
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs text-ink-ghost hover:text-ink"
                  onClick={onToggleDeepStudy}
                >
                  收起
                </Button>
              </div>
              <WordStudyDetail word={matchingVocab} />
            </div>
          )}
        </div>
      ) : (
        <CardReviewEmptyState
          totalCards={totalCards}
          filter={cardFilter}
          onResetFilter={onResetFilter}
          onGoToStudy={onGoToStudy}
          onGoToLibrary={onGoToLibrary}
          onGoToDictionary={onGoToDictionary}
          onOpenAnkiImport={onOpenAnkiImport}
        />
      )}
    </div>
  );
}
