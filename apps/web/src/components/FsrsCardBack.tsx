import { BookOpen, Lightbulb, Sparkles } from 'lucide-react';
import { Button } from './ui/button.js';
import { UnifiedTtsPlayer } from './UnifiedTtsPlayer.js';
import { FsrsRatingButtons } from './FsrsRatingButtons.js';
import { cn } from '../lib/utils.js';
import type { SupportedLanguage } from '../utils/audio.js';
import type { StudyCardItem } from '../models/learning.js';
import type { CardReviewRating } from '@study-studio/protocol';

interface FsrsCardBackProps {
  card: StudyCardItem;
  cardSpeechLang: SupportedLanguage;
  renderedReview: { frontDoc: string; backDoc: string } | null;
  cardFlipped: boolean;
  onReview: (rating: CardReviewRating) => void;
  onAskAi?: (() => void) | undefined;
  onOpenDict?: (() => void) | undefined;
  onToggleDeepStudy?: (() => void) | undefined;
  isDeepStudyOpen?: boolean | undefined;
}

/** 卡片背面：中文释义、用法搭配、场景例句与 4 档评级。 */
export function FsrsCardBack({
  card,
  cardSpeechLang,
  renderedReview,
  cardFlipped,
  onReview,
  onAskAi,
  onOpenDict,
  onToggleDeepStudy,
  isDeepStudyOpen,
}: FsrsCardBackProps) {
  return (
    <div
      aria-hidden={!cardFlipped}
      className={cn(
        'fsrs-card-face fsrs-card-back shadow-inner-hi absolute inset-0 overflow-y-auto rounded-3xl p-7',
        cardFlipped ? 'pointer-events-auto' : 'pointer-events-none'
      )}
    >
      <div className="flex min-h-full flex-col justify-between space-y-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-line-hairline pb-2">
            <span className="text-xs font-bold text-accent-ink-warm uppercase tracking-wider">
              中文释义与核心考点
            </span>
            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              {onToggleDeepStudy && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[11px] gap-1"
                  onClick={onToggleDeepStudy}
                >
                  <Lightbulb className="w-3 h-3 text-accent-ink-warm" />
                  {isDeepStudyOpen ? '收起精学' : 'AI精学与小测'}
                </Button>
              )}
              {onOpenDict && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px] gap-1 text-ink-ghost hover:text-ink"
                  onClick={onOpenDict}
                >
                  <BookOpen className="w-3 h-3" />
                  词典
                </Button>
              )}
              {onAskAi && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-6 px-2 text-[11px] gap-1"
                  onClick={onAskAi}
                >
                  <Sparkles className="w-3 h-3 text-accent-ink-warm" />
                  问 AI
                </Button>
              )}
            </div>
          </div>

          {renderedReview ? (
            <iframe
              key={`back-${card.id}`}
              title="卡片背面"
              sandbox=""
              srcDoc={renderedReview.backDoc}
              className="block h-55 w-full shrink-0 rounded-2xl border-0 bg-surface-abyss"
            />
          ) : (
            <div className="space-y-3">
              <h3 className="text-2xl font-bold font-serif text-ink">
                {card.backMeaning}
              </h3>

              {/* 常用搭配与语法接续 */}
              <div className="rounded-xl border border-line-hairline bg-wash-amber-500o10-stone-900o60 p-3 text-xs space-y-1.5">
                <div className="font-semibold text-ink flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5 text-gold-warm" />
                    核心用法与搭配：
                  </span>
                  <span className="text-ink-ghost font-normal">
                    {card.pos.includes('サ変') ? '名词 / サ変动词' : card.pos}
                  </span>
                </div>
                <p className="text-ink-ghost leading-relaxed">
                  {card.note || (card.exampleHighlight ? `常用搭配：${card.exampleHighlight}` : `语境搭配：${card.frontWord}（${card.pos}）`)}
                </p>
              </div>

              {/* 场景例句 */}
              {card.exampleJp && (
                <div className="p-3 rounded-xl bg-wash-amber-500o10-stone-900o60 border border-line-hairline text-xs space-y-1">
                  <div className="font-medium text-ink flex items-center justify-between">
                    <span>{card.exampleJp}</span>
                    <span onClick={(e) => e.stopPropagation()}>
                      <UnifiedTtsPlayer variant="inline" text={card.exampleJp} lang={cardSpeechLang} />
                    </span>
                  </div>
                  {card.exampleZh && <p className="text-ink-ghost font-serif">{card.exampleZh}</p>}
                </div>
              )}

              {card.note && (
                <p className="text-xs text-ink-faint-soft inline-flex items-start gap-1.5">
                  <Lightbulb className="w-3.5 h-3.5 text-gold-warm shrink-0 mt-px" />
                  <span>考点：{card.note}</span>
                </p>
              )}
            </div>
          )}
        </div>

        {/* 4 档 FSRS 评级按钮 */}
        <FsrsRatingButtons onReview={onReview} />
      </div>
    </div>
  );
}
