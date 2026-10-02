import { useEffect, useRef, useState } from 'react';
import type { ImportEvent, ContentDirectoryNode } from '@study-studio/document-model';
import { ImportEventDetail } from './ImportEventDetail.js';
import { ImportToolCall } from './ImportToolCall.js';

export function ImportInteraction({ events, title, current, directory = [] }: { events: ImportEvent[]; title: string; current: boolean; directory?: readonly ContentDirectoryNode[] }) {
  const [open, setOpen] = useState(current);
  const manuallyChanged = useRef(false);
  useEffect(() => { if (!manuallyChanged.current) setOpen(current); }, [current]);
  const input = events.find(event => event.category === 'model' && event.name === 'input');
  const calls = new Map<string, ImportEvent[]>();
  for (const event of events) if (event.callId) calls.set(event.callId, [...calls.get(event.callId) ?? [], event]);
  const ended = events.some(event => event.name === 'turn_ended');
  const saved = events.some(event => event.name === 'committed');
  const rejected = events.filter(event => event.name === 'rejected').length;
  const meta = events.find(event => event.sessionId);
  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)} className="rounded-xl border border-line p-3 text-xs" data-testid={current ? 'current-interaction' : 'history-interaction'}>
    <summary onClick={() => { manuallyChanged.current = true; }} className="cursor-pointer font-medium text-ink">{current ? '最近一轮交互' : '历史交互'} · {title} · {ended ? '已结束' : '进行中'}</summary>
    {open && <div className="mt-3 space-y-3">
      <p className="break-all">Agent {meta?.sessionId ?? '未记录'} · 线程 {events.find(event => event.threadId)?.threadId ?? '引擎未提供'}</p>
      <details><summary className="cursor-pointer text-ink-muted">系统绑定与本轮身份</summary>
        <p className="break-all">节点 {meta?.nodeId} · 系统尝试 {meta?.attemptId}</p>
        {events.filter(event => event.name === 'turn_started').map(event => <ImportEventDetail key={event.sequence} event={event} expanded />)}
      </details>
      {input && <ImportEventDetail event={input} expanded />}
      {saved && rejected > 0 && <p className="text-ink-muted">本轮曾拒绝 {rejected} 次提交，后续已修正并保存；此前失败调用默认折叠。</p>}
      {events.filter(event => event.category === 'model' && ['message', 'error', 'failed', 'approval_requested', 'runtime_retry'].includes(event.name)).map(event => <ImportEventDetail key={event.sequence} event={event} expanded={event.name !== 'message'} />)}
      {[...calls.entries()].map(([callId, records]) => <ImportToolCall key={callId} events={records} directory={directory} lessonSaved={saved} resolved={saved && records.some(event => event.name === 'rejected') && !records.some(event => event.name === 'committed')} />)}
      {events.filter(event => !event.callId && (event.category === 'validation' || event.category === 'storage' || event.name === 'retry')).map(event => <ImportEventDetail key={event.sequence} event={event} directory={directory} expanded={event.name === 'rejected' || event.name === 'commit_failed'} />)}
    </div>}
  </details>;
}
