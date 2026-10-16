import { ArrowLeft, ArrowRight, BookOpen } from 'lucide-react';
import { Button } from '../../ui/button.js';
import { Badge } from '../../ui/badge.js';
import type { LearningLibraryBook } from './library-view.js';

export function TextbookChapterList({ book, rememberedChapterId, onSelect, onBack }: {
  book: LearningLibraryBook;
  rememberedChapterId: string | undefined;
  onSelect: (chapterId: string) => void;
  onBack: () => void;
}) {
  return (
    <section className="space-y-6" data-testid="textbook-chapter-list">
      <Button variant="outline" size="sm" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" />
        返回教材首页
      </Button>
      <header className="space-y-3">
        <h2 className="flex items-center gap-3 font-serif text-3xl font-bold">
          <BookOpen className="h-7 w-7 shrink-0 text-accent-ink" />
          {book.title}
        </h2>
        <p className="text-sm text-ink-muted">共 {book.chapters.length} 个章节，选择想学习的章节。</p>
      </header>
      <div className="grid gap-3">
        {book.chapters.map((chapter) => {
          const content = chapter.content;
          const counts = [
            content.articles.length ? `文章与会话 ${content.articles.length}` : '',
            content.vocabulary.length ? `词汇 ${content.vocabulary.length}` : '',
            content.grammar.length ? `知识点 ${content.grammar.length}` : '',
            content.sentences.length ? `句子 ${content.sentences.length}` : '',
            content.exercises.length ? `练习 ${content.exercises.length}` : '',
            content.material ? '整理材料' : '',
          ].filter(Boolean);
          return (
            <Button
              key={chapter.id}
              variant="outline"
              className="h-auto justify-between gap-4 whitespace-normal p-5 text-left"
              aria-label={`学习章节：${chapter.title}`}
              onClick={() => onSelect(chapter.id)}
            >
              <span className="space-y-2">
                <span className="block text-base font-semibold">{chapter.title}</span>
                {chapter.subtitle && (
                  <span className="block text-sm text-ink-muted">{chapter.subtitle}</span>
                )}
                <span className="block text-xs text-ink-muted">
                  {counts.length ? counts.join(' · ') : '暂无学习内容'}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                {chapter.id === rememberedChapterId && (
                  <Badge variant="amber">上次浏览</Badge>
                )}
                <ArrowRight className="h-4 w-4" />
              </span>
            </Button>
          );
        })}
      </div>
      {!book.chapters.length && (
        <p className="rounded-2xl border border-line-soft p-8 text-center text-sm text-ink-muted">
          这本教材还没有章节。
        </p>
      )}
    </section>
  );
}
