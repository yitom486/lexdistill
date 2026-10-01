import { useState } from 'react';
import type { TextbookLearningContent } from '@study-studio/document-model';
import { Check, RotateCcw } from 'lucide-react';
import { Button } from '../../ui/button.js';
import { Badge } from '../../ui/badge.js';
import { ToggleGroup, ToggleGroupItem } from '../../ui/toggle-group.js';
import { Textarea } from '../../ui/textarea.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select.js';

type Exercise = TextbookLearningContent['exercises'][number];
const names: Record<Exercise['type'], string> = { CHOICE: '单选', MULTI_CHOICE: '多选', FILL_BLANK: '填空', TRANSLATION: '翻译', ORDERING: '排序', MATCHING: '配对', SHORT_ANSWER: '简答' };

/** Preview-only feedback. Subjective answers show a reference, never claim to have been AI graded. */
export function PreviewExercise({ exercise, index }: { exercise: Exercise; index: number }) {
  const [text, setText] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [pairs, setPairs] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const subjective = exercise.type === 'TRANSLATION' || exercise.type === 'SHORT_ANSWER';
  const strings = Array.isArray(exercise.answer) ? exercise.answer.filter((answer): answer is string => typeof answer === 'string') : [exercise.answer];
  const reference = typeof exercise.answer === 'string' ? exercise.answer : exercise.answer.map(answer => typeof answer === 'string' ? answer : `${answer.left} → ${answer.right}`).join(exercise.type === 'ORDERING' ? ' ' : '；');
  const correct = exercise.type === 'MATCHING'
    ? Array.isArray(exercise.answer) && exercise.answer.every(answer => typeof answer !== 'string' && pairs[answer.left] === answer.right)
    : exercise.type === 'ORDERING' ? selected.length === strings.length && selected.every((value, i) => value === strings[i])
    : exercise.type === 'MULTI_CHOICE' ? selected.length === strings.length && strings.every(value => selected.includes(value))
    : exercise.type === 'CHOICE' ? selected[0] === exercise.answer : text.trim() === exercise.answer;
  const hasInput = exercise.type === 'MATCHING' ? !!exercise.left?.length && exercise.left.every(left => !!pairs[left])
    : exercise.type === 'ORDERING' ? selected.length === exercise.options?.length
    : exercise.type === 'CHOICE' || exercise.type === 'MULTI_CHOICE' ? !!selected.length : !!text.trim();
  const reset = () => { setText(''); setSelected([]); setPairs({}); setSubmitted(false); };
  return <article className="rounded-2xl border border-line-soft bg-paper-soft p-6" aria-label={`练习 ${index + 1}：${names[exercise.type]}`}>
    <div className="mb-4 flex items-center gap-2"><span className="text-sm font-semibold text-accent-ink">{String(index + 1).padStart(2, '0')}</span><Badge variant="outline">{names[exercise.type]}</Badge>{exercise.source === 'AI' && <span className="ml-auto text-xs text-ink-muted">AI 补充练习</span>}</div>
    <h3 className="text-base font-medium leading-7">{exercise.prompt}</h3>
    {(exercise.type === 'CHOICE' || exercise.type === 'MULTI_CHOICE') && <ToggleGroup aria-label={exercise.prompt} orientation="vertical" multiple={exercise.type === 'MULTI_CHOICE'} value={selected} disabled={submitted} onValueChange={(values: unknown[]) => setSelected(values.filter((value): value is string => typeof value === 'string'))} className="mt-5 flex-col">{exercise.options?.map((option, i) => <ToggleGroupItem key={option} value={option} className="justify-start text-left"><span className="text-ink-muted">{String.fromCharCode(65 + i)}</span>{option}</ToggleGroupItem>)}</ToggleGroup>}
    {exercise.type === 'ORDERING' && <div className="mt-5 space-y-3"><div className="flex min-h-14 flex-wrap items-center gap-2 rounded-xl border border-dashed border-line-accent p-3" aria-label="已排列的词块">{selected.length ? selected.map((value, i) => <Button key={i} variant="amber" disabled={submitted} onClick={() => setSelected(previous => previous.filter((_, position) => position !== i))}>{value}</Button>) : <span className="text-sm text-ink-muted">依次点击下面的词块</span>}</div><div className="flex flex-wrap gap-2">{exercise.options?.map(option => <Button key={option} variant="outline" disabled={submitted || selected.includes(option)} onClick={() => setSelected(previous => [...previous, option])}>{option}</Button>)}</div></div>}
    {exercise.type === 'MATCHING' && <div className="mt-5 space-y-3">{exercise.left?.map(left => <div key={left} className="grid grid-cols-2 items-center gap-4"><span className="rounded-xl border border-line-soft px-4 py-3 text-sm">{left}</span><Select value={pairs[left] ?? null} disabled={submitted} onValueChange={value => setPairs(previous => ({ ...previous, [left]: value ?? '' }))}><SelectTrigger aria-label={`匹配：${left}`} className="h-12"><SelectValue placeholder="选择对应词义" /></SelectTrigger><SelectContent>{exercise.right?.map(right => <SelectItem key={right} value={right}>{right}</SelectItem>)}</SelectContent></Select></div>)}</div>}
    {(exercise.type === 'FILL_BLANK' || subjective) && <Textarea aria-label={`${exercise.prompt} 作答`} value={text} onChange={event => setText(event.target.value)} disabled={submitted} rows={exercise.type === 'FILL_BLANK' ? 1 : 3} placeholder="写下你的答案…" className="mt-5" />}
    <div className="mt-5 flex items-center gap-3"><Button disabled={!hasInput || submitted} onClick={() => setSubmitted(true)}><Check className="h-4 w-4" />{subjective ? '对照参考答案' : '检查答案'}</Button>{submitted && <Button variant="ghost" onClick={reset}><RotateCcw className="h-4 w-4" />重新作答</Button>}</div>
    {submitted && <div role="status" className="mt-5 rounded-xl border border-line-soft bg-surface-warm p-4">
      <p className="font-medium">{subjective ? '参考对照 · 尚未评分' : correct ? '回答正确' : '再核对一下'}</p>
      <p className="mt-2 text-sm leading-7">参考答案：{reference}</p>{exercise.explanation && <p className="mt-2 text-sm leading-7 text-ink-muted">{exercise.explanation}</p>}{subjective && exercise.gradingNotes && <p className="mt-2 text-sm leading-7 text-ink-muted">评分要点：{exercise.gradingNotes}</p>}
    </div>}
  </article>;
}
