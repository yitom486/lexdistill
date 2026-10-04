import { useState } from 'react';
import type { TextbookLearningContent } from '@study-studio/document-model';
import { ChevronDown, Sparkles } from 'lucide-react';
import { Badge } from '../../ui/badge.js';
import { Button } from '../../ui/button.js';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../ui/collapsible.js';
import { MarkdownText } from '../../common/MarkdownText.js';
import { UnifiedTtsPlayer } from '../../UnifiedTtsPlayer.js';
import { trackToSpeechLang } from '../../../config/speech-language.js';

export function KnowledgeCard({ point, index, language, showTranslation, onAsk }: {
  point: TextbookLearningContent['grammar'][number]; index: number; language: string; showTranslation: boolean;
  onAsk?: ((text: string, context: string) => void) | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const context = [
    `知识点：${point.title}`, point.connection ? `接续：${point.connection}` : '', `规则与说明：\n${point.explanation}`,
    ...point.examples.map(example => `例句：${example.text}${example.translation ? `\n译文：${example.translation}` : ''}`),
    point.aiExplanation ? `补充说明：\n${point.aiExplanation}` : '',
  ].filter(Boolean).join('\n\n');
  return <article className="space-y-5 rounded-2xl border border-line-soft bg-paper-soft p-6">
    <header><div className="mb-3 flex items-center justify-between gap-3"><Badge variant="amber">{point.kind === 'PRONUNCIATION' ? '发音' : point.kind === 'USAGE' ? '用法' : '语法'}</Badge><span className="text-xs tabular-nums text-ink-muted">{String(index + 1).padStart(2, '0')}</span></div><h3 className="text-xl font-semibold">{point.title}</h3></header>
    {point.connection && <div className="rounded-xl bg-wash-amber-500o10 px-4 py-3"><p className="mb-1 text-xs text-ink-muted">接续</p><p className="font-medium text-accent-ink">{point.connection}</p></div>}
    <section aria-label="规则与说明"><MarkdownText text={point.explanation} variant="lesson" /></section>
    {!!point.examples.length && <section className="space-y-3 border-t border-line-soft pt-4" aria-label={point.kind === 'PRONUNCIATION' ? '听读对比' : '例句'}>
      <h4 className="text-xs font-semibold text-ink-muted">{point.kind === 'PRONUNCIATION' ? '听读对比' : '例句'}</h4>
      {point.examples.map((example, i) => <div key={i} className="border-l-2 border-line-accent pl-4">
        <div className="flex items-start gap-2"><p className="flex-1 leading-7">{example.text}</p><UnifiedTtsPlayer text={example.text} lang={trackToSpeechLang(language)} variant="inline" /></div>
        {showTranslation && example.translation && <p className="mt-1 text-sm leading-6 text-ink-muted">{example.translation}</p>}
      </div>)}
    </section>}
    {point.aiExplanation && <Collapsible open={expanded} onOpenChange={setExpanded} className="border-t border-line-soft pt-4">
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg py-1 text-left text-sm text-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">补充说明<Badge variant="outline">AI</Badge><ChevronDown className={`ml-auto h-4 w-4 ${expanded ? 'rotate-180' : ''}`} /></CollapsibleTrigger>
      <CollapsibleContent className="mt-3"><MarkdownText text={point.aiExplanation} variant="lesson" /></CollapsibleContent>
    </Collapsible>}
    <div className="flex justify-end border-t border-line-soft pt-3"><Button variant="ghost" size="sm" disabled={!onAsk} onClick={() => onAsk?.(point.title, context)}><Sparkles className="h-4 w-4" />向 AI 追问</Button></div>
  </article>;
}
