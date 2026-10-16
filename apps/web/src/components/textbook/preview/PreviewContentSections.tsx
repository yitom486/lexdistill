import { useState, type ReactNode } from 'react';
import { BookmarkCheck, BookmarkPlus, ChevronDown } from 'lucide-react';
import { Badge } from '../../ui/badge.js';
import { Button } from '../../ui/button.js';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../ui/collapsible.js';
import { UnifiedTtsPlayer } from '../../UnifiedTtsPlayer.js';
import { trackToSpeechLang } from '../../../config/speech-language.js';
import type { StudyContentProps } from './study-view.js';
import { KnowledgeCard } from './KnowledgeCard.js';
import { MarkdownText } from '../../common/MarkdownText.js';
import { toast } from 'sonner';
import type { VocabularyScope } from '@lexdistill/protocol';
import { useVocabularyQuery, useCollectVocabularyMutation } from '../../../queries/vocabulary.js';

type Props = StudyContentProps;
const panel = 'rounded-2xl border border-line-soft bg-paper-soft p-6';

function Disclosure({ label, children }: { label: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <Collapsible open={open} onOpenChange={setOpen} className="mt-4 border-t border-line-soft pt-3">
    <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg py-1 text-left text-sm font-medium text-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">{label}<ChevronDown className={`ml-auto h-4 w-4 ${open ? 'rotate-180' : ''}`} /></CollapsibleTrigger>
    <CollapsibleContent className="mt-3 text-sm leading-7 text-ink-muted">{children}</CollapsibleContent>
  </Collapsible>;
}

export function PreviewMaterial({ text }: { text: string }) {
  return <Disclosure label="查看整理材料"><p className="whitespace-pre-wrap text-xs leading-6">{text}</p></Disclosure>;
}

export function PreviewVocabulary({ content, showTranslation, language, explain, scope = {}, temporary = true }: Props & { scope?: VocabularyScope; temporary?: boolean }) {
  const query = useVocabularyQuery(language, scope, !temporary);
  const collect = useCollectVocabularyMutation();
  return <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{content.vocabulary.map(word => {
    const saved = query.data?.find(entry => entry.id === word.vocabularyId)?.collected ?? false;
    return <article key={word.id} className={panel}>
      <div className="flex items-start justify-between gap-4">
        <div><h3 className="text-2xl font-semibold">{word.word}</h3><p className="mt-1 text-sm text-ink-muted">{word.reading}</p></div>
        <div className="flex items-center gap-2">{word.level && <Badge variant="amber" title="词汇难度为模型估计，不代表掌握度">{word.level}</Badge>}
          <Button variant="outline" size="sm" aria-label={`${saved ? '已加入复习' : '加入复习'}：${word.word}`} aria-pressed={saved}
            disabled={temporary || !word.vocabularyId || saved || query.isPending || query.isError || collect.isPending}
            title={temporary ? '演示内容不写入个人复习' : undefined}
            onClick={() => word.vocabularyId && collect.mutate({ vocabularyId: word.vocabularyId, ...scope }, {
              onSuccess: result => toast.success(result.created ? '已加入复习' : '已在复习中，进度已保留'), onError: error => toast.error(error.message),
            })}>
            {saved ? <BookmarkCheck className="h-4 w-4 text-accent-ink" /> : <BookmarkPlus className="h-4 w-4" />}{temporary ? '演示内容' : saved ? '已加入复习' : collect.isPending && collect.variables?.vocabularyId === word.vocabularyId ? '加入中…' : '加入复习'}
          </Button></div>
      </div>
      <div className="mt-4 flex items-center gap-2"><Badge variant="outline">{word.partOfSpeech ?? '词汇'}</Badge>{word.pitch && <span className="text-xs text-ink-muted">音调 {word.pitch}</span>}</div>
      <div className="mt-3 flex flex-wrap gap-2"><UnifiedTtsPlayer text={word.word} lang={trackToSpeechLang(language)} label="听读词汇" />{explain({ title: '词汇讲解', text: word.word, translation: word.meaning, ...(word.explanation ? { explanation: word.explanation } : {}) }, '用法与 AI 讲解')}</div>
      {showTranslation ? <p className="mt-3 font-medium">{word.meaning}</p> : <Disclosure label="查看词义"><p>{word.meaning}</p></Disclosure>}
      {!!word.examples.length && <div className="mt-4 border-t border-line-soft pt-4 space-y-3">{word.examples.map((example, index) => <div key={index}><p className="leading-7">{example.text}</p>{showTranslation && example.translation && <p className="mt-1 text-sm text-ink-muted">{example.translation}</p>}</div>)}</div>}
      {word.explanation && <div className="mt-3 text-sm leading-6 text-ink-muted"><MarkdownText text={word.explanation} /></div>}
    </article>;
  })}{query.isError && <div role="alert"><p>{query.error.message}</p><Button variant="outline" onClick={() => { void query.refetch(); }}>重试加载收藏状态</Button></div>}</div>;
}

export function PreviewGrammar({ content, showTranslation, language, ask }: Props) {
  return <div className="space-y-5">{content.grammar.map((point, index) => <KnowledgeCard key={point.id} point={point} index={index} language={language} showTranslation={showTranslation} onAsk={ask} />)}</div>;
}

export function PreviewSentences({ content, showTranslation, language, explain }: Props) {
  return <div className="divide-y divide-line-soft border-t border-line-soft">{content.sentences.map((sentence, index) => <article key={sentence.id} className="py-4">
    <div className="flex items-baseline gap-3"><span className="text-sm tabular-nums text-accent-ink shrink-0">{String(index + 1).padStart(2, '0')}</span><p className="text-xl leading-9 max-w-[75ch]">{sentence.speaker && `${sentence.speaker}：`}{sentence.text}</p></div>
    <div className="mt-3 flex flex-wrap gap-2 pl-8"><UnifiedTtsPlayer text={sentence.text} lang={trackToSpeechLang(language)} label="听读 / 跟读" />{explain({ title: '句子讲解', text: sentence.text, ...(sentence.translation ? { translation: sentence.translation } : {}), ...(sentence.explanation ? { explanation: sentence.explanation } : {}) }, '讲解')}</div>
    {showTranslation && sentence.translation && <p className="mt-2 pl-8 text-sm text-ink-muted max-w-[75ch]">{sentence.translation}</p>}
    {(sentence.explanation || (!showTranslation && sentence.translation)) && <div className="pl-8"><Disclosure label="查看译文与用法">{!showTranslation && sentence.translation && <p>{sentence.translation}</p>}{sentence.explanation && <div className="mt-2"><MarkdownText text={sentence.explanation} /></div>}</Disclosure></div>}
  </article>)}</div>;
}
