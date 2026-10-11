import { UnifiedTtsPlayer } from '../UnifiedTtsPlayer.js';
import type { TextbookBook, TextbookLesson } from '../../models/textbook.js';

interface StructuredLessonViewProps {
  book: TextbookBook;
  lesson: TextbookLesson;
  showTranslation: boolean;
}

/** 结构分解排版：长课文按句分块，单句回放与译文对照。 */
export function StructuredLessonView({ book, lesson, showTranslation }: StructuredLessonViewProps) {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="p-4 rounded-2xl bg-gold-warm/10 border border-gold-warm/20">
        <h4 className="text-sm font-bold text-ink mb-1">
          {lesson.subTitle}
        </h4>
        <p className="text-xs text-ink-ghost">
          本模式对长课文进行段落与语义分块，支持单句反复回放与语法点对齐。
        </p>
      </div>

      <div className="space-y-6">
        {lesson.dialogues.map((dlg, idx) => (
          <div
            key={dlg.id}
            className="surface-card p-5 rounded-2xl space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-gold-warm text-tone-stone-950">
                第 {idx + 1} 句 · {dlg.speaker}
              </span>
              <UnifiedTtsPlayer
                variant="button"
                text={dlg.japanese}
                lang={book.language || 'JA'}
                label="朗读"
              />
            </div>
            <div className="text-lg font-serif text-ink">
              {dlg.japanese}
            </div>
            {showTranslation && (
              <div className="text-sm text-ink-ghost border-t border-line-hairline pt-2">
                {dlg.chinese}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
