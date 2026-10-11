import { Volume2, Sparkles, BookmarkPlus } from 'lucide-react';
import { sound } from '../../utils/audio.js';
import { toast } from 'sonner';
import { Button } from '../ui/button.js';
import { UnifiedTtsPlayer } from '../UnifiedTtsPlayer.js';
import type { TextbookBook, TextbookLesson } from '../../models/textbook.js';

interface PdfPageViewProps {
  book: TextbookBook;
  lesson: TextbookLesson;
  currentPage: number;
  totalPages: number;
  showTranslation: boolean;
  collectPending: boolean;
  onCollectSentence: (sentence: string, translation: string) => void;
  onAskAiTutor: (text: string, contextPrompt: string) => void;
  onAddSelectedToCards: () => void;
}

/**
 * 原版双栏教材排版：标识头 + 会话流 + 语法/生词双栏底注。
 * 交互（讲透/收句子/TTS/加卡）全部经回调透传，逻辑归属父容器。
 */
export function PdfPageView({
  book,
  lesson,
  currentPage,
  totalPages,
  showTranslation,
  collectPending,
  onCollectSentence,
  onAskAiTutor,
  onAddSelectedToCards,
}: PdfPageViewProps) {
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-center justify-between border-b border-line-hairline pb-3">
        <div className="flex items-center gap-3">
          <span className="rounded-md border border-line-hairline bg-surface-coal px-2 py-0.5 text-xs font-bold text-ink">
            {book.shortTitle}
          </span>
          <span className="font-bold text-sm tracking-wider text-ink-soft">
            {lesson.title}
          </span>
        </div>
        <span className="font-mono text-[11px] text-ink-faint-soft">
          PAGE {String(currentPage).padStart(2, '0')} / {String(totalPages).padStart(2, '0')}
        </span>
      </div>

      <div className="space-y-4">
        <div className="inline-block px-3 py-1 rounded-md bg-gold-warm/10 border border-gold-warm/20 text-gold-warm text-xs font-bold mb-2">
          {book.language === 'EN' ? '【Dialogue · 课文会话】' : '【基本会话 · 基本会話】'}
        </div>
        <div className="space-y-4 leading-relaxed font-serif">
          {lesson.dialogues.map((dlg) => (
            <div
              key={dlg.id}
              className="p-3.5 rounded-xl border-l-2 border-transparent hover:bg-surface-coal/60 hover:border-gold-warm/40 transition-colors"
            >
              <div className="flex items-baseline gap-3">
                <span className="font-bold text-gold-warm shrink-0 font-sans text-xs px-2 py-0.5 rounded-md bg-gold-warm/10 border border-gold-warm/20">
                  {dlg.speaker}
                </span>
                <div className="flex-1 space-y-1">
                  <div className="text-ink text-base flex flex-wrap items-center gap-x-2">
                    <span>{dlg.japanese}</span>
                    <UnifiedTtsPlayer
                      variant="inline"
                      text={dlg.japanese}
                      lang={book.language || 'JA'}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        sound.playClick();
                        onAskAiTutor(
                          dlg.japanese,
                          `在《${book.title}》${lesson.title}（${dlg.speaker}）的语境中，请讲透这句的语法成分、关键助词/接续与语感，并给中文翻译对照：`
                        );
                        toast.info('已将整句提交给 AI 导师讲透');
                      }}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold text-gold-warm hover:bg-gold-warm/10 cursor-pointer transition-colors"
                      title="整句讲透：语法成分 + 助词接续 + 语感（不用先划选）"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      讲透
                    </button>
                    <button
                      type="button"
                      onClick={() => onCollectSentence(dlg.japanese, dlg.chinese)}
                      disabled={collectPending}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold text-ink-faint-soft hover:text-gold-warm hover:bg-gold-warm/10 cursor-pointer transition-colors disabled:opacity-50"
                      title="收进生词草稿箱，确认后建成句子卡"
                    >
                      <BookmarkPlus className="w-3.5 h-3.5" />
                      收句子
                    </button>
                  </div>
                  {showTranslation && (
                    <div className="text-xs text-ink-ghost font-sans">
                      {dlg.chinese}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 双栏底注与语法句型 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-line-hairline">
        <div className="space-y-4">
          <div className="font-bold text-xs text-ink flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-gold-warm"></span>
            {book.language === 'EN' ? '【Core Grammar · 核心语法】' : '【重要文法 · 文法ノート】'}
          </div>
          <div className="space-y-3">
            {lesson.grammarPoints.map((gp) => (
              <div
                key={gp.id}
                className="p-3 rounded-xl bg-surface-coal/60 border border-line-hairline space-y-1.5"
              >
                <div className="text-xs font-bold text-gold-warm">
                  {gp.title}
                </div>
                <div className="text-[11px] font-mono text-ink-faint-soft">
                  接续: {gp.structure}
                </div>
                <p className="text-xs text-ink-ghost leading-normal">
                  {gp.explanation}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="font-bold text-xs text-ink flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-tone-emerald-600"></span>
            {book.language === 'EN' ? '【Vocabulary · 重点词汇】' : '【新出単語 · 生词表】'}
          </div>

          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
            {lesson.vocabularies.map((v) => (
              <div
                key={v.id}
                className="flex items-center justify-between p-2 rounded-lg bg-surface-coal/60 text-xs hover:bg-surface-warm/60 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold text-ink">
                    {v.kanji}
                  </span>
                  <span className="text-[11px] text-ink-faint-soft">({v.kana})</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-line-soft text-ink-faint-soft">
                    {v.pos}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-ink-faint-soft">{v.chinese}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onAddSelectedToCards()}
                    className="h-7 w-7 text-ink-faint-soft hover:text-gold-warm"
                    title="加入闪卡"
                    aria-label={`将 ${v.kanji} 加入闪卡`}
                  >
                    <BookmarkPlus className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
