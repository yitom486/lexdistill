import { useState, type ReactNode } from 'react';
import type { TextbookLearningContent } from '@study-studio/document-model';
import { BookmarkCheck, BookmarkPlus, ChevronDown, Lightbulb } from 'lucide-react';
import { Badge } from '../../ui/badge.js';
import { Button } from '../../ui/button.js';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../ui/collapsible.js';

type Props = { content: TextbookLearningContent; showTranslation: boolean };
const panel = 'rounded-2xl border border-line-soft bg-paper-soft p-6';

function Disclosure({ label, children }: { label: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <Collapsible open={open} onOpenChange={setOpen} className="mt-4 border-t border-line-soft pt-3">
    <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg py-1 text-left text-sm font-medium text-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{label}<ChevronDown className={`ml-auto h-4 w-4 ${open ? 'rotate-180' : ''}`} /></CollapsibleTrigger>
    <CollapsibleContent className="mt-3 text-sm leading-7 text-ink-muted">{children}</CollapsibleContent>
  </Collapsible>;
}

export function PreviewMaterial({ text }: { text: string }) {
  return <Disclosure label="查看整理材料"><p className="whitespace-pre-wrap text-xs leading-6">{text}</p></Disclosure>;
}

export function PreviewVocabulary({ content, showTranslation }: Props) {
  const [collected, setCollected] = useState<Set<string>>(() => new Set());
  return <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{content.vocabulary.map(word => {
    const saved = collected.has(word.id);
    return <article key={word.id} className={panel}>
      <div className="flex items-start justify-between gap-4">
        <div><h3 className="text-2xl font-semibold">{word.word}</h3><p className="mt-1 text-sm text-ink-muted">{word.reading}</p></div>
        <div className="flex items-center gap-2">{word.level && <Badge variant="amber" title="词汇难度为模型估计，不代表掌握度">{word.level}</Badge>}
          <Button variant="ghost" size="icon" aria-label={`${saved ? '取消复习' : '加入复习'}：${word.word}`} aria-pressed={saved} onClick={() => setCollected(previous => { const next = new Set(previous); if (saved) next.delete(word.id); else next.add(word.id); return next; })}>
            {saved ? <BookmarkCheck className="h-4 w-4 text-accent-ink" /> : <BookmarkPlus className="h-4 w-4" />}
          </Button></div>
      </div>
      <div className="mt-4 flex items-center gap-2"><Badge variant="outline">{word.partOfSpeech ?? '词汇'}</Badge>{word.pitch && <span className="text-xs text-ink-muted">音调 {word.pitch}</span>}</div>
      {showTranslation ? <p className="mt-3 font-medium">{word.meaning}</p> : <Disclosure label="查看词义"><p>{word.meaning}</p></Disclosure>}
      {!!word.examples.length && <div className="mt-4 border-t border-line-soft pt-4 space-y-3">{word.examples.map((example, index) => <div key={index}><p className="leading-7">{example.text}</p>{showTranslation && example.translation && <p className="mt-1 text-sm text-ink-muted">{example.translation}</p>}</div>)}</div>}
      {word.explanation && <p className="mt-3 text-sm leading-6 text-ink-muted">{word.explanation}</p>}
    </article>;
  })}</div>;
}

export function PreviewGrammar({ content, showTranslation }: Props) {
  return <div className="space-y-5">{content.grammar.map((point, index) => <article key={point.id} className={panel}>
    <div className="mb-4 flex items-center gap-2"><Badge variant="amber">{point.kind === 'PRONUNCIATION' ? '发音' : point.kind === 'USAGE' ? '用法' : '语法'}</Badge><span className="ml-auto text-xs tabular-nums text-ink-muted">{String(index + 1).padStart(2, '0')}</span></div>
    <h3 className="text-xl font-semibold">{point.title}</h3>
    {point.connection && <p className="mt-4 rounded-xl bg-wash-amber-500o10 px-4 py-3 font-medium text-accent-ink">{point.connection}</p>}
    <p className="mt-4 whitespace-pre-wrap text-sm leading-7">{point.explanation}</p>
    {!!point.examples.length && <div className="mt-5 space-y-3 border-l-2 border-line-accent pl-4">{point.examples.map((example, i) => <div key={i}><p className="leading-7">{example.text}</p>{showTranslation && example.translation && <p className="text-sm text-ink-muted">{example.translation}</p>}</div>)}</div>}
    {point.aiExplanation && <Disclosure label={<><Lightbulb className="h-4 w-4" />换个角度理解<Badge variant="outline">AI 补充</Badge></>}><p>{point.aiExplanation}</p></Disclosure>}
  </article>)}</div>;
}

export function PreviewArticles({ content, showTranslation }: Props) {
  return <div className="space-y-5">{content.articles.map(article => <article key={article.id} className={panel}>
    <div className="mb-6 flex items-center justify-between gap-3"><h3 className="text-lg font-semibold">{article.title ?? '阅读正文'}</h3><Badge variant="outline">{article.source === 'AI' ? 'AI 补充' : '教材内容'}</Badge></div>
    <div className="whitespace-pre-wrap text-xl leading-[2.4]">{article.text}</div>
    {article.translation && (showTranslation ? <div className="mt-6 border-t border-line-soft pt-5"><h4 className="mb-3 text-xs font-semibold tracking-wider text-ink-muted">译文</h4><p className="whitespace-pre-wrap text-sm leading-8 text-ink-muted">{article.translation}</p></div> : <Disclosure label="展开整篇译文"><p className="whitespace-pre-wrap leading-8">{article.translation}</p></Disclosure>)}
  </article>)}</div>;
}

export function PreviewSentences({ content, showTranslation }: Props) {
  return <div className="space-y-4">{content.sentences.map((sentence, index) => <article key={sentence.id} className={panel}>
    <div className="flex items-center gap-3"><span className="text-sm tabular-nums text-accent-ink">{String(index + 1).padStart(2, '0')}</span><p className="text-xl leading-9">{sentence.speaker && `${sentence.speaker}：`}{sentence.text}</p></div>
    {showTranslation && sentence.translation && <p className="mt-2 pl-7 text-sm text-ink-muted">{sentence.translation}</p>}
    {(sentence.explanation || (!showTranslation && sentence.translation)) && <Disclosure label="查看译文与用法">{!showTranslation && sentence.translation && <p>{sentence.translation}</p>}{sentence.explanation && <p className="mt-2">{sentence.explanation}</p>}</Disclosure>}
  </article>)}</div>;
}
