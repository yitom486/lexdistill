import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { BankSubmissionRecord } from '@study-studio/protocol';
import { Button } from '../ui/button.js';
import { BankQuestionCard } from './BankQuestionCard.js';
import { QUERY_KEYS } from '../../queries/query-keys.js';
import type { GenerationReviewPaper, GenerationStudentPaper } from '../../queries/generation.js';
import { useBankSubmissionsQuery, useGenerationPaperQuery } from '../../queries/generation.js';

/**
 * 试卷视图：作答态学生卷，复盘态按后端资格逐题释放；作答保留以后端为准。
 */
export function BankPaperView({ userId, taskId, paperId }: { userId: string; taskId: string; paperId: string }) {
  const [review, setReview] = useState(false);
  const queryClient = useQueryClient();
  const paper = useGenerationPaperQuery(userId, taskId, paperId, review);
  const submissions = useBankSubmissionsQuery(userId, taskId, paperId);
  const data = paper.data as GenerationStudentPaper | GenerationReviewPaper | undefined;
  const byQuestion = useMemo(() => {
    const grouped = new Map<string, BankSubmissionRecord[]>();
    for (const submission of submissions.data ?? []) {
      const list = grouped.get(submission.questionId) ?? [];
      list.push(submission);
      grouped.set(submission.questionId, list);
    }
    return grouped;
  }, [submissions.data]);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.GENERATION_PAPER, userId, taskId, paperId] });
    void queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.GENERATION_SUBMISSIONS, userId, taskId, paperId] });
  };

  if (paper.isPending) return <p className="text-xs text-ink-muted">试卷加载中…</p>;
  if (paper.isError) return <p role="alert" className="text-xs text-ink-rose-600">{(paper.error as Error).message}</p>;
  if (!data) return null;
  const isReview = review && 'items' in data && data.items.length > 0 && typeof (data.items[0] as { reviewed?: unknown }).reviewed === 'boolean';
  const itemCount = 'items' in data && Array.isArray((data as { items?: unknown }).items)
    ? ((data as { items?: unknown }).items as unknown[]).length
    : 0;

  return (
    <div className="space-y-4">
      <div className="surface-card rounded-2xl p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="font-mono text-[10px] tracking-wider uppercase text-ink-faint-soft">
              语言能力模拟卷 · 共 {itemCount} 题
            </p>
            <h3 className="text-base font-serif font-bold text-ink tracking-tight mt-0.5">{data.title}</h3>
          </div>
          <Button variant="outline" size="sm" onClick={() => setReview(r => !r)} aria-label="切换复盘">
            {review ? '返回作答' : '查看复盘'}
          </Button>
        </div>
      </div>
      {submissions.isError && <p role="alert" className="text-xs text-ink-rose-600">{(submissions.error as Error).message}</p>}
      {isReview
        ? (data as GenerationReviewPaper).items.map((entry, index) => {
          const own = byQuestion.get(entry.id) ?? [];
          if (!entry.reviewed) {
            const question = entry.question as GenerationStudentPaper['items'][number];
            return <BankQuestionCard key={entry.id} userId={userId} taskId={taskId} paperId={paperId}
              item={question} index={index} reviewed={false} reviewQuestion={null} submissions={own} onSettled={refresh} />;
          }
          const full = entry.question as Record<string, unknown>;
          const fallback = full as unknown as GenerationStudentPaper['items'][number];
          return <BankQuestionCard key={entry.id} userId={userId} taskId={taskId} paperId={paperId}
            item={fallback} index={index} reviewed reviewQuestion={full} submissions={own} onSettled={refresh} />;
        })
        : (data as GenerationStudentPaper).items.map((item, index) => (
          <BankQuestionCard key={item.id} userId={userId} taskId={taskId} paperId={paperId}
            item={item} index={index} reviewed={false} reviewQuestion={null} submissions={byQuestion.get(item.id) ?? []} onSettled={refresh} />
        ))}
    </div>
  );
}
