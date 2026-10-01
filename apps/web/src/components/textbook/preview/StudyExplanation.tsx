import type { TextbookLearningContent } from '@study-studio/document-model';
import { Sparkles } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../../ui/sheet.js';
import { Button } from '../../ui/button.js';
import { MarkdownText } from '../../common/MarkdownText.js';
import { UnifiedTtsPlayer } from '../../UnifiedTtsPlayer.js';
import { trackToSpeechLang } from '../../../config/speech-language.js';
import type { StudyDetail } from './study-view.js';

export function StudyExplanation({ detail, content, language, onClose, onAsk }: {
  detail: StudyDetail | null; content: TextbookLearningContent; language: string; onClose: () => void;
  onAsk?: ((text: string, context: string) => void) | undefined;
}) {
  const related = content.grammar.filter(point => detail?.knowledgeTitles?.includes(point.title));
  return <Sheet open={!!detail} onOpenChange={open => { if (!open) onClose(); }}><SheetContent className="sm:max-w-xl">
    <SheetHeader className="pr-12"><SheetTitle>{detail?.title ?? '学习讲解'}</SheetTitle><SheetDescription>查看当前表达的译文、注意点和相关知识。</SheetDescription></SheetHeader>
    {detail && <><div className="flex-1 space-y-6 overflow-y-auto p-6"><section><p className="mb-3 whitespace-pre-wrap text-xl leading-9">{detail.text}</p><UnifiedTtsPlayer text={detail.text} lang={trackToSpeechLang(language)} label="听这一段" />{detail.translation && <p className="mt-4 text-sm leading-7 text-ink-muted">{detail.translation}</p>}</section>
      {detail.explanation && <section><h3 className="mb-3 font-semibold">注意点</h3><MarkdownText text={detail.explanation} /></section>}
      {related.map(point => <section key={point.id} className="rounded-xl border border-line-soft p-4"><h3 className="mb-3 font-semibold">{point.title}</h3>{point.connection && <p className="mb-3 text-sm text-accent-ink">{point.connection}</p>}<MarkdownText text={point.explanation} />{point.aiExplanation && <div className="mt-4"><p className="mb-2 text-xs text-ink-muted">AI 补充讲解</p><MarkdownText text={point.aiExplanation} /></div>}</section>)}
      {!detail.explanation && !related.length && <p className="text-sm text-ink-muted">当前没有已保存的讲解，可以向 AI 导师提问。</p>}
    </div><div className="border-t border-line-soft p-4"><Button className="w-full" disabled={!onAsk} onClick={() => { onClose(); onAsk?.(detail.text, [detail.translation ? `译文：${detail.translation}` : '', detail.explanation ? `已有讲解：${detail.explanation}` : '', ...related.map(point => `相关知识：${point.title}\n${point.explanation}`)].filter(Boolean).join('\n')); }}><Sparkles className="h-4 w-4" />继续问 AI</Button></div></>}
  </SheetContent></Sheet>;
}
