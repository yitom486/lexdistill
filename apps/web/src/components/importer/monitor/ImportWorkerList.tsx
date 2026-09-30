import type { ImportEvent } from '@study-studio/document-model';
import { ImportEventDetail } from './ImportEventDetail.js';

export function ImportWorkerList({ events }: { events: ImportEvent[] }) {
  const ids = [...new Set(events.flatMap(event => event.sessionId ? [event.sessionId] : []))];
  return <section aria-label="Agent 会话" className="space-y-2">
    <h3 className="font-semibold">Agent 会话与当前绑定</h3>
    {ids.map(id => {
      const records = events.filter(event => event.sessionId === id);
      const assignment = records.filter(event => event.name === 'bound' || event.name === 'unbound').at(-1);
      const opened = records.find(event => event.name === 'opened');
      const closed = records.some(event => event.name === 'closed');
      return <div key={id} className="space-y-2 rounded-xl border border-line-soft p-2">
        <p className="break-all">{id} · {closed ? '已关闭' : assignment?.name === 'bound' ? `正在处理 ${assignment.nodeId}` : '未绑定任务'} · 最近活动 {records.at(-1)?.occurredAt}</p>
        <p className="break-all text-ink-muted">线程 {records.find(event => event.threadId)?.threadId ?? '引擎未提供'}</p>
        {opened && <ImportEventDetail event={opened} />}
      </div>;
    })}
  </section>;
}
