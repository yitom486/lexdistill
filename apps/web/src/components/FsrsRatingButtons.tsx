import React from 'react';
import type { CardReviewRating } from '@study-studio/protocol';
import { Button } from './ui/button.js';

interface FsrsRatingButtonsProps {
  onReview: (rating: CardReviewRating) => void;
}

/**
 * FSRS 4 档评级按钮组：重来 (1)、困难 (2)、良好 (3)、简单 (4)。
 * 全量消费语义色彩 Token，阻止点击冒泡。
 */
export function FsrsRatingButtons({ onReview }: FsrsRatingButtonsProps) {
  return (
    <div
      className="grid grid-cols-4 gap-2 pt-2"
      onClick={(e) => e.stopPropagation()}
    >
      <Button
        variant="secondary"
        className="h-auto py-2.5 hover:bg-tone-rose-500 hover:text-tone-white"
        onClick={() => onReview('AGAIN')}
        title="按快捷键 1"
      >
        重来 (1)
      </Button>
      <Button
        variant="secondary"
        className="h-auto py-2.5 hover:bg-tone-amber-500 hover:text-tone-stone-950"
        onClick={() => onReview('HARD')}
        title="按快捷键 2"
      >
        困难 (2)
      </Button>
      <Button
        className="h-auto py-2.5"
        onClick={() => onReview('GOOD')}
        title="按快捷键 3"
      >
        良好 (3)
      </Button>
      <Button
        className="h-auto py-2.5 bg-tone-emerald-600 hover:bg-tone-emerald-700 text-tone-white"
        onClick={() => onReview('EASY')}
        title="按快捷键 4"
      >
        简单 (4)
      </Button>
    </div>
  );
}
