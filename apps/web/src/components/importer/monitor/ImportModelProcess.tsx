import type { ImportEvent, ContentDirectoryNode } from '@study-studio/document-model';
import { ImportInteraction } from './ImportInteraction.js';
import { ImportEventDetail } from './ImportEventDetail.js';

export function ImportModelProcess({ events, allEvents, directory, title }: { events: ImportEvent[]; allEvents: ImportEvent[]; directory: readonly ContentDirectoryNode[]; title: string }) {
  const attempts = new Map<string, ImportEvent[]>();
  for (const event of events) if (event.attemptId) attempts.set(event.attemptId, [...attempts.get(event.attemptId) ?? [], event]);
  const groups = [...attempts.values()].filter(items => items.some(event => event.category === 'model'));
  const sessionId = groups.at(-1)?.find(event => event.sessionId)?.sessionId;
  const opened = allEvents.find(event => event.sessionId === sessionId && event.name === 'opened');
  const previous = allEvents.filter(event => event.sessionId === sessionId && event.nodeId && event.nodeId !== events[0]?.nodeId && event.sequence < (groups[0]?.[0]?.sequence ?? 0));
  const previousGroups = new Map<string, ImportEvent[]>();
  for (const event of previous) if (event.attemptId) previousGroups.set(event.attemptId, [...previousGroups.get(event.attemptId) ?? [], event]);
  const titles = new Map(directory.map(node => [node.id, node.title]));
  return <div className="space-y-3" data-testid="model-process">
    <p className="text-ink-muted">不同 Worker 使用独立线程；本 Worker 会复用线程，先前章节与修正历史仍可能进入上下文。教材归属由系统绑定当前原生轮次。</p>
    {opened && <ImportEventDetail event={opened} />}
    {!groups.length && <p>本部分尚未开始模型交互；解析完成后才发送。</p>}
    {[...groups].reverse().map((items, index) => <ImportInteraction key={items[0]!.attemptId} events={items} directory={directory} title={title} current={index === 0} />)}
    {!!previousGroups.size && <details data-testid="worker-context-history"><summary className="cursor-pointer">同一线程之前的上下文 · {previousGroups.size} 轮</summary>
      <div className="mt-3 space-y-3">{[...previousGroups.values()].reverse().map(items => <ImportInteraction key={items[0]!.attemptId} events={items} directory={directory} title={titles.get(items[0]!.nodeId ?? '') ?? '此前章节'} current={false} />)}</div>
    </details>}
  </div>;
}
