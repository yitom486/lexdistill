import { useEffect, useRef, useState } from 'react';
import type { BankSubmissionRecord } from '@lexdistill/protocol';
import { Button } from '../ui/button.js';
import { useGradeBankSubjectiveMutation } from '../../queries/generation.js';

/**
 * 主观批改按钮：只发批改动作（用任务冻结模型），不发送分数或参考答案。
 * 保存不调用模型；失败保留答案并可重试。
 */
export function BankGradeButton({ userId, taskId, paperId, submission, onSettled }: {
  userId: string; taskId: string; paperId: string;
  submission: BankSubmissionRecord; onSettled: () => void;
}) {
  const grade = useGradeBankSubjectiveMutation(userId);
  const [error, setError] = useState<string | null>(null);
  // 同步批改锁：与 disabled 双重保护同 tick 连击
  const gradingRef = useRef(false);
  const mounted = useRef(false);
  const liveSubmission = useRef('');
  liveSubmission.current = submission.submissionId;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  if (submission.status === 'GRADED') {
    const percent = submission.score !== null ? Math.round(submission.score * 100) : null;
    return (
      <div role="status" className="space-y-1 text-xs leading-5 text-ink">
        <p>{submission.isCorrect ? '判对' : '判错'}{percent !== null ? `，得分 ${percent} 分。` : '。'}</p>
        {submission.grading && <p>反馈：{submission.grading.feedback}</p>}
      </div>
    );
  }

  const run = async () => {
    setError(null);
    if (grade.isPending || gradingRef.current) return;
    gradingRef.current = true;
    const submissionId = submission.submissionId;
    const isCurrent = () => mounted.current && submissionId === liveSubmission.current;
    try {
      await grade.mutateAsync({ taskId, paperId, submissionId: submission.submissionId });
    } catch (cause) {
      if (!isCurrent()) return;
      setError(cause instanceof Error ? cause.message : '批改失败');
    } finally {
      gradingRef.current = false;
      if (isCurrent()) {
        onSettled();
      }
    }
  };

  return (
    <div className="space-y-2">
      {submission.status === 'GRADING_FAILED' && (
        <p role="alert" className="text-xs leading-5 text-ink-rose-600">
          批改失败{submission.gradingError ? `（${submission.gradingError}）` : ''}，作答已保留，可重试批改。
        </p>
      )}
      <Button variant="outline" onClick={() => void run()} disabled={grade.isPending} aria-label="批改主观作答">
        {grade.isPending ? '批改中…' : submission.status === 'GRADING_FAILED' ? '重试批改' : '批改'}
      </Button>
      {error && <p role="alert" className="text-xs text-ink-rose-600">{error}</p>}
    </div>
  );
}
