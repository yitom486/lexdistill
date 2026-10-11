import { motion, AnimatePresence } from 'framer-motion';
import { BookmarkPlus, Highlighter, Sparkles, BookOpen } from 'lucide-react';
import { UnifiedTtsPlayer } from '../UnifiedTtsPlayer.js';
import { Badge } from '../ui/badge.js';
import type { SupportedLanguage } from '../../utils/audio.js';
import type { SelectionWordDetail } from './useSelectionLookup.js';

interface SelectionLookupPopoverProps {
  position: { x: number; y: number } | null;
  wordDetail: SelectionWordDetail | null;
  ttsLang: SupportedLanguage;
  onAddToCards: () => void;
  onSaveAnnotation: () => void;
  onAskTutor: () => void;
  onLookup: () => void;
}

/**
 * 划词悬浮岛：surface-modal 实体 + 发丝线三并排紧凑操作（闪卡/批注/解析）+ 词典次级入口。
 * 定位沿用原有 fixed 坐标逻辑，只重构视觉与结构。
 */
export function SelectionLookupPopover({
  position,
  wordDetail,
  ttsLang,
  onAddToCards,
  onSaveAnnotation,
  onAskTutor,
  onLookup,
}: SelectionLookupPopoverProps) {
  return (
    <AnimatePresence>
      {position && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 5 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 5 }}
          style={{
            position: 'fixed',
            left: position.x,
            top: position.y,
          }}
          className="surface-modal z-50 p-3 rounded-2xl flex flex-col gap-2 min-w-[240px] max-w-[320px]"
          role="dialog"
          aria-label="划词操作"
        >
          {wordDetail && (
            <div className="space-y-0.5 border-b border-line-hairline pb-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-ink text-xs flex items-center gap-1 min-w-0">
                  <span className="truncate">{wordDetail.word}</span>
                  <UnifiedTtsPlayer
                    variant="inline"
                    text={wordDetail.word}
                    lang={ttsLang}
                  />
                </span>
                {wordDetail.pos && (
                  <Badge variant="gold" className="shrink-0">
                    {wordDetail.pos}
                  </Badge>
                )}
              </div>
              {wordDetail.reading && (
                <p className="text-[10px] text-ink-faint-soft">
                  {wordDetail.reading}
                  {wordDetail.pitch ? ` · 声调 ${wordDetail.pitch}` : ''}
                </p>
              )}
              {wordDetail.meaning && (
                <p className="text-[11px] text-ink-faint-soft line-clamp-2">
                  {wordDetail.meaning}
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-3 gap-1.5 pt-1">
            <button
              type="button"
              onClick={onAddToCards}
              className="h-8 inline-flex items-center justify-center gap-1 rounded-lg bg-gold-warm text-tone-stone-950 text-[11px] font-bold transition-all cursor-pointer active:scale-[0.97] hover:shadow-[0_0_12px_0_var(--line-glow-hover)]"
            >
              <BookmarkPlus className="w-3.5 h-3.5" />
              加入闪卡
            </button>
            <button
              type="button"
              onClick={onSaveAnnotation}
              className="h-8 inline-flex items-center justify-center gap-1 rounded-lg border border-line-hairline text-ink-faint-soft hover:text-ink hover:border-line-hairline-strong hover:bg-surface-warm/60 text-[11px] font-medium transition-colors cursor-pointer active:scale-[0.97]"
            >
              <Highlighter className="w-3.5 h-3.5" />
              重点批注
            </button>
            <button
              type="button"
              onClick={onAskTutor}
              className="h-8 inline-flex items-center justify-center gap-1 rounded-lg border border-line-hairline text-ink-faint-soft hover:text-ink hover:border-gold-warm/40 hover:bg-surface-warm/60 text-[11px] font-medium transition-colors cursor-pointer active:scale-[0.97]"
            >
              <Sparkles className="w-3.5 h-3.5" />
              语法解析
            </button>
          </div>
          <button
            type="button"
            onClick={onLookup}
            className="inline-flex items-center justify-center gap-1 text-[11px] text-ink-faint-soft hover:text-gold-warm transition-colors cursor-pointer py-0.5"
          >
            <BookOpen className="w-3 h-3" />
            查完整离线词典
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
