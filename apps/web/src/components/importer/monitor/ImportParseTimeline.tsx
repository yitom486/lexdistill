import type { ContentDirectoryNode, ImportEvent } from '@study-studio/document-model';
import { ImportEventDetail } from './ImportEventDetail.js';

export const parseEventLabels: Record<string, string> = {
  parse_submitted: '解析任务已提交', parse_uploaded: '章节文件已上传', parse_progress: '解析进度',
  parse_downloading: '正在下载解析结果', parse_completed: '解析结果已取得', parse_resumed: '继续已有解析任务',
  parse_failed: '解析失败', parse_retry: '准备重试解析', ready: '章节材料已就绪',
};
export function ImportParseTimeline({ events, directory }: { events: ImportEvent[]; directory: readonly ContentDirectoryNode[] }) {
  const groups = new Map<string, ImportEvent[]>();
  for (const event of events) if (event.category === 'text') groups.set(event.nodeId ?? '', [...groups.get(event.nodeId ?? '') ?? [], event]);
  return <section className="space-y-2"><h3 className="font-semibold">章节解析任务</h3>
    {[...groups].map(([id, items]) => { const last = items.at(-1)!; return <details key={id} open={!['ready', 'parse_failed'].includes(last.name) || undefined} className="rounded-xl border border-line p-3" data-testid="parse-timeline">
      <summary className="cursor-pointer">{directory.find(node => node.id === id)?.title ?? id} · {parseEventLabels[last.name] ?? last.name} · {items.length} 条记录</summary>
      <div className="mt-2 space-y-2">{items.map(event => <ImportEventDetail key={event.sequence} event={event} expanded={!['ready', 'parse_failed'].includes(last.name) && event.sequence === last.sequence} />)}</div>
    </details>; })}
    {!groups.size && <p className="text-ink-muted">本次暂无章节解析记录</p>}
  </section>;
}
