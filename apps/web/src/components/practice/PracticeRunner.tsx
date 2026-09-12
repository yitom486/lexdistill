import React from 'react';
import { CheckCircle2, XCircle, Loader2, Send } from 'lucide-react';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { Progress } from '../ui/progress.js';
import { QuestionRenderer } from './QuestionRenderer.js';
import { usePracticeRunner, type PracticeRunnerItem } from '../../hooks/usePracticeRunner.js';
import type { PracticeItemAttempt, GeneratedQuestion } from '@study-studio/protocol';

export type { PracticeRunnerItem };

/** P5：通用练习运行器。按题型渲染；客观题即时判定，主观题草稿暂存+批量评测+批量提交；断点恢复。 */

interface PracticeRunnerProps {
  runId: string;
  userId: string;
  items: PracticeRunnerItem[];
  attempts: PracticeItemAttempt[];
  language: 'en' | 'ja' | 'ko';
  onCompleted?: (() => void) | undefined;
}

export function PracticeRunner({ runId, userId, items, attempts, language, onCompleted }: PracticeRunnerProps) {
  const {
    viewStates: states, doneCount, progress, canFinish, hasBatchSubjects, isBatchSubmitting,
    itemBusy, setDraft, handleObjective, handleDraft, handleImmediate, handleBatch, handleFinalize, mutations,
  } = usePracticeRunner({ userId, runId, items, attempts, language });
  const { finalizeRun } = mutations;
  const setItem = (itemId: string, patch: { userAnswer: string }) => setDraft(itemId, patch.userAnswer);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Badge variant="secondary">{doneCount}/{items.length} 已完成</Badge>
        <Progress value={progress} className="w-48" />
      </div>
      <div className="flex flex-col gap-6">
        {items.map((it) => {
          const s = states[it.itemId] ?? { status: 'PENDING' as const, userAnswer: '' };
          return (
            <div key={it.itemId} className="rounded-lg border border-line-slate-200-slate-700 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs text-ink-slate-500">{it.question.type}</span>
                {s.status === 'GRADED' ? (
                  s.isCorrect ? (
                    <Badge className="bg-tint-emerald-100 text-tone-emerald-700"><CheckCircle2 className="mr-1 h-3 w-3" />正确</Badge>
                  ) : (
                    <Badge className="bg-tint-rose-100 text-ink-rose-700"><XCircle className="mr-1 h-3 w-3" />需复习</Badge>
                  )
                ) : s.status === 'SUBMITTED' ? (
                  <Badge variant="secondary">等待批改</Badge>
                ) : s.status === 'DRAFT' ? (
                  <Badge variant="outline">草稿</Badge>
                ) : null}
              </div>
              <div className="mb-1 font-medium">{it.question.prompt}</div>
              {it.question.type !== 'LISTENING_DICTATION' && it.question.content && (
                <div className="mb-3 whitespace-pre-wrap text-sm text-ink-slate-600-slate-300">
                  {it.question.content}
                </div>
              )}
              <QuestionRenderer
                question={it.question}
                userAnswer={s.userAnswer}
                language={language}
                gradingMode={it.gradingMode}
                onAnswerChange={(v) => setItem(it.itemId, { userAnswer: v })}
                onSubmitObjective={(a) => handleObjective(it, a)}
                onSubmitSubjective={(a) => handleImmediate(it, a)}
                onSaveDraft={(a) => handleDraft(it, a)}
                disabled={s.status === 'GRADED' || (s.status === 'SUBMITTED' && !s.submitting)}
                busy={itemBusy(it.itemId)}
                submittingSubjective={itemBusy(it.itemId)}
              />
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-end gap-2 pt-2">
        {hasBatchSubjects && (
          <Button variant="outline" onClick={handleBatch} disabled={isBatchSubmitting}>
            {isBatchSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            批量提交主观题
          </Button>
        )}
        <Button onClick={() => handleFinalize(onCompleted)} disabled={!canFinish || finalizeRun.isPending}>
          {finalizeRun.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
          完成练习
        </Button>
      </div>
    </div>
  );
}
