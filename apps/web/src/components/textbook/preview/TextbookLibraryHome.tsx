import { BookOpen, ArrowRight, Plus, RefreshCw, ListChecks, PlayCircle } from 'lucide-react';
import { Button } from '../../ui/button.js';
import { Badge } from '../../ui/badge.js';
import type { LearningLibraryBook } from './library-view.js';

export function TextbookLibraryHome({ books, rememberedChapters, onOpen, onBrowse, onImport, onRefresh, onOpenExerciseExamples, loading, loadError, hasSavedResult }: {
  books: LearningLibraryBook[];
  rememberedChapters: Record<string, string>;
  onOpen: (book: LearningLibraryBook) => void;
  onBrowse: (book: LearningLibraryBook) => void;
  onImport: () => void;
  onRefresh: () => void;
  onOpenExerciseExamples: () => void;
  loading: boolean;
  loadError?: boolean | undefined;
  hasSavedResult: boolean;
}) {
  const withRemembered = books.map((book) => ({
    book,
    remembered: book.chapters.find((chapter) => chapter.id === rememberedChapters[book.id]),
  }));
  // 有有效章节记忆的实体列为可继续学习，保持数组真实顺序；
  // rememberedChapters 只有逐教材章节记录，不代表全局访问时间，不称“最近学习”。
  const continuable = withRemembered.filter((entry) => entry.remembered !== undefined);
  const rest = withRemembered.filter((entry) => entry.remembered === undefined);
  // 演示教材不属于查询缓存；已保存列表是否读取过由 Query 所有者提供。
  const fatalError = loadError === true && !hasSavedResult;
  const staleList = loadError === true && hasSavedResult;
  const firstLoading = loading && !hasSavedResult;
  const restLabel = continuable.length > 0 ? '其他教材' : '全部教材';

  const languageName = (language: string): string => {
    if (language === 'JA') return '日语';
    if (language === 'EN') return '英语';
    if (language === 'KO') return '韩语';
    return language;
  };

  const bookMeta = (book: LearningLibraryBook): string => {
    const organized = book.chapters.filter((chapter) =>
      Object.entries(chapter.content).some(([key, value]) => key !== 'material' && Array.isArray(value) && value.length > 0)
    ).length;
    return `${book.chapters.length} 个章节 · ${organized} 个已有学习内容`;
  };

  return (
    <div className="space-y-6" data-testid="textbook-library-home">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-3 font-serif text-3xl font-bold">
            <BookOpen className="h-7 w-7 text-accent-ink" />
            我的教材
          </h2>
          <p className="mt-3 text-sm text-ink-muted">选择一本教材，继续学习或查看章节内容。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="amber" onClick={onOpenExerciseExamples}>
            <ListChecks className="h-4 w-4" />
            查看题型案例
          </Button>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw className="h-4 w-4" />
            刷新教材
          </Button>
          <Button onClick={onImport}>
            <Plus className="h-4 w-4" />
            导入教材
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
        <span>{books.length} 本教材</span>
        {firstLoading && <span>正在读取已保存教材…</span>}
        {loading && hasSavedResult && <span>正在同步已保存教材列表…</span>}
        {staleList && <span>已保存教材列表可能不是最新，可刷新重试。</span>}
      </div>

      {fatalError && (
        <div className="rounded-2xl border border-line-rose-500o20 bg-wash-rose-500o5 p-4 text-xs text-ink-rose-800-rose-200">
          暂时无法读取已保存教材。
          {books.some((book) => book.temporary) && <span>临时演示教材仍可浏览。</span>}
          <Button variant="ghost" size="sm" className="ml-2" onClick={onRefresh}>
            重试
          </Button>
        </div>
      )}

      {continuable.length > 0 && (
        <section aria-label="继续学习" className="space-y-3">
          <h3 className="text-sm font-semibold text-ink">
            继续学习
            <span className="ml-2 text-xs font-medium text-ink-faint-soft">
              {continuable.length} 本有上次浏览记录
            </span>
          </h3>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {continuable.map(({ book, remembered }) => (
              <article
                key={book.id}
                aria-label={`教材：${book.title}`}
                className="surface-card rounded-2xl p-5 space-y-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={book.temporary ? 'amber' : 'outline'}>
                    {book.temporary ? '临时演示' : '已保存'}
                  </Badge>
                  <span className="text-xs text-ink-muted">{languageName(book.language)}</span>
                  {book.level && <Badge variant="outline">{book.level}</Badge>}
                </div>
                <h4 className="text-lg font-semibold leading-8 text-ink">{book.title}</h4>
                <p className="text-xs text-ink-muted">{bookMeta(book)}</p>
                <p className="text-xs text-ink-muted">
                  上次浏览：{remembered!.title}
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={() => onOpen(book)}>
                    <PlayCircle className="h-4 w-4" />
                    继续学习
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`查看章节：${book.title}`}
                    onClick={() => onBrowse(book)}
                  >
                    查看全部章节
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {rest.length > 0 && (
        <section aria-label={restLabel} className="space-y-2">
          {continuable.length > 0 && (
            <h3 className="text-sm font-semibold text-ink">{restLabel}</h3>
          )}
          <div className="divide-y divide-line-soft rounded-2xl border border-line-soft bg-paper-soft">
            {rest.map(({ book }) => (
              <article key={book.id} aria-label={`教材：${book.title}`}>
                <button
                  type="button"
                  aria-label={`查看章节：${book.title}`}
                  onClick={() => onBrowse(book)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors cursor-pointer hover:bg-surface-warm/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring first:rounded-t-2xl last:rounded-b-2xl"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink">{book.title}</span>
                    <span className="mt-0.5 block text-xs text-ink-muted">
                      {languageName(book.language)}
                      {book.level ? ` · ${book.level}` : ''} · {bookMeta(book)}
                      {book.temporary ? ' · 临时演示' : ' · 已保存'}
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint-soft" />
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      {!books.length && !loading && !fatalError && (
        <p className="rounded-2xl border border-line-soft p-8 text-center text-sm text-ink-muted">
          暂无教材，可以导入本地教材。
        </p>
      )}
    </div>
  );
}
