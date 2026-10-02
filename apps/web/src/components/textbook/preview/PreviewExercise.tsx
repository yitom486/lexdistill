import { useState } from 'react';
import type { TextbookLearningContent } from '@study-studio/document-model';
import { Check, RotateCcw } from 'lucide-react';
import { Button } from '../../ui/button.js';
import { Badge } from '../../ui/badge.js';
import { ToggleGroup, ToggleGroupItem } from '../../ui/toggle-group.js';
import { Textarea } from '../../ui/textarea.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select.js';

type Exercise = TextbookLearningContent['exercises'][number];
export const exerciseNames: Record<Exercise['type'], string> = {
  CHOICE: '单选', MULTI_CHOICE: '多选', FILL_BLANK: '填空', TRANSLATION: '翻译',
  ORDERING: '排序', MATCHING: '配对', SHORT_ANSWER: '简答', WRITING: '写作',
};

/** Preview-only feedback. Subjective answers show a reference, never claim to have been AI graded. */
export function PreviewExercise({ exercise, index }: { exercise: Exercise; index: number }) {
  const [answers, setAnswers] = useState<string[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [pairs, setPairs] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const subjective = ['TRANSLATION', 'SHORT_ANSWER', 'WRITING'].includes(exercise.type);
  const strings = Array.isArray(exercise.answer)
    ? exercise.answer.filter((answer): answer is string => typeof answer === 'string') : exercise.answer ? [exercise.answer] : [];
  const reference = typeof exercise.answer === 'string' ? exercise.answer
    : exercise.answer?.map(answer => typeof answer === 'string' ? answer : `${answer.left} → ${answer.right}`)
      .join(exercise.type === 'ORDERING' ? ' ' : '；');
  const choices = selected.map(position => exercise.options?.[position] ?? '');
  const correct = exercise.type === 'MATCHING'
    ? Array.isArray(exercise.answer) && exercise.answer.every(answer => typeof answer !== 'string'
      && pairs[exercise.left?.indexOf(answer.left) ?? -1] === answer.right)
    : exercise.type === 'ORDERING' ? choices.length === strings.length && choices.every((value, i) => value === strings[i])
    : exercise.type === 'MULTI_CHOICE' ? choices.length === strings.length && [...choices].sort().every((value, i) => value === [...strings].sort()[i])
    : exercise.type === 'CHOICE' ? choices[0] === exercise.answer
    : strings.every((answer, i) => answers[i]?.trim() === answer);
  const inputCount = exercise.type === 'FILL_BLANK' ? strings.length : 1;
  const hasInput = exercise.type === 'MATCHING' ? !!exercise.left?.length && exercise.left.every((_, i) => !!pairs[i])
    : exercise.type === 'ORDERING' ? selected.length === exercise.options?.length
    : exercise.type === 'CHOICE' || exercise.type === 'MULTI_CHOICE' ? !!selected.length
    : Array.from({ length: inputCount }, (_, i) => answers[i]?.trim()).every(Boolean);
  const reset = () => { setAnswers([]); setSelected([]); setPairs({}); setSubmitted(false); };
  const help = exercise.type === 'MULTI_CHOICE' ? '可以选择多个选项，选完后检查答案。'
    : exercise.type === 'ORDERING' ? '依次选择词块；点击已排列的词块可以撤回。'
    : exercise.type === 'MATCHING' ? '为左侧各项选择对应项。'
    : exercise.type === 'FILL_BLANK' ? `按题干空格的顺序填写${inputCount > 1 ? ` ${inputCount} 个答案` : '答案'}。`
    : subjective ? '写出你的表达，不要求与参考答案逐字一致。当前可对照参考，尚未接入 AI 评分。'
    : '选择一个答案。';

  return <article className="rounded-2xl border border-line-soft bg-paper-soft p-6" aria-label={`练习 ${index + 1}：${exerciseNames[exercise.type]}`}>
    <div className="mb-4 flex items-center gap-2">
      <span className="text-sm font-semibold text-accent-ink">{String(index + 1).padStart(2, '0')}</span>
      <Badge variant="outline">{exerciseNames[exercise.type]}</Badge>
      <span className="text-xs text-ink-muted" title={exercise.difficultyReason ?? undefined}>{exercise.difficultyTier === null ? '难度未估计' : `难度 ${exercise.difficultyTier}/5`}</span>
      {exercise.source === 'AI' && <span className="ml-auto text-xs text-ink-muted">AI 补充练习</span>}
    </div>
    <h3 className="whitespace-pre-wrap text-base font-medium leading-7">{exercise.prompt}</h3>
    <p className="mt-2 text-xs leading-6 text-ink-muted">{help}</p>
    {(exercise.type === 'CHOICE' || exercise.type === 'MULTI_CHOICE') && <ToggleGroup
      aria-label={exercise.prompt} orientation="vertical" multiple={exercise.type === 'MULTI_CHOICE'}
      value={selected.map(String)} disabled={submitted}
      onValueChange={(values: unknown[]) => setSelected(values.filter((value): value is string => typeof value === 'string').map(Number))}
      className="mt-5 flex-col">
      {exercise.options?.map((option, i) => <ToggleGroupItem key={i} value={String(i)} className="justify-start text-left">
        <span className="text-ink-muted">{String.fromCharCode(65 + i)}</span>{option}
      </ToggleGroupItem>)}
    </ToggleGroup>}
    {exercise.type === 'ORDERING' && <div className="mt-5 space-y-3">
      <div className="flex min-h-14 flex-wrap items-center gap-2 rounded-xl border border-dashed border-line-accent p-3" aria-label="已排列的词块">
        {selected.length ? selected.map((position, i) => <Button key={position} variant="amber" disabled={submitted}
          onClick={() => setSelected(previous => previous.filter((_, at) => at !== i))}>{exercise.options?.[position]}</Button>)
          : <span className="text-sm text-ink-muted">依次点击下面的词块</span>}
      </div>
      <div className="flex flex-wrap gap-2" aria-label="待选词块">
        {exercise.options?.map((option, position) => <Button key={position} variant="outline"
          disabled={submitted || selected.includes(position)} onClick={() => setSelected(previous => [...previous, position])}>{option}</Button>)}
      </div>
    </div>}
    {exercise.type === 'MATCHING' && <div className="mt-5 space-y-3">
      {exercise.left?.map((left, i) => <div key={i} className="grid grid-cols-2 items-center gap-4">
        <span className="rounded-xl border border-line-soft px-4 py-3 text-sm">{left}</span>
        <Select value={pairs[i] ?? null} disabled={submitted} onValueChange={value => setPairs(previous => ({ ...previous, [i]: value ?? '' }))}>
          <SelectTrigger aria-label={`匹配：${left}`} className="h-12"><SelectValue placeholder="选择对应项" /></SelectTrigger>
          <SelectContent>{exercise.right?.map((right, position) => <SelectItem key={position} value={right}>{right}</SelectItem>)}</SelectContent>
        </Select>
      </div>)}
    </div>}
    {(exercise.type === 'FILL_BLANK' || subjective) && <div className="mt-5 space-y-3">
      {Array.from({ length: inputCount }, (_, i) => <label key={i} className="block space-y-2">
        <span className="text-xs text-ink-muted">{exercise.type === 'FILL_BLANK' ? `第 ${i + 1} 空` : '你的作答'}</span>
        <Textarea aria-label={inputCount === 1 ? `${exercise.prompt} 作答` : `${exercise.prompt} 第 ${i + 1} 空`}
          value={answers[i] ?? ''} onChange={event => setAnswers(previous => { const next = [...previous]; next[i] = event.target.value; return next; })}
          disabled={submitted} rows={exercise.type === 'FILL_BLANK' ? 1 : exercise.type === 'TRANSLATION' ? 3 : 5}
          placeholder={exercise.type === 'FILL_BLANK' ? '填写这一空…' : '写下你的表达…'} />
      </label>)}
    </div>}
    <div className="mt-5 flex items-center gap-3">
      <Button disabled={!hasInput || submitted} onClick={() => setSubmitted(true)}><Check className="h-4 w-4" />{subjective ? '对照参考答案' : '检查答案'}</Button>
      {submitted && <Button variant="ghost" onClick={reset}><RotateCcw className="h-4 w-4" />重新作答</Button>}
    </div>
    {submitted && <div role="status" className="mt-5 rounded-xl border border-line-soft bg-surface-warm p-4">
      <p className="font-medium">{subjective ? '参考对照 · 尚未评分' : correct ? '回答正确' : '再核对一下'}</p>
      {reference && <p className="mt-2 text-sm leading-7">参考答案：{reference}</p>}
      {exercise.explanation && <p className="mt-2 text-sm leading-7 text-ink-muted">{exercise.explanation}</p>}
      {subjective && exercise.gradingNotes && <p className="mt-2 text-sm leading-7 text-ink-muted">评分要点：{exercise.gradingNotes}</p>}
    </div>}
  </article>;
}
