import { useState } from 'react';
import type { ImportEvent } from '@study-studio/document-model';
import type { TextbookPipelineJobSnapshot } from '@study-studio/protocol';
import { useImportMonitorQuery, useSavedTextbookContent } from '../../../queries/textbook-import-monitor.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../ui/dialog.js';
import { Button } from '../../ui/button.js';
import { ImportInteraction } from './ImportInteraction.js';
import { ImportEventDetail } from './ImportEventDetail.js';
import { ImportWorkerList } from './ImportWorkerList.js';
import { useImportDirectory } from './useImportDirectory.js';
import { SavedContentResult } from './SavedContentResult.js';
import { ImportParseTimeline } from './ImportParseTimeline.js';

interface Props { open: boolean; onOpenChange: (open: boolean) => void; userId: string; traceId: string; job?: TextbookPipelineJobSnapshot; nodeId?: string }
export function TextbookImportMonitor({ open, onOpenChange, userId, traceId, job, nodeId }: Props) {
  const query = useImportMonitorQuery(userId, traceId, open);
  const [selected, setSelected] = useState<string | undefined>(nodeId);
  const [readSaved, setReadSaved] = useState(false);
  const events = query.data?.events ?? [];
  const snapshot = useImportDirectory(userId, traceId, events, open);
  const directory = snapshot?.directory ?? [];
  const titles = new Map(directory.map(node => [node.id, node.title]));
  const shown = events.filter(event => !selected || event.nodeId === selected || !event.nodeId);
  const groups = new Map<string, ImportEvent[]>();
  for (const event of shown) if (event.attemptId) groups.set(event.attemptId, [...groups.get(event.attemptId) ?? [], event]);
  const order = new Map(directory.map((node, index) => [node.id, index]));
  const nodes = [...new Set(events.flatMap(event => event.nodeId ? [event.nodeId] : []))].sort((a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER));
  const documentId = job?.documentId ?? events.find(event => event.documentId)?.documentId ?? '';
  const saved = useSavedTextbookContent(userId, documentId, selected ?? '', open && readSaved && !!documentId && !!selected);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[90vh] max-w-6xl flex-col overflow-hidden">
      <DialogHeader><DialogTitle>教材导入运行详情</DialogTitle><DialogDescription>仅显示本次导入。当前交互展开，已结束轮次折叠；内容详情按需读取。</DialogDescription></DialogHeader>
      <div className="space-y-3 overflow-auto text-xs">
        <p className="break-all text-ink-muted">本次记录：{traceId}</p>
        {job && <p>进度 {job.doneLessons}/{job.totalLessons} · 成功 {job.successfulLessons} · 失败 {job.failedLessons.length} · Agent 并发 {job.concurrency ?? '见启动配置'} · 模型 {job.model ?? '运行时默认，见会话记录'}</p>}
        {snapshot && <p>目录 {directory.length} 项 · 解析方式 {snapshot.settings.parserBackend} · 解析章节并发 {snapshot.settings.parseConcurrency} · Agent 并发 {snapshot.settings.poolSize} · 等待队列容量 {snapshot.settings.queueCapacity}</p>}
        <Button variant="outline" size="sm" onClick={() => { void query.refetch(); }}>刷新记录</Button>
        {query.isPending && <p>正在读取本次记录…</p>}
        {query.isError && <p role="alert">{query.error.message}</p>}
        {query.data?.warning && <p role="alert">{query.data.warning}</p>}
        {query.isSuccess && !events.length && <p>本次没有可回溯的交互记录。此前未捕获的提示词和参数无法补回。</p>}
        <ImportWorkerList events={events} />
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => { setSelected(undefined); setReadSaved(false); }}>本次全部部分</Button>
          {nodes.map(id => <Button key={id} size="sm" variant={selected === id ? 'default' : 'outline'} onClick={() => { setSelected(id); setReadSaved(false); }}>{titles.get(id) ?? (job?.currentLessonId === id ? job.currentLessonTitle ?? id : id)}</Button>)}
        </div>
        <ImportParseTimeline events={shown} directory={directory} />
        {shown.filter(event => !event.attemptId && event.category !== 'text').map(event => <ImportEventDetail key={event.sequence} event={event} />)}
        {[...groups.entries()].reverse().map(([id, items]) => { const node = items.find(event => event.nodeId)?.nodeId; return <ImportInteraction key={id} events={items} directory={directory} title={node ? titles.get(node) ?? node : '目录识别'} current={!items.some(event => event.name === 'turn_ended')} />; })}
        {selected && documentId && <section className="space-y-2 rounded-xl border border-line p-3">
          <Button size="sm" variant="outline" onClick={() => { setReadSaved(true); if (readSaved) void saved.refetch(); }}>查询数据库当前保存内容</Button>
          <p className="text-ink-muted">此处读取当前版本，历史工具候选和提交回执请在对应交互中核对。</p>
          {readSaved && (saved.isPending ? <p>正在查询数据库…</p> : saved.isError ? <p role="alert">{saved.error.message}</p> : saved.data && <SavedContentResult result={saved.data} />)}
        </section>}
      </div>
    </DialogContent>
  </Dialog>;
}
