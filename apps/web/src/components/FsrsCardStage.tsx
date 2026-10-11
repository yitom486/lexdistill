import React, { useEffect, useMemo } from 'react';
import { Sparkles, BookOpen, Lightbulb } from 'lucide-react';
import type { CardReviewRating } from '@study-studio/protocol';
import { buildCardContext, renderCard } from '@study-studio/learner-core';
import type { AnkiCardFormatInfo } from '../queries/useLearnerQueries.js';
import { Badge } from './ui/badge.js';
import { Button } from './ui/button.js';
import { UnifiedTtsPlayer } from './UnifiedTtsPlayer.js';
import { buildReviewCardDoc, studyCardToSourceEntry } from '../lib/review-card.js';
import { cn } from '../lib/utils.js';
import type { SupportedLanguage } from '../utils/audio.js';
import type { StudyCardItem } from '../models/learning.js';
import { FsrsCardBack } from './FsrsCardBack.js';

interface FsrsCardStageProps {
  card: StudyCardItem;
  cardSpeechLang: SupportedLanguage;
  reviewFormat?: AnkiCardFormatInfo | undefined;
  cardFlipped: boolean;
  onFlip: () => void;
  onReview: (rating: CardReviewRating) => void;
  onAskAi?: () => void;
  onOpenDict?: () => void;
  onToggleDeepStudy?: () => void;
  isDeepStudyOpen?: boolean;
}

/**
 * 沉浸式 FSRS 3D 翻转卡片舞台：
 * 正面发音/读音/用法提点，背面释义/搭配/例句与 4 档评级，支持 AI 讲透、词典及深学联动。
 */
export function FsrsCardStage({
  card,
  cardSpeechLang,
  reviewFormat,
  cardFlipped,
  onFlip,
  onReview,
  onAskAi,
  onOpenDict,
  onToggleDeepStudy,
  isDeepStudyOpen,
}: FsrsCardStageProps) {
  const isCustomFormat = Boolean(reviewFormat && reviewFormat.id !== 'study-basic');
  const renderedReview = useMemo(() => {
    if (!card || !reviewFormat || !isCustomFormat) return null;
    const ctx = buildCardContext(studyCardToSourceEntry(card));
    const rendered = renderCard(reviewFormat, ctx);
    return {
      frontDoc: buildReviewCardDoc(reviewFormat.css, rendered.frontHtml),
      backDoc: buildReviewCardDoc(reviewFormat.css, rendered.backHtml),
    };
  }, [card, reviewFormat, isCustomFormat]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;
      if (e.code === 'Space') {
        e.preventDefault();
        onFlip();
        return;
      }
      if (cardFlipped) {
        const ratingMap: Record<string, CardReviewRating> = { '1': 'AGAIN', '2': 'HARD', '3': 'GOOD', '4': 'EASY' };
        if (ratingMap[e.key]) {
          e.preventDefault();
          onReview(ratingMap[e.key]!);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cardFlipped, onFlip, onReview]);

  return (
    <div
      onClick={onFlip}
      className="fsrs-card-stage min-h-115 cursor-pointer select-none"
      role="region"
      aria-label="闪卡卡片"
    >
      <div className="fsrs-card-viewport surface-card relative min-h-115 w-full overflow-hidden rounded-3xl transition-colors">
        <div
          className="fsrs-card-rotor relative min-h-115 w-full transform-style-3d"
          style={{
            transform: `rotateY(${cardFlipped ? 180 : 0}deg)`,
            transition: 'transform var(--motion-card-flip-duration) cubic-bezier(0.3, 1.25, 0.5, 1)',
            transformOrigin: 'center center',
            willChange: 'transform',
          }}
        >
          {/* 正面 */}
          <div
            aria-hidden={cardFlipped}
            className={cn(
              'fsrs-card-face shadow-inner-hi absolute inset-0 overflow-y-auto rounded-3xl p-7',
              cardFlipped ? 'pointer-events-none' : 'pointer-events-auto'
            )}
          >
            <div className="flex min-h-full flex-col justify-between space-y-5">
              <div className="flex items-center justify-between gap-2 border-b border-line-hairline pb-2.5">
                <Badge variant="amber">
                  {card.tag} · {card.pos}
                </Badge>
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  {onOpenDict && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[11px] gap-1 text-ink-ghost hover:text-ink"
                      onClick={onOpenDict}
                      title="查完整离线词典条目"
                    >
                      <BookOpen className="w-3 h-3" />
                      查词典
                    </Button>
                  )}
                  {onAskAi && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-6 px-2 text-[11px] gap-1"
                      onClick={onAskAi}
                      title="呼出 AI 导师讲透用法"
                    >
                      <Sparkles className="w-3 h-3 text-accent-ink-warm" />
                      问 AI 讲透
                    </Button>
                  )}
                  <span className="text-[11px] text-ink-stone-400 font-mono">
                    {card.stability}d · {card.reps}次
                  </span>
                </div>
              </div>

              <div className="text-center py-4 flex flex-col items-center">
                {renderedReview ? (
                  <iframe
                    key={`front-${card.id}`}
                    title="卡片正面"
                    sandbox=""
                    srcDoc={renderedReview.frontDoc}
                    className="block h-55 w-full shrink-0 rounded-2xl border-0 bg-surface-abyss"
                  />
                ) : (
                  <>
                    <h2 className="text-4xl sm:text-5xl font-bold font-serif text-ink tracking-wide">
                      {card.frontWord}
                    </h2>
                    {card.reading && (
                      <p className="text-lg text-accent-ink-warm font-mono mt-2 font-medium">
                        {card.reading}
                      </p>
                    )}
                    <div className="mt-3.5 inline-flex max-w-md items-center gap-1.5 rounded-full bg-wash-amber-500o10-stone-900o60 px-3.5 py-1 text-xs text-ink-ghost">
                      <Lightbulb className="w-3.5 h-3.5 text-gold-warm shrink-0" />
                      <span className="font-semibold text-ink-faint-soft">用法提点：</span>
                      <span>
                        {card.pos.includes('サ変')
                          ? '可接「する」作动词（約束する）；修饰名词用「の」'
                          : card.note || `词性为「${card.pos}」，注意语境搭配`}
                      </span>
                    </div>
                  </>
                )}
                <div className="mt-4" onClick={(e) => e.stopPropagation()}>
                  <UnifiedTtsPlayer
                    variant="button"
                    text={card.frontWord}
                    lang={cardSpeechLang}
                    label="听发音"
                  />
                </div>
              </div>

              <div className="text-center text-xs text-ink-stone-400">
                点击卡片或按{' '}
                <kbd className="font-mono bg-line-soft px-1.5 py-0.5 rounded">
                  Space
                </kbd>{' '}
                翻转查看释义、语法接续与例句
              </div>
            </div>
          </div>

          {/* 背面 */}
          <FsrsCardBack
            card={card}
            cardSpeechLang={cardSpeechLang}
            renderedReview={renderedReview}
            cardFlipped={cardFlipped}
            onReview={onReview}
            onAskAi={onAskAi}
            onOpenDict={onOpenDict}
            onToggleDeepStudy={onToggleDeepStudy}
            isDeepStudyOpen={isDeepStudyOpen}
          />
        </div>
      </div>
    </div>
  );
}
