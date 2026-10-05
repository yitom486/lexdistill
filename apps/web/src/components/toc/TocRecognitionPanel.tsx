import { useState } from 'react';
import { Sparkles, AlertCircle, Pencil } from 'lucide-react';
import { Button } from '../ui/button.js';
import { TextbookModelSettings } from '../importer/TextbookModelSettings.js';
import { ImportOptions } from '../importer/ImportOptions.js';
import { TocDirectoryEntries } from './TocDirectoryEntries.js';
import { useTocRecognition, type TocRecognitionPanelProps } from './useTocRecognition.js';


export function TocRecognitionPanel(props: TocRecognitionPanelProps) {
  const flow = useTocRecognition(props);
  const [editing, setEditing] = useState(false);
  const pending = flow.extractLlm.isPending || Boolean(props.confirmPending);
  return <div className="space-y-4 text-sm text-ink">
    {props.existingDocInfo && <p className="text-ink-muted">已载入《{props.existingDocInfo.title}》的目录，共 {props.existingDocInfo.lessonCount} 课。</p>}
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line-soft bg-paper-soft p-5">
      <div><h3 className="font-serif text-lg font-semibold">{flow.scanned ? '核对章节结构' : '识别教材目录'}</h3>
        <p className="mt-1 text-xs leading-5 text-ink-muted">{flow.start && flow.end ? `已选 PDF 第 ${flow.start}–${flow.end} 页 · ${flow.effectiveTocReviewModel === '__default__' ? '跟随本机模型' : flow.effectiveTocReviewModel}` : '未指定范围时，优先按书中书签定位目录页；没有书签才读前 30 页。'}</p>
      </div>
      <Button disabled={!flow.hasSource || pending} onClick={flow.handleLlmExtractToc}><Sparkles className="h-4 w-4" />{flow.extractLlm.isPending ? '正在识别目录…' : '识别目录'}</Button>
    </div>
    <ImportOptions title="目录识别设置" summary="调整页码范围或更换模型">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><p>目录所在 PDF 页码（可留空）</p><div className="flex items-center gap-2">
          <input aria-label="目录起始页" inputMode="numeric" value={flow.start} disabled={pending} onChange={event => { flow.setStart(event.target.value); flow.clearScan(); }} placeholder="起始页" className="w-24 rounded-lg border border-line bg-surface p-2 text-ink" />
          <span>–</span><input aria-label="目录结束页" inputMode="numeric" value={flow.end} disabled={pending} onChange={event => { flow.setEnd(event.target.value); flow.clearScan(); }} placeholder="结束页" className="w-24 rounded-lg border border-line bg-surface p-2 text-ink" />
        </div></div>
        <TextbookModelSettings purpose="目录识别" model={flow.effectiveTocReviewModel === '__default__' ? '' : flow.effectiveTocReviewModel} effort={flow.tocReviewEffort} onModel={flow.setTocReviewModel} onEffort={flow.setTocReviewEffort} pending={pending} />
      </div>
      <Button size="sm" variant="outline" disabled={pending} onClick={flow.useDefaultRange}>使用前 30 页</Button>
    </ImportOptions>
    {flow.message && <p role="alert" className="flex items-start gap-2 rounded-xl border border-line-accent bg-wash-amber-500o10 p-4 text-sm"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{flow.message}</p>}
    {flow.scanned && <section className="space-y-4">
      <div className="flex items-center justify-between gap-3"><p>共 {flow.entries.length} 条目录 · {flow.entries.filter(entry => entry.level === 1).length} 个一级章节</p><Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(!editing)}><Pencil className="h-4 w-4" />{editing ? '完成编辑' : '编辑目录'}</Button></div>
      <TocDirectoryEntries entries={flow.entries} editing={editing} pending={Boolean(pending)} onUpdate={flow.updateEntry} onLevel={flow.changeLevel} onRemove={flow.removeEntry} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => { flow.addEntry(); setEditing(true); }}>＋ 手动添加课次条目</Button>
        <Button disabled={!flow.entries.length || flow.confirmed || pending} onClick={() => { void flow.confirm(); }}>{props.confirmPending ? '正在保存目录…' : flow.confirmed ? `已核对 ${flow.entries.length} 条目录` : '确认目录草稿'}</Button>
      </div>
    </section>}
  </div>;
}
