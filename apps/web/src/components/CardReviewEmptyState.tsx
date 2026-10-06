import { CheckCircle2, BookOpen, Search, Layers, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from './ui/button.js';

interface CardReviewEmptyStateProps {
  totalCards: number;
  filter: string;
  onResetFilter: () => void;
  onGoToStudy?: () => void;
  onGoToLibrary: () => void;
  onGoToDictionary: () => void;
  onOpenAnkiImport: () => void;
}

/**
 * 闪卡复习空状态（完成或分类为空）：积极的正向反馈与清晰的后续入口。
 */
export function CardReviewEmptyState({
  totalCards,
  filter,
  onResetFilter,
  onGoToStudy,
  onGoToLibrary,
  onGoToDictionary,
  onOpenAnkiImport,
}: CardReviewEmptyStateProps) {
  if (totalCards > 0 && filter !== 'ALL') {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-3xl border border-line bg-paper-soft py-14 px-6 text-center space-y-4"
        role="status"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-veil-stone-200o60-stone-900 text-ink-mute">
          <Layers className="h-6 w-6" />
        </div>
        <div className="space-y-1.5 max-w-md">
          <h3 className="text-base font-semibold text-ink">当前分类下暂无待复习闪卡</h3>
          <p className="text-xs text-ink-ghost">
            该分类的卡片今日尚未到期，您可以切换到其他分类或查看全部待复习卡片。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onResetFilter} className="gap-1.5 text-xs">
          <RefreshCw className="h-3.5 w-3.5" />
          查看全部卡片
        </Button>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-center justify-center rounded-3xl border border-line-amber-900o10 bg-paper-soft py-16 px-6 text-center space-y-5"
      role="status"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-wash-amber-500o10-stone-900o60 text-tone-emerald-600">
        <CheckCircle2 className="h-9 w-9" />
      </div>

      <div className="space-y-2 max-w-md">
        <h3 className="text-lg font-bold text-ink tracking-tight">今日闪卡已全部复习完毕！🎉</h3>
        <p className="text-xs text-ink-ghost leading-relaxed">
          记忆状态良好，今天的 FSRS 间隔复习目标已达成。您可以前往词汇库挑选新词加入复习，或通过词典收藏生词。
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
        {onGoToStudy && (
          <Button size="sm" onClick={onGoToStudy} className="gap-1.5 text-xs">
            <Sparkles className="h-3.5 w-3.5 text-accent-ink-warm" />
            抽取今日新词精学（N5 / 假名）
          </Button>
        )}
        <Button size="sm" variant={onGoToStudy ? 'outline' : 'default'} onClick={onGoToLibrary} className="gap-1.5 text-xs">
          <BookOpen className="h-3.5 w-3.5" />
          前往词汇总库选词
        </Button>
        <Button variant="outline" size="sm" onClick={onGoToDictionary} className="gap-1.5 text-xs">
          <Search className="h-3.5 w-3.5" />
          查词加入生词本
        </Button>
        <Button variant="ghost" size="sm" onClick={onOpenAnkiImport} className="text-xs text-ink-mute">
          从 Anki 搬家
        </Button>
      </div>
    </div>
  );
}
