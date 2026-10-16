import { useRef } from 'react';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
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
  // 同步取消锁：与 disabled 双重保护同 tick 连击（observer pending 翻转有时序差）
  const cancellingRef = useRef(false);
  const running = runState.data?.running ?? false;
  const snapshot = task.data;
  const paperCount = snapshot?.papers.length ?? 0;
  const last = runState.data?.last as { status?: string; code?: string } | null | undefined;
  const failedCode = last?.status === 'FAILED' && typeof last.code === 'string' ? last.code : null;

  return (
    <div className="surface-card space-y-3 rounded-xl p-4" aria-label="任务状态">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={statusVariant(snapshot?.status === 'CANCELLED' ? 'CANCELLED' : failedCode ? 'FAILED' : snapshot?.status ?? '')}>{snapshot?.status === 'CANCELLED' ? '已取消' : failedCode ? '出题失败' : task.isError && !snapshot ? '读取失败' : statusText(snapshot, running)}</Badge>
        {snapshot && <span className="text-xs text-ink-muted">{snapshot.config.language} · {snapshot.config.targetLevel} · 已出 {snapshot.usage.usedQuestions} 题</span>}
      </div>
      {(running || snapshot?.status === 'ACTIVE') && <p role="status" className="text-xs text-ink-muted">{runState.isError ? '暂时无法读取运行状态' : runState.isPending ? '正在读取运行状态…' : running ? '正在出题' : '等待启动'} · 已生成 {paperCount} 份试卷</p>}
      {runState.isError && <Button variant="outline" size="sm" onClick={() => void runState.refetch()}>重试读取运行状态</Button>}
      {failedCode && <p role="alert" className="text-xs text-ink-rose-600">后台出题失败（{failedCode}），可取消后重新开始。</p>}
      {task.isError && <p role="alert" className="text-xs text-ink-rose-600">{(task.error as Error).message}</p>}
      {task.isError && <Button variant="outline" size="sm" onClick={() => void task.refetch()}>重试读取任务</Button>}
      {(snapshot?.status === 'ACTIVE' || running) && (
        <Button
          variant="outline"
          onClick={() => {
            if (cancellingRef.current || cancel.isPending) return;
            cancellingRef.current = true;
            cancel.mutate(taskId, { onSettled: () => { cancellingRef.current = false; } });
          }}
          disabled={cancel.isPending}
          aria-label="取消任务"
        >
          {cancel.isPending ? '取消中…' : '取消任务'}
        </Button>
      )}
      {cancel.isError && <p role="alert" className="text-xs text-ink-rose-600">{(cancel.error as Error).message}</p>}
    </div>
  );
}
