import { ArrowRight, BookOpen, FolderOpen } from 'lucide-react';
import { Button } from '../ui/button.js';
import { ImportOptions } from './ImportOptions.js';
import { TextbookImportInspection } from './TextbookImportInspection.js';
import type { TextbookPipelineImporterTabProps } from './TextbookPipelineImporterTab.js';
import type { useTextbookImportFlow } from './useTextbookImportFlow.js';

export function TextbookFileStep({ flow, source, onClear }: {
  flow: ReturnType<typeof useTextbookImportFlow>; source: TextbookPipelineImporterTabProps; onClear: () => void;
}) {
  const documentSource = Boolean(source.docPath.trim() || source.docUrl.trim());
  const selectedName = flow.filename || source.docPath.split(/[/\\]/).pop() || source.docUrl;
  return <div className="space-y-5 text-sm text-ink">
    <section className="flex flex-col items-center gap-4 rounded-2xl border border-line-soft bg-paper-soft px-6 py-8 text-center">
      <BookOpen className="h-8 w-8 text-accent-ink" />
      <div className="min-w-0 max-w-full"><h3 className="break-words font-serif text-xl font-semibold">{selectedName || '选择一本教材'}</h3><p className="mt-2 text-sm text-ink-muted">支持 PDF、EPUB 和 MOBI。</p></div>
      <Button onClick={flow.browse}><FolderOpen className="h-4 w-4" />{selectedName ? '更换教材文件' : '浏览本地文件'}</Button>
    </section>
    {source.pdfFileError && <p role="alert" className="text-ink-rose-700-rose-400">{source.pdfFileError}</p>}
    <ImportOptions title="使用文件路径或网址" summary="已有文件路径，或需要导入网页文档" defaultOpen={Boolean(source.docPath || source.docUrl)}>
      <label className="block space-y-2">本地 PDF 路径
        <input aria-label="本地 PDF 路径" value={source.pdfPath} onChange={event => { source.setPdfPath(event.target.value); source.setPdfFile(null); source.setDocPath(''); }} placeholder="粘贴 PDF 文件路径" className="w-full rounded-lg border border-line bg-surface p-2 text-ink" />
      </label>
      <input aria-label="电子书路径" value={source.docPath} onChange={event => { source.setDocPath(event.target.value); source.setDocUrl(''); }} placeholder="本地 EPUB / MOBI 路径" className="w-full rounded-lg border border-line bg-surface p-2 text-ink" />
      <input aria-label="网页文档网址" value={source.docUrl} onChange={event => { source.setDocUrl(event.target.value); source.setDocPath(''); }} placeholder="网页文档网址" className="w-full rounded-lg border border-line bg-surface p-2 text-ink" />
    </ImportOptions>
    {source.docNote && <p className="text-xs text-ink-muted">{source.docNote}</p>}
    {(flow.filename || flow.activeJob) && <TextbookImportInspection result={flow.inspection.data} document={flow.displayDocument}
      pending={flow.inspection.isFetching} error={flow.inspection.error} onRecheck={() => { void flow.recheck(); }}
      onContinue={() => flow.setStep(2)} onUse={source.onSelectBook} />}
    <div className="flex justify-between gap-3">
      <Button variant="ghost" size="sm" disabled={!selectedName || flow.documentMutation.isPending} onClick={onClear}>清除选择</Button>
      {documentSource ? <Button disabled={flow.documentMutation.isPending} onClick={flow.importDocument}>{flow.documentMutation.isPending ? '正在导入…' : '导入文档'}<ArrowRight className="h-4 w-4" /></Button> : <Button disabled={!flow.filename || flow.inspection.isFetching || flow.inspection.isError} onClick={() => flow.setStep(2)}>{flow.targetDocument ? '查看已保存目录' : '识别新教材目录'}<ArrowRight className="h-4 w-4" /></Button>}
    </div>
  </div>;
}
