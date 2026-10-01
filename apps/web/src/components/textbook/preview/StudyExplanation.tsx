import { useId, useState } from 'react';
import type { TextbookLearningContent } from '@study-studio/document-model';
import { Lightbulb, Sparkles, X } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../ui/collapsible.js';
import { Button, buttonVariants } from '../../ui/button.js';
import { MarkdownText } from '../../common/MarkdownText.js';
import { UnifiedTtsPlayer } from '../../UnifiedTtsPlayer.js';
import { trackToSpeechLang } from '../../../config/speech-language.js';
import type { StudyDetail } from './study-view.js';

export function StudyExplanation({ detail, content, language, label, disabled = false, onAsk }: {
  detail: StudyDetail; content: TextbookLearningContent; language: string; label: string; disabled?: boolean;
  onAsk?: ((text: string, context: string) => void) | undefined;
}) {
  const [open, setOpen] = useState(false), id = useId();
  const related = content.grammar.filter(point => detail.knowledgeTitles?.includes(point.title));
  return <Collapsible open={open} onOpenChange={setOpen} className="contents">
    <CollapsibleTrigger disabled={disabled} aria-controls={id} className={buttonVariants({ variant: 'ghost', size: 'sm' })}><Lightbulb className="h-4 w-4" />{label}</CollapsibleTrigger>
    <CollapsibleContent className="w-full basis-full"><section id={id} role="region" aria-label={detail.title} data-testid="inline-explanation" className="mt-3 rounded-xl border border-line-soft bg-surface-warm p-4 text-ink">
      <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">{detail.title}</h3><Button variant="ghost" size="icon" className="h-7 w-7" aria-label="关闭讲解" onClick={() => setOpen(false)}><X className="h-4 w-4" /></Button></div>
      <div className="max-h-64 space-y-4 overflow-y-auto text-sm leading-7">
      {detail.translation && <p className="text-ink-muted">{detail.translation}</p>}
      {detail.explanation && <section><h4 className="mb-2 font-semibold">注意点</h4><MarkdownText text={detail.explanation} /></section>}
      {related.map(point => <section key={point.id} className="border-t border-line-soft pt-3"><h4 className="mb-2 font-semibold">{point.title}</h4>{point.connection && <p className="mb-2 text-accent-ink">{point.connection}</p>}<MarkdownText text={point.explanation} />{point.aiExplanation && <div className="mt-3"><p className="mb-2 text-xs text-ink-muted">AI 补充讲解</p><MarkdownText text={point.aiExplanation} /></div>}</section>)}
      {!detail.explanation && !related.length && <p className="text-sm text-ink-muted">当前没有已保存的讲解，可以向 AI 导师提问。</p>}
      </div><div className="mt-3 flex flex-wrap gap-2 border-t border-line-soft pt-3"><UnifiedTtsPlayer text={detail.text} lang={trackToSpeechLang(language)} label="听这一段" /><Button size="sm" disabled={!onAsk} onClick={() => { setOpen(false); onAsk?.(detail.text, [detail.translation ? `译文：${detail.translation}` : '', detail.explanation ? `已有讲解：${detail.explanation}` : '', ...related.map(point => `相关知识：${point.title}\n${point.explanation}`)].filter(Boolean).join('\n')); }}><Sparkles className="h-4 w-4" />继续问 AI</Button></div>
    </section></CollapsibleContent>
  </Collapsible>;
}
