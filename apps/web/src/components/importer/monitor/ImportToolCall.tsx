import type { ContentDirectoryNode, ImportEvent } from '@study-studio/document-model';
import { ImportEventDetail } from './ImportEventDetail.js';

/** 一个原生 call 的参数、校验和事务回执放在一起。 */
export function ImportToolCall({ events, directory }: { events: ImportEvent[]; directory: readonly ContentDirectoryNode[] }) {
  const committed = events.some(event => event.name === 'committed');
  const rejected = events.some(event => event.name === 'rejected');
  const proposal = events.find(event => event.name === 'requested') ?? events.find(event => event.name === 'proposal');
  const state = committed ? '事务已提交' : rejected ? '校验拒绝 / 查看修正反馈' : '等待回执';
  const details = events.filter(event => event !== proposal && event.name !== 'requested' && event.name !== 'proposal');
  return <section className="space-y-2 rounded-xl border border-line p-3" data-testid="model-tool-call">
    <h4 className="font-medium">原生工具调用 · {state}</h4>
    <p className="break-all text-ink-muted">原生调用 {events[0]?.callId ?? '未记录调用身份'}</p>
    {proposal && <ImportEventDetail event={proposal} expanded directory={directory} />}
    {details.filter(event => event.name === 'rejected' || event.name === 'result' || event.name === 'committed' || event.name === 'commit_failed').map(event => <ImportEventDetail key={event.sequence} event={event} expanded directory={directory} />)}
    <details><summary className="cursor-pointer">逐项校验与系统生成的内容</summary>
      <div className="mt-2 space-y-2">{details.filter(event => !['rejected', 'result', 'committed', 'commit_failed'].includes(event.name)).map(event => <ImportEventDetail key={event.sequence} event={event} directory={directory} />)}</div>
    </details>
  </section>;
}
