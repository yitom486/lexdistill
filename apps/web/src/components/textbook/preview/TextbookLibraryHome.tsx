import { BookOpen, ArrowRight, Plus, RefreshCw, ListChecks } from 'lucide-react';
import { Button } from '../../ui/button.js';
import { Badge } from '../../ui/badge.js';
import type { LearningLibraryBook } from './library-view.js';

export function TextbookLibraryHome({ books, rememberedChapters, onOpen, onBrowse, onImport, onRefresh, onOpenExerciseExamples, loading }: {
  books: LearningLibraryBook[]; rememberedChapters: Record<string, string>; onOpen: (book: LearningLibraryBook) => void;
  onBrowse: (book: LearningLibraryBook) => void;
  onImport: () => void; onRefresh: () => void; onOpenExerciseExamples: () => void; loading: boolean;
}) {
  return <div className="space-y-6" data-testid="textbook-library-home">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="flex items-center gap-3 font-serif text-3xl font-bold"><BookOpen className="h-7 w-7 text-accent-ink" />我的教材</h2><p className="mt-3 text-sm text-ink-muted">选择一本教材，继续学习或查看章节内容。</p></div><div className="flex flex-wrap items-center gap-2"><Button variant="amber" onClick={onOpenExerciseExamples}><ListChecks className="h-4 w-4" />查看题型案例</Button><Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}><RefreshCw className="h-4 w-4" />刷新教材</Button><Button onClick={onImport}><Plus className="h-4 w-4" />导入教材</Button></div></header>
    <div className="flex items-center justify-between text-xs text-ink-muted"><span>{books.length} 本教材</span>{loading && <span>正在读取已保存教材…</span>}</div>
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">{books.map(book => {
      const remembered = book.chapters.find(chapter => chapter.id === rememberedChapters[book.id]);
      const organized = book.chapters.filter(chapter => Object.entries(chapter.content).some(([key, value]) => key !== 'material' && Array.isArray(value) && value.length > 0)).length;
      return <article key={book.id} className="relative flex flex-col rounded-2xl border border-line-soft bg-paper-soft p-6" aria-label={`教材：${book.title}`}>
        <Button type="button" variant="ghost" className="absolute inset-0 h-full w-full rounded-2xl hover:bg-transparent active:scale-100" aria-label={`查看章节：${book.title}`} onClick={() => onBrowse(book)}><span className="sr-only">查看章节</span></Button>
        <div className="pointer-events-none relative flex flex-1 flex-col">
        <div className="mb-5 flex items-center gap-2"><Badge variant={book.temporary ? 'amber' : 'outline'}>{book.temporary ? '临时演示' : '已保存'}</Badge><span className="ml-auto text-xs text-ink-muted">{book.language === 'JA' ? '日语' : book.language === 'EN' ? '英语' : book.language === 'KO' ? '韩语' : book.language}</span>{book.level && <Badge variant="outline">{book.level}</Badge>}</div>
        <h3 className="mb-3 line-clamp-3 min-h-16 text-lg font-semibold leading-8">{book.title}</h3>
        <p className="text-sm text-ink-muted">{book.chapters.length} 个章节 · {organized} 个已有学习内容</p>
        <div className="my-5 min-h-12 border-t border-line-soft pt-4 text-xs leading-6 text-ink-muted">{remembered ? <>上次浏览：{remembered.title}</> : <>从章节列表开始，按自己的节奏学习。</>}</div>
        <span className="mt-auto flex items-center justify-between text-sm font-semibold text-accent-ink">查看全部章节<ArrowRight className="h-4 w-4" /></span>
        </div>
        {remembered && <Button type="button" variant="outline" className="relative mt-4 justify-between" onClick={() => onOpen(book)}>继续学习<ArrowRight className="h-4 w-4" /></Button>}
      </article>;
    })}</div>
    {!books.length && <p className="rounded-2xl border border-line-soft p-8 text-center text-sm text-ink-muted">暂无教材，可以导入本地教材。</p>}
  </div>;
}
