import { useState } from 'react';
import { Button } from '../ui/button.js';
import { ReadingPassagePanel } from './ReadingPassagePanel.js';
import { DictationAnswer } from './DictationAnswer.js';
import type { GeneratedQuestion } from '@lexdistill/protocol';

type GradingMode = 'AUTO_IMMEDIATE' | 'AI_IMMEDIATE' | 'AI_BATCH';
interface Props {
  question: GeneratedQuestion;
  userAnswer: string;
  language?: 'en' | 'ja' | 'ko' | undefined;
  gradingMode?: GradingMode | undefined;
  onAnswerChange: (answer: string) => void;
  onSubmitObjective: (answer: string) => void;
  onSubmitSubjective?: ((answer: string) => void) | undefined;
  onSaveDraft: (answer: string) => void;
  disabled: boolean;
  busy: boolean;
  submittingSubjective?: boolean | undefined;
}

export function QuestionRenderer({ question: q, userAnswer: answer, language = 'en', gradingMode = 'AUTO_IMMEDIATE',
  onAnswerChange: update, onSubmitObjective, onSubmitSubjective, onSaveDraft, disabled, busy, submittingSubjective }: Props) {
  const [picked, setPicked] = useState<number[]>([]);
  const locked = disabled || busy;
  const objective = ['MULTIPLE_CHOICE', 'FILL_IN_BLANK', 'SENTENCE_REORDER'].includes(q.type);
  const chunks = q.content.split(/\s+/).filter(Boolean);
  return <div className="flex flex-col gap-3">
    {q.reading && <ReadingPassagePanel reading={q.reading} />}
    {q.type === 'LISTENING_DICTATION' ? <DictationAnswer question={q} language={language} answer={answer}
      gradingMode={gradingMode} disabled={disabled} busy={busy || Boolean(submittingSubjective)} onChange={update}
      onSubmitObjective={onSubmitObjective} onSubmitSubjective={onSubmitSubjective} onSaveDraft={onSaveDraft} />
    : q.type === 'MULTIPLE_CHOICE' ? q.options?.map((option, index) => {
      const key = String.fromCharCode(65 + index);
      return <Button key={key} variant="outline" disabled={locked} aria-pressed={answer === key}
        className={`h-auto min-h-10 justify-start whitespace-normal px-3 py-2 text-left ${answer === key ? 'border-tone-amber-500 bg-wash-amber-500o15' : ''}`}
        onClick={() => update(key)}><span className="mr-2 font-medium">{key}.</span>{option}</Button>;
    }) : q.type === 'FILL_IN_BLANK' ? <label className="flex flex-col gap-2 text-sm">你的答案
      <input value={answer} onChange={event => update(event.target.value)} disabled={locked}
        className="rounded-md border border-line-soft bg-paper-soft px-3 py-2" />
    </label> : q.type === 'SENTENCE_REORDER' ? <>
      <p className="min-h-10 text-sm">{answer || '选择词块组成句子'}</p>
      <div className="flex flex-wrap gap-2">{chunks.map((chunk, index) => <Button key={index} variant="outline"
        disabled={locked} aria-pressed={picked.includes(index)} onClick={() => {
          const next = picked.includes(index) ? picked.filter(value => value !== index) : [...picked, index];
          setPicked(next); update(next.map(value => chunks[value]).join(' '));
        }}>{chunk}</Button>)}</div>
    </> : <label className="flex flex-col gap-2 text-sm">{q.type === 'TRANSLATION' ? '你的译文' : '你的作文'}
      <textarea value={answer} onChange={event => update(event.target.value)} disabled={locked || submittingSubjective}
        onBlur={() => answer.trim() && onSaveDraft(answer)} rows={4}
        className="rounded-md border border-line-soft bg-paper-soft px-3 py-2" />
    </label>}
    {objective && <Button size="sm" className="w-fit" disabled={!answer.trim() || locked} onClick={() => onSubmitObjective(answer)}>
      {busy ? '正在提交…' : '提交答案'}</Button>}
    {!objective && q.type !== 'LISTENING_DICTATION' && gradingMode === 'AI_IMMEDIATE' && onSubmitSubjective &&
      <Button size="sm" className="w-fit" disabled={!answer.trim() || locked || submittingSubjective} onClick={() => onSubmitSubjective(answer)}>
        {submittingSubjective ? '批改中…' : '提交并批改'}</Button>}
  </div>;
}
