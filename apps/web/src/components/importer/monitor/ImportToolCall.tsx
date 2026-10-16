import type { ContentDirectoryNode, ImportEvent } from '@lexdistill/document-model';
import { useEffect, useRef, useState } from 'react';
import { ImportEventDetail } from './ImportEventDetail.js';

/** 一个原生 call 的参数、校验和事务回执放在一起。 */
export function ImportToolCall({ events, directory, resolved = false, lessonSaved = false }: { events: ImportEvent[]; directory: readonly ContentDirectoryNode[]; resolved?: boolean; lessonSaved?: boolean }) {
  const [open, setOpen] = useState(false);
  const manuallyChanged = useRef(false);
  useEffect(() => { if (!manuallyChanged.current && resolved) setOpen(false); }, [resolved]);
  const committed = events.some(event => event.name === 'committed');
  const staged = events.some(event => event.name === 'content_staged');
  const rejected = events.some(event => event.name === 'rejected');
  const proposal = events.find(event => event.name === 'requested') ?? events.find(event => event.name === 'proposal');
  const viewed = events.some(event => event.name === 'content_view');
  const state = committed ? '事务已提交' : rejected ? '校验拒绝 / 查看修正反馈' : staged ? lessonSaved ? '暂存内容已随整课保存' : '已暂存，等待整课提交' : viewed ? '已查询本课内容' : '等待回执';
  const details = events.filter(event => event !== proposal && event.name !== 'requested' && event.name !== 'proposal');
  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)} className="space-y-2 rounded-xl border border-line p-3" data-testid="model-tool-call">
    <summary onClick={() => { manuallyChanged.current = true; }} className="cursor-pointer font-medium">原生工具调用 · {resolved ? '此前拒绝，后续已修正保存' : state}</summary>
    {open && <div className="space-y-2">
    <p className="break-all text-ink-muted">原生调用 {events[0]?.callId ?? '未记录调用身份'}</p>
    {proposal && <ImportEventDetail event={proposal} expanded directory={directory} />}
    {details.filter(event => event.name === 'rejected' || event.name === 'repair_limit' || event.name === 'result' || event.name === 'content_staged' || event.name === 'committed' || event.name === 'commit_failed').map(event => <ImportEventDetail key={event.sequence} event={event} expanded={!resolved} directory={directory} />)}
    <details><summary className="cursor-pointer">逐项校验与系统生成的内容</summary>
      <div className="mt-2 space-y-2">{details.filter(event => !['rejected', 'repair_limit', 'result', 'content_staged', 'committed', 'commit_failed'].includes(event.name)).map(event => <ImportEventDetail key={event.sequence} event={event} directory={directory} />)}</div>
    </details>
    </div>}
  </details>;
}
