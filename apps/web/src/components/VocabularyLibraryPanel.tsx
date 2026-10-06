import { useState } from 'react';
import { toast } from 'sonner';
import { useVocabularyQuery, useCollectVocabularyMutation } from '../queries/vocabulary.js';
import { Button } from './ui/button.js';
import { Badge } from './ui/badge.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.js';

export function VocabularyLibraryPanel({ language }: { language: string }) {
  const query = useVocabularyQuery(language), collect = useCollectVocabularyMutation();
  const [search, setSearch] = useState(''), [bookId, setBookId] = useState('ALL'), [chapterId, setChapterId] = useState('ALL');
  const words = query.data ?? [];
  const books = new Map(words.flatMap(word => word.sources.map(source => [source.documentId, source.bookTitle] as const)));
  const chapters = new Map(words.flatMap(word => word.sources.filter(source => source.documentId === bookId).map(source => [source.chapterId, source.chapterTitle] as const)));
  const visible = words.filter(word => (!search || `${word.word} ${word.reading} ${word.meaning}`.includes(search))
    && (bookId === 'ALL' || word.sources.some(source => source.documentId === bookId && (chapterId === 'ALL' || source.chapterId === chapterId))));
  return <section aria-label="词汇库" className="space-y-4 rounded-2xl border border-line bg-paper-soft p-5">
    <header><h2 className="font-semibold">词汇库 <span className="text-sm text-ink-muted">{words.length} 个词</span></h2><p className="mt-1 text-sm text-ink-muted">这里汇总教材词汇、词典收藏和接受的生词草稿，选择需要记忆的词加入复习。</p></header>
    <div className="flex flex-wrap gap-2">
      <input aria-label="搜索词汇" placeholder="搜索单词、读音或词义" className="min-w-48 flex-1 rounded-md border border-line bg-paper px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={search} onChange={event => setSearch(event.target.value)} />
      <Select value={bookId} onValueChange={value => { setBookId(value ?? 'ALL'); setChapterId('ALL'); }}><SelectTrigger aria-label="筛选词汇教材"><SelectValue>{bookId === 'ALL' ? '全部教材与来源' : books.get(bookId)}</SelectValue></SelectTrigger><SelectContent><SelectItem value="ALL">全部教材与来源</SelectItem>{[...books].map(([id, title]) => <SelectItem key={id} value={id}>{title}</SelectItem>)}</SelectContent></Select>
      {bookId !== 'ALL' && <Select value={chapterId} onValueChange={value => setChapterId(value ?? 'ALL')}><SelectTrigger aria-label="筛选词汇章节"><SelectValue>{chapterId === 'ALL' ? '全部章节' : chapters.get(chapterId)}</SelectValue></SelectTrigger><SelectContent><SelectItem value="ALL">全部章节</SelectItem>{[...chapters].map(([id, title]) => <SelectItem key={id} value={id}>{title}</SelectItem>)}</SelectContent></Select>}
    </div>
    {query.isPending && <p className="text-sm text-ink-muted">正在读取词汇…</p>}
    {query.isError && <div role="alert"><p>{query.error.message}</p><Button variant="outline" onClick={() => { void query.refetch(); }}>重试加载</Button></div>}
    {!query.isPending && !query.isError && !visible.length && <p className="text-sm text-ink-muted">{words.length ? '没有符合筛选条件的词汇。' : '暂无词汇。导入教材后会在这里显示，也可以从词典收藏。'}</p>}
    <div className="max-h-96 space-y-3 overflow-y-auto">{visible.map(word => {
      const source = word.sources.find(item => (bookId === 'ALL' || item.documentId === bookId) && (chapterId === 'ALL' || item.chapterId === chapterId));
      return <article key={word.id} className="rounded-xl border border-line p-3">
        <div className="flex items-center justify-between gap-3"><div><strong>{word.word}</strong>{word.reading && <span className="ml-2 text-sm text-ink-muted">{word.reading}</span>}{word.level && <Badge variant="outline" className="ml-2">{word.level}</Badge>}</div>
          <Button size="sm" variant="outline" disabled={word.collected || collect.isPending} onClick={() => collect.mutate({ vocabularyId: word.id, ...(source ? { documentId: source.documentId, chapterId: source.chapterId } : {}) }, {
            onSuccess: result => toast.success(result.created ? '已加入复习' : '已在复习中，进度已保留'), onError: error => toast.error(error.message),
          })}>{word.collected ? '已加入复习' : collect.isPending && collect.variables?.vocabularyId === word.id ? '加入中…' : '加入复习'}</Button></div>
        <p className="mt-2 text-sm">{source?.meaning ?? word.meaning}</p>
        {!!word.sources.length && <p className="mt-1 text-xs text-ink-muted">{word.sources.map(item => `${item.bookTitle} · ${item.chapterTitle}`).join('；')}</p>}
      </article>;
    })}</div>
  </section>;
}
