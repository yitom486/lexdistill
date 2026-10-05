import type { ImportEvent } from '@study-studio/document-model';

export interface WorkerLiveInfo {
  sessionId: string;
  chapterId: string | null;
  state: 'running' | 'stalled' | 'done' | 'failed';
  lastActivityAt: string | null;
  toolCalls: number;
  staged: number;
}

function eventTime(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** 按 Worker 聚合实时状态：纯展示推导，不改事件语义。 */
export function summarizeWorkers(events: readonly ImportEvent[], stallMs: number, now = Date.now()): WorkerLiveInfo[] {
  const bySession = new Map<string, ImportEvent[]>();
  for (const event of events) {
    if (!event.sessionId) continue;
    const group = bySession.get(event.sessionId) ?? [];
    group.push(event);
    bySession.set(event.sessionId, group);
  }
  const failedChapters = new Set(
    events.filter(event => event.category === 'task' && event.name === 'failed' && event.nodeId).map(event => event.nodeId as string),
  );
  const committedChapters = new Set(
    events.filter(event => event.name === 'committed' && event.nodeId).map(event => event.nodeId as string),
  );
  return [...bySession.entries()].map(([sessionId, group]) => {
    const chapterId = group.filter(event => event.nodeId).at(-1)?.nodeId ?? null;
    const lastActivityAt = group.map(event => event.occurredAt).sort().at(-1) ?? null;
    const toolCalls = group.filter(event => event.name === 'requested').length;
    const staged = group.filter(event => event.name === 'content_staged').length;
    const unbound = group.some(event => event.name === 'unbound');
    let state: WorkerLiveInfo['state'] = 'running';
    if (chapterId && failedChapters.has(chapterId) && !committedChapters.has(chapterId)) state = 'failed';
    else if (unbound) state = 'done';
    else if (lastActivityAt && now - eventTime(lastActivityAt) > stallMs) state = 'stalled';
    return { sessionId, chapterId, state, lastActivityAt, toolCalls, staged };
  });
}

const STATE_TEXT: Record<WorkerLiveInfo['state'], string> = {
  running: '运行中',
  stalled: '长时间无活动',
  done: '本轮结束',
  failed: '本章失败',
};

export function WorkerLiveStrip({ events, stallMs }: { events: readonly ImportEvent[]; stallMs: number }) {
  const workers = summarizeWorkers(events, stallMs);
  if (!workers.length) return null;
  return (
    <section aria-label="各会话实时状态" data-testid="worker-live" className="space-y-1 rounded-xl border border-line-soft p-2">
      {workers.map(worker => (
        <p key={worker.sessionId} className="break-all text-ink-muted">
          会话 {worker.sessionId} · {worker.chapterId ? `章节 ${worker.chapterId}` : '等待分配'} · {STATE_TEXT[worker.state]}
          {worker.toolCalls > 0 && <> · 工具调用 {worker.toolCalls}（已暂存 {worker.staged}）</>}
        </p>
      ))}
    </section>
  );
}
