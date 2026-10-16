import { useState } from 'react';
import { ArrowRight, Check, Target } from 'lucide-react';
import { Button } from '../../ui/button.js';
import { Badge } from '../../ui/badge.js';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../ui/collapsible.js';
import { MarkdownText } from '../../common/MarkdownText.js';
import type { ChapterStudy } from './study-view.js';
import type { LearningSection } from '../../../stores/useTextbookNavigationStore.js';

function SelfCheck({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border border-line-soft bg-paper-soft p-4"><p className="mb-3 text-sm leading-7">{question}</p><CollapsibleTrigger className="text-sm text-accent-ink rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">{open ? '收起参考要点' : '对照参考要点'}</CollapsibleTrigger><CollapsibleContent className="mt-3 text-sm leading-7 text-ink-muted">{answer}</CollapsibleContent></Collapsible>;
}

export function StudyGuide({ study, summary, onNavigate }: { study: ChapterStudy; summary: boolean; onNavigate: (section: LearningSection) => void }) {
  const [checked, setChecked] = useState<string[]>([]);
  return <div className="space-y-6">
    <section className="border-b border-line-soft pb-6"><h3 className="mb-3 text-lg font-semibold">{summary ? '把本课串起来' : '这节课怎么学'}</h3><MarkdownText text={summary ? study.summary : study.introduction} /></section>
    <section className="rounded-2xl border border-line-soft bg-paper-soft p-6"><h3 className="mb-4 flex items-center gap-2 text-lg font-semibold"><Target className="h-5 w-5 text-accent-ink" />{summary ? '对照目标自检' : '本课需要掌握什么'}</h3><div className="space-y-3">{study.goals.map(goal => <div key={goal} className="flex items-start gap-3"><Button size="icon" variant={checked.includes(goal) ? 'amber' : 'outline'} aria-label={`自检：${goal}`} aria-pressed={checked.includes(goal)} onClick={() => setChecked(previous => previous.includes(goal) ? previous.filter(value => value !== goal) : [...previous, goal])}>{checked.includes(goal) ? <Check className="h-4 w-4" /> : <span className="h-3 w-3 rounded-full border border-line-soft" />}</Button><p className="pt-2 text-sm leading-7">{goal}</p></div>)}</div><p className="mt-4 text-xs text-ink-muted">勾选仅表示你的本次自检，不作为系统掌握度。</p></section>
    {!summary && <section><h3 className="mb-4 text-lg font-semibold">学习主线</h3><div className="space-y-3">{study.steps.map((step, index) => <Button key={step.title} variant="outline" className="h-auto w-full justify-start gap-4 whitespace-normal p-4 text-left" onClick={() => onNavigate(step.section)}><Badge variant="amber">{index + 1}</Badge><span className="flex-1"><span className="block font-semibold">{step.title}</span><span className="mt-1 block text-xs leading-6 text-ink-muted">{step.description}</span></span><ArrowRight className="h-4 w-4" /></Button>)}</div></section>}
    {summary && <section className="space-y-3"><h3 className="text-lg font-semibold">遮住答案，自己说一遍</h3>{study.selfCheck.map(item => <SelfCheck key={item.question} {...item} />)}</section>}
  </div>;
}
