import React from 'react';
import type { CardReviewRating } from '@study-studio/protocol';
import { cn } from '../lib/utils.js';

interface FsrsRatingButtonsProps {
  onReview: (rating: CardReviewRating) => void;
}

interface RatingDef {
  rating: CardReviewRating;
  label: string;
  keyHint: string;
  /** 示例间隔（展示用微标；真实调度由 FSRS 引擎决定） */
  interval: string;
  glow: string;
  intervalHover: string;
}

/**
 * FSRS 4 档评级微胶囊：实体石墨底 + 发丝线 + 内高光。
 * 悬停时按评级透出微量色相光晕；按压 1px 机械下沉。
 * 评分协议（CardReviewRating）与快捷键语义保持不变。
 */
const RATINGS: RatingDef[] = [
  {
    rating: 'AGAIN',
    label: '重来',
    keyHint: '1',
    interval: '10m',
    glow: 'hover:shadow-[0_0_16px_0_var(--status-danger-line)] hover:border-ink-rose-600-rose-400/50',
    intervalHover: 'group-hover:text-ink-rose-600-rose-400',
  },
  {
    rating: 'HARD',
    label: '困难',
    keyHint: '2',
    interval: '1d',
    glow: 'hover:shadow-[0_0_16px_0_var(--status-warn-line)] hover:border-ink-amber-800-amber-300/50',
    intervalHover: 'group-hover:text-ink-amber-800-amber-300',
  },
  {
    rating: 'GOOD',
    label: '良好',
    keyHint: '3',
    interval: '3d',
    glow: 'hover:shadow-[0_0_16px_0_var(--line-glow-hover)] hover:border-gold-warm/50',
    intervalHover: 'group-hover:text-gold-warm',
  },
  {
    rating: 'EASY',
    label: '简单',
    keyHint: '4',
    interval: '7d',
    glow: 'hover:shadow-[0_0_16px_0_var(--status-success-line)] hover:border-ink-emerald-700-emerald-300/50',
    intervalHover: 'group-hover:text-ink-emerald-700-emerald-300',
  },
];

export function FsrsRatingButtons({ onReview }: FsrsRatingButtonsProps) {
  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2"
      onClick={(e) => e.stopPropagation()}
      role="group"
      aria-label="记忆评级"
    >
      {RATINGS.map((def) => (
        <button
          key={def.rating}
          type="button"
          onClick={() => onReview(def.rating)}
          title={`按快捷键 ${def.keyHint}`}
          className={cn(
            'group rounded-xl border border-line-hairline bg-surface-warm/80 shadow-inner-hi',
            'px-3 py-2 flex items-center justify-between gap-2 cursor-pointer select-none',
            'transition-all duration-150 hover:border-line-hairline-strong',
            'active:translate-y-px active:scale-[0.99]',
            def.glow
          )}
        >
          <span className="text-xs font-semibold text-ink">
            {def.label}
            <span className="ml-1 font-mono text-[10px] text-ink-faint-soft">({def.keyHint})</span>
          </span>
          <span className={cn('font-mono text-[11px] text-ink-faint-soft transition-colors', def.intervalHover)}>
            {def.interval}
          </span>
        </button>
      ))}
    </div>
  );
}
