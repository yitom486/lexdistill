import type { ImportEvent, ContentDirectoryNode } from '@lexdistill/document-model';
import { ImportInteraction } from './ImportInteraction.js';
import { ImportEventDetail } from './ImportEventDetail.js';

export function ImportModelProcess({ events, allEvents, directory, title }: { events: ImportEvent[]; allEvents: ImportEvent[]; directory: readonly ContentDirectoryNode[]; title: string }) {
  const attempts = new Map<string, ImportEvent[]>();
  for (const event of events) if (event.attemptId) attempts.set(event.attemptId, [...attempts.get(event.attemptId) ?? [], event]);
  const groups = [...attempts.values()].filter(items => items.some(event => event.category === 'model'));
  const sessionId = groups.at(-1)?.find(event => event.sessionId)?.sessionId;
  const opened = allEvents.find(event => event.sessionId === sessionId && event.name === 'opened');
  return <div className="space-y-3" data-testid="model-process">
    <p className="text-ink-muted">不同 Worker 使用独立线程，同一 Worker 连续处理章节并保留历史。当前章节 PDF 和工具写入归属由系统逐轮绑定，模型只整理本轮文件。</p>
    {opened && <ImportEventDetail event={opened} />}
    {!groups.length && <p>本部分尚未开始模型交互；PDF 裁剪准备完成后才发送。</p>}
    {[...groups].reverse().map((items, index) => <ImportInteraction key={items[0]!.attemptId} events={items} directory={directory} title={title} current={index === 0} />)}
  </div>;
}
