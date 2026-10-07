import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { Progress } from '../ui/progress.js';
import { useCancelGenerationTaskMutation, useGenerationRunStateQuery, useGenerationTaskQuery } from '../../queries/generation.js';

function statusVariant(status: string): 'amber' | 'emerald' | 'secondary' | 'destructive' {
  if (status === 'COMPLETED') return 'emerald';
  if (status === 'CANCELLED') return 'secondary';
  if (status === 'FAILED') return 'destructive';
  return 'amber';
}

function statusText(task: { status: string; isExpired: boolean } | undefined, running: boolean): string {
  if (!task) return '加载中';
  if (task.status === 'COMPLETED') return '已完成';
  if (task.status === 'CANCELLED') return '已取消';
  if (task.isExpired) return '已过期';
  return running ? '出题中' : '等待启动';
}

/**
 * 任务状态卡：快照 + 后台运行态（均轮询），取消、过期与错误原文展示。
 */
export function TaskStatusCard({ userId, taskId }: { userId: string; taskId: string }) {
  const task = useGenerationTaskQuery(userId, taskId);
  const runState = useGenerationRunStateQuery(userId, taskId);
  const cancel = useCancelGenerationTaskMutation(userId);
  const running = runState.data?.running ?? false;
  const snapshot = task.data;
  const paperCount = snapshot?.papers.length ?? 0;
  const last = runState.data?.last as { status?: string; code?: string } | null | undefined;
  const failedCode = typeof last?.code === 'string' ? last.code : null;

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-4" aria-label="任务状态">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={statusVariant(failedCode ? 'FAILED' : snapshot?.status ?? '')}>{statusText(snapshot, running)}</Badge>
        {snapshot && <span className="text-xs text-ink-muted">{snapshot.config.language} · {snapshot.config.targetLevel} · 已出 {snapshot.usage.usedQuestions} 题</span>}
      </div>
      {(running || snapshot?.status === 'ACTIVE') && <Progress value={paperCount > 0 ? 90 : 30} aria-label="出题进度" />}
      {failedCode && <p role="alert" className="text-xs text-ink-rose-600">后台出题失败（{failedCode}），可取消后重新开始。</p>}
      {task.isError && <p role="alert" className="text-xs text-ink-rose-600">{(task.error as Error).message}</p>}
      {(snapshot?.status === 'ACTIVE' || running) && (
        <Button variant="outline" onClick={() => cancel.mutate(taskId)} disabled={cancel.isPending} aria-label="取消任务">
          {cancel.isPending ? '取消中…' : '取消任务'}
        </Button>
      )}
      {cancel.isError && <p role="alert" className="text-xs text-ink-rose-600">{(cancel.error as Error).message}</p>}
    </div>
  );
}
