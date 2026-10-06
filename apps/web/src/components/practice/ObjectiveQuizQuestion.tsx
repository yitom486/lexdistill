import React, { useState } from 'react';
import { ArrowRight, Bot, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { UnifiedTtsPlayer } from '../UnifiedTtsPlayer.js';
import { trackToSpeechLang } from '../../config/speech-language.js';
import { useObjectiveAnswer } from '../../hooks/useObjectiveAnswer.js';
import type { QuizQuestionItem } from '../../models/learning.js';
import type { AiTutorContext } from '../AiTutorDrawer.js';
import { ReadingPassagePanel } from './ReadingPassagePanel.js';

interface Props {
  question: QuizQuestionItem;
  language: 'en' | 'ja' | 'ko';
  position: number;
  total: number;
  onRecorded: (correct: boolean) => void;
  onNext: () => void;
  onOpenTutor: (context: AiTutorContext) => void;
}

export function ObjectiveQuizQuestion({ question: q, language, position, total, onRecorded, onNext, onOpenTutor }: Props) {
  const flow = useObjectiveAnswer(q.id, language, onRecorded);
  const [picked, setPicked] = useState<number[]>([]);
  const disabled = flow.isPending || Boolean(flow.result);
  return (
    <section className="space-y-5 border-t border-line-soft py-5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-ghost">
        <span>第 {position} / {total} 题 · {q.category}</span>
        <Badge variant="secondary">{q.type === 'CHOICE' ? '选择题' : q.type === 'REORDER' ? '连词成句' : '填空题'}</Badge>
      </div>
      <p className="text-sm text-ink-ghost">{q.prompt}</p>
      {q.reading && <ReadingPassagePanel reading={q.reading} />}
      <p className="whitespace-pre-wrap text-lg leading-relaxed text-ink">{q.content}</p>
      <UnifiedTtsPlayer variant="button" text={q.content} lang={trackToSpeechLang(language)} label="朗读题干" />
      {q.type === 'CHOICE' && <div className="grid gap-3 sm:grid-cols-2">
        {q.options?.map(option => <Button key={option.key} variant="outline" disabled={disabled} aria-pressed={flow.answer === option.key}
          onClick={() => flow.setAnswer(option.key)} className={`h-auto min-h-14 justify-start whitespace-normal p-3 text-left ${flow.answer === option.key ? 'border-tone-amber-500 bg-wash-amber-500o15' : ''}`}>
          <span className="mr-2 font-mono">{option.key}.</span>{option.text}
        </Button>)}
      </div>}
      {q.type === 'FILL_BLANK' && <label className="flex flex-col gap-2 text-sm">你的答案
        <input value={flow.answer} onChange={event => flow.setAnswer(event.target.value)} disabled={disabled}
          className="rounded-md border border-line-soft bg-paper-soft px-3 py-2" onKeyDown={event => event.key === 'Enter' && void flow.submit()} />
      </label>}
      {q.type === 'REORDER' && <div className="space-y-3">
        <p className="min-h-10 rounded-md border border-line-soft p-3">{flow.answer || '选择词块组成句子'}</p>
        <div className="flex flex-wrap gap-2">{q.chunks?.map((chunk, index) => <Button key={index} variant="outline" disabled={disabled}
          aria-pressed={picked.includes(index)} onClick={() => {
            const next = picked.includes(index) ? picked.filter(value => value !== index) : [...picked, index];
            setPicked(next); flow.setAnswer(next.map(value => q.chunks?.[value]).join(' '));
          }}>{chunk}</Button>)}</div>
      </div>}
      {flow.result ? <>
        <div role="status" className="space-y-2 rounded-md border border-line-soft p-4">
          <p className="flex items-center gap-2 font-medium">{flow.result.isCorrect ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            {flow.result.isCorrect ? '回答正确' : `标准答案：${flow.result.correctAnswer}`}</p>
          <p className="text-sm leading-relaxed text-ink-ghost">{flow.result.explanation}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onNext}>{position === total ? '完成本轮' : '下一题'}<ArrowRight className="h-4 w-4" /></Button>
          <Button variant="outline" onClick={() => onOpenTutor({ questionText: q.content, userAnswer: flow.answer,
            correctAnswer: flow.result!.correctAnswer, skillTag: q.category, explanation: flow.result!.explanation })}><Bot className="h-4 w-4" />询问导师</Button>
        </div>
      </> : <Button disabled={!flow.answer.trim() || flow.isPending} onClick={() => void flow.submit()}>{flow.isPending ? '正在保存…' : '提交答案'}</Button>}
    </section>
  );
}
