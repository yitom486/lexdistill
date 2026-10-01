import { useEffect, useState } from 'react';
import type { TextbookPipelineJobSnapshot } from '@study-studio/protocol';
import { useImportMonitorQuery, useSavedTextbookContent } from '../../../queries/textbook-import-monitor.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../ui/dialog.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs.js';
import { Button } from '../../ui/button.js';
import { ImportEventDetail } from './ImportEventDetail.js';
import { ImportModelProcess } from './ImportModelProcess.js';
import { useImportDirectory } from './useImportDirectory.js';
import { SavedContentResult } from './SavedContentResult.js';

interface Props { open: boolean; onOpenChange: (open: boolean) => void; userId: string; traceId: string; job?: TextbookPipelineJobSnapshot; nodeId?: string }
function MonitorContent({ open, userId, traceId, job, nodeId }: Omit<Props, 'onOpenChange'>) {
  const query = useImportMonitorQuery(userId, traceId, open);
  const [selected, setSelected] = useState<string | null | undefined>(nodeId);
  const [readSaved, setReadSaved] = useState(false);
  const [tab, setTab] = useState('model');
  const events = query.data?.events ?? [];
  const snapshot = useImportDirectory(userId, traceId, events, open);
  const directory = snapshot?.directory ?? [];
  const titles = new Map(directory.map(node => [node.id, node.title]));
  const order = new Map(directory.map((node, index) => [node.id, index]));
  const nodes = [...new Set(events.flatMap(event => event.nodeId ? [event.nodeId] : []))].sort((a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER));
  const latest = events.filter(event => event.category === 'model' && event.name === 'input').at(-1)?.nodeId;
  const initial = nodeId ?? job?.currentLessonId ?? latest ?? nodes[0];
  // 只初始化 UI 选择；记录刷新不得抢走用户正在核对的章节。
  useEffect(() => { if (selected === undefined && initial) setSelected(initial); }, [selected, initial]);
  const shown = events.filter(event => selected ? event.nodeId === selected : !event.nodeId && !!event.attemptId);
  const parseResult = shown.filter(event => event.category === 'text' && ['ready', 'failed'].includes(event.name)).at(-1);
  const documentId = job?.documentId ?? events.find(event => event.documentId)?.documentId ?? '';
  const saved = useSavedTextbookContent(userId, documentId, selected ?? '', open && readSaved && !!documentId && !!selected);
  const title = titles.get(selected ?? '') ?? selected ?? '目录识别';
  return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden text-xs">
    {job && <p>进度 {job.doneLessons}/{job.totalLessons} · 成功 {job.successfulLessons} · 失败 {job.failedLessons.length} · Agent 并发 {job.concurrency ?? '见启动配置'} · 模型 {job.model ?? '见会话记录'}</p>}
    {snapshot && <p className="text-ink-muted">目录 {directory.length} 项 · {snapshot.settings.parserBackend} · 解析并发 {snapshot.settings.parseConcurrency} · Agent 并发 {snapshot.settings.poolSize}</p>}
    <div className="flex items-center justify-between gap-2"><span className="truncate text-ink-muted" title={traceId}>本次记录：{traceId}</span><Button variant="outline" size="sm" onClick={() => { void query.refetch(); }}>刷新记录</Button></div>
    {query.isPending && <p>正在读取本次记录…</p>}
    {query.isError && <p role="alert">{query.error.message}</p>}
    {query.data?.warning && <p role="alert">{query.data.warning}</p>}
    {query.isSuccess && !events.length && <p>本次没有可回溯的交互记录。此前未捕获的提示词和参数无法补回。</p>}
    <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[12rem_minmax(0,1fr)]">
      {(!!nodes.length || events.some(event => !event.nodeId && event.category === 'model')) && <nav aria-label="本次导入章节" className="flex max-h-96 gap-2 overflow-auto md:max-h-none md:flex-col">
        {events.some(event => !event.nodeId && event.category === 'model') && <Button size="sm" variant={selected === null ? 'default' : 'outline'} aria-pressed={selected === null} onClick={() => { setSelected(null); setReadSaved(false); setTab('model'); }}>目录识别</Button>}
        {nodes.map(id => <Button key={id} size="sm" className="shrink-0 justify-start whitespace-normal text-left" variant={selected === id ? 'default' : 'outline'} aria-pressed={selected === id} onClick={() => { setSelected(id); setReadSaved(false); setTab('model'); }}>{titles.get(id) ?? id}</Button>)}
      </nav>}
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-col">
        <TabsList className="shrink-0"><TabsTrigger value="model">模型过程</TabsTrigger><TabsTrigger value="parse">解析结果</TabsTrigger><TabsTrigger value="saved">保存结果</TabsTrigger></TabsList>
        <TabsContent value="model" className="min-h-0 overflow-auto pt-3"><ImportModelProcess events={shown} allEvents={events} directory={directory} title={title} /></TabsContent>
        <TabsContent value="parse" className="min-h-0 overflow-auto pt-3">
          {parseResult ? <ImportEventDetail event={parseResult} expanded /> : <p>本部分暂无解析结果；解析过程事件不在这里展示。</p>}
        </TabsContent>
        <TabsContent value="saved" className="min-h-0 space-y-3 overflow-auto pt-3">
          {selected && documentId ? <>
            <Button size="sm" variant="outline" onClick={() => { setReadSaved(true); if (readSaved) void saved.refetch(); }}>查询数据库当前保存内容</Button>
            <p className="text-ink-muted">读取数据库当前版本；历史模型候选及提交回执在“模型过程”中查看。</p>
            {readSaved && (saved.isPending ? <p>正在查询数据库…</p> : saved.isError ? <p role="alert">{saved.error.message}</p> : saved.data && <SavedContentResult result={saved.data} />)}
          </> : <p>目录识别尚未绑定教材；保存后可核对数据库结果。</p>}
        </TabsContent>
      </Tabs>
    </div>
  </div>;
}
export function TextbookImportMonitor(props: Props) {
  return <Dialog open={props.open} onOpenChange={props.onOpenChange}>
    <DialogContent className="flex h-[85vh] max-h-[90vh] max-w-6xl flex-col overflow-hidden">
      <DialogHeader><DialogTitle>教材导入运行详情</DialogTitle><DialogDescription>选择章节查看实际模型输入、工具调用、校验与重试。仅显示本次导入，历史交互按需展开。</DialogDescription></DialogHeader>
      <MonitorContent key={props.traceId} {...props} />
    </DialogContent>
  </Dialog>;
}
