import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '../ui/button.js';
import { ObjectiveQuizQuestion } from './ObjectiveQuizQuestion.js';
import type { QuizQuestionItem } from '../../models/learning.js';
import type { AiTutorContext } from '../AiTutorDrawer.js';

export function QuizRound({ questions, language, onOpenTutor }: { questions: QuizQuestionItem[]; language: 'en' | 'ja' | 'ko'; onOpenTutor: (context: AiTutorContext) => void }) {
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [complete, setComplete] = useState(false);
  const [round, setRound] = useState(0);
  const question = questions[index];
  if (complete) return <section className="space-y-3 py-8 text-center" role="status">
    <h3 className="text-lg font-semibold">本轮练习已完成</h3>
    <p className="text-sm text-ink-ghost">答对 {score} / {questions.length} 题</p>
    <Button variant="outline" onClick={() => { setIndex(0); setScore(0); setComplete(false); setRound(value => value + 1); }}><RotateCcw className="h-4 w-4" />再练一轮</Button>
  </section>;
  return question ? <ObjectiveQuizQuestion key={`${round}:${question.id}:${index}`} question={question} language={language}
    position={index + 1} total={questions.length} onOpenTutor={onOpenTutor}
    onRecorded={correct => setScore(value => value + Number(correct))}
    onNext={() => index + 1 < questions.length ? setIndex(index + 1) : setComplete(true)} /> : null;
}
