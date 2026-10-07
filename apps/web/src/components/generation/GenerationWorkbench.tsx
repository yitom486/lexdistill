import { useState } from 'react';
import { Button } from '../ui/button.js';
import { TaskSetupPanel } from './TaskSetupPanel.js';
import { TaskStatusCard } from './TaskStatusCard.js';
import { BankPaperView } from './BankPaperView.js';
import type { TrackLanguage } from '../../learning/learning-shell.js';
import { useGenerationTasksQuery, useGenerationTaskQuery } from '../../queries/generation.js';

/**
 * AI 出题工作台：任务列表重开 → 创建 → 后台运行 → 试卷作答 → 复盘。
 * 异步业务走 TanStack Query，偏好走既有 Zustand persist，无自建请求轮子。
 */
export function GenerationWorkbench({ userId, track }: { userId: string; track: TrackLanguage }) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const tasks = useGenerationTasksQuery(userId);
  const task = useGenerationTaskQuery(userId, selectedTaskId);
  const snapshot = task.data;
  const paperId = snapshot?.papers.length ? snapshot.papers[snapshot.papers.length - 1]!.paperId : null;

  return (
    <div className="space-y-4" aria-label="AI 出题">
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-ink">出题任务</h2>
        {tasks.isPending && <p className="text-xs text-ink-muted">任务列表加载中…</p>}
        {tasks.isError && <p role="alert" className="text-xs text-ink-rose-600">{(tasks.error as Error).message}</p>}
        {tasks.data && tasks.data.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {tasks.data.map(entry => (
              <li key={entry.taskId}>
                <Button variant={entry.taskId === selectedTaskId ? 'default' : 'outline'}
                  onClick={() => setSelectedTaskId(entry.taskId)}
                  aria-label={`打开任务 ${entry.targetLevel}`}>
                  {entry.targetLevel} · {entry.status}{entry.paperCount > 0 ? ` · ${entry.paperCount} 卷` : ''}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {!selectedTaskId && <TaskSetupPanel key={`${userId}:${track}`} userId={userId} track={track} onStarted={setSelectedTaskId} />}
      {selectedTaskId && (
        <div className="space-y-4">
          <TaskStatusCard userId={userId} taskId={selectedTaskId} />
          {task.isError && <p role="alert" className="text-xs text-ink-rose-600">{(task.error as Error).message}</p>}
          {paperId && snapshot?.status === 'COMPLETED' && (
            <BankPaperView key={`${userId}:${paperId}`} userId={userId} taskId={selectedTaskId} paperId={paperId} />
          )}
          {selectedTaskId && (
            <Button variant="outline" onClick={() => setSelectedTaskId(null)} aria-label="新建任务">新建任务</Button>
          )}
        </div>
      )}
    </div>
  );
}
