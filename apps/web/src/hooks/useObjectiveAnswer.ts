import { useRef, useState } from 'react';
import { generateId } from '@study-studio/shared';
import { toast } from 'sonner';
import type { ObjectiveAnswerResult } from '@study-studio/protocol';
import { useSubmitQuizMutation } from '../queries/useAgentMutations.js';

export function useObjectiveAnswer(questionId: string, language: 'en' | 'ja' | 'ko', onRecorded?: (correct: boolean) => void) {
  const mutation = useSubmitQuizMutation();
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<ObjectiveAnswerResult | null>(null);
  const submission = useRef({ id: generateId('answer'), startedAt: Date.now(), answer: '' });
  const pending = useRef(false);
  const submit = async () => {
    if (!answer.trim() || pending.current || result) return;
    pending.current = true;
    if (submission.current.answer && submission.current.answer !== answer.trim()) submission.current.id = generateId('answer');
    submission.current.answer = answer.trim();
    try {
      const saved = await mutation.mutateAsync({ submissionId: submission.current.id, questionId, language,
        userAnswer: answer.trim(), timeSpentMs: Math.max(0, Date.now() - submission.current.startedAt) });
      setResult(saved);
      onRecorded?.(saved.isCorrect);
      toast.success(saved.isCorrect ? '回答正确，学习记录已保存。' : '作答已保存，错题已记录。');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败，请重试。');
    } finally { pending.current = false; }
  };
  return { answer, setAnswer, result, submit, isPending: mutation.isPending };
}
