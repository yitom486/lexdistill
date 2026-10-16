import { useState } from 'react';
import type { LessonContent, ContentDirectoryNode } from '@lexdistill/document-model';
import { DirectoryGroups } from './DirectoryGroups.js';
import { ContentSource } from './ContentSource.js';
import { VocabularyExplanation } from './VocabularyExplanation.js';
import { TextbookWordAiPanel } from './TextbookWordAiPanel.js';
import { Button } from '../ui/button.js';
interface Props { words: LessonContent['vocabularies']; directory?: readonly ContentDirectoryNode[]; onAdd?: (id: string) => void; added?: Record<string, boolean>; enableAi?: boolean }
export function StructuredVocabularyList({ words, directory, onAdd, added, enableAi }: Props) {
  const [openAiId, setOpenAiId] = useState<string | null>(null);
  return <section className="space-y-3" aria-label="结构化生词"><DirectoryGroups {...(directory ? { directory } : {})} items={words} render={items => <div className="grid gap-3 md:grid-cols-2">
    {items.map(word => <article key={word.id} data-content-id={word.id} className="space-y-2 rounded-xl border border-line bg-surface p-4 text-ink">
      <header className="flex flex-wrap items-baseline gap-2"><h4 className="font-semibold">{word.surface}</h4>{word.reading && <span>{word.reading}</span>}{word.pos && <span className="text-xs text-ink-muted">{word.pos}</span>}{word.pitch && <span>{word.pitch}</span>}</header>
      <div className="flex flex-wrap gap-2"><ContentSource source={word.source} />{word.fieldSources?.reading && <ContentSource source={word.fieldSources.reading} field="注音" />}</div>
      {word.gloss && <div>{word.fieldSources?.gloss && <ContentSource source={word.fieldSources.gloss} field="释义" />}<p>{word.gloss}</p></div>}
      <VocabularyExplanation word={word} />
      <div className="flex flex-wrap gap-2">
        {onAdd && <Button variant="outline" size="sm" disabled={added?.[word.id]} onClick={() => onAdd(word.id)}>{added?.[word.id] ? '已加入复习' : '加为 FSRS 闪卡'}</Button>}
        {enableAi && <Button variant="outline" size="sm" onClick={() => setOpenAiId(current => current === word.id ? null : word.id)}>{openAiId === word.id ? '收起讲解' : 'AI 讲透'}</Button>}
      </div>
      {enableAi && openAiId === word.id && <TextbookWordAiPanel row={word} />}
    </article>)}
  </div>} /></section>;
}
