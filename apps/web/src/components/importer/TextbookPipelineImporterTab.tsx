import { BookOpen, ArrowRight, ArrowLeft, FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { TextbookImportMonitor } from './monitor/TextbookImportMonitor.js';
import { DEFAULT_USER_ID } from '../../queries/query-keys.js';
import type { TextbookAST } from '@study-studio/document-model';
import { Button } from '../ui/button.js';
import { TocRecognitionPanel } from '../toc/TocRecognitionPanel.js';
import { useOcrStore } from '../../stores/useOcrStore.js';
import { usePipelineJobStore } from '../../stores/usePipelineJobStore.js';
import { TextbookImportInspection } from './TextbookImportInspection.js';
import { TextbookPageMapping } from './TextbookPageMapping.js';
import { TextbookExtractionSettings } from './TextbookExtractionSettings.js';
import { TextbookPipelineProgress } from './TextbookPipelineProgress.js';
import { useTextbookImportFlow, type TextbookImportSource } from './useTextbookImportFlow.js';

interface TextbookPipelineImporterTabProps extends TextbookImportSource {
  pdfNote: string | null;
  setPdfNote: (note: string | null) => void;
  pdfFileError: string | null;
  setPdfFileError: (error: string | null) => void;
  docNote: string | null;
  parsedAST: TextbookAST | null;
  setParsedAST: (ast: TextbookAST | null) => void;
  setInputText: (text: string) => void;
  existingBooks?: Array<{ documentId: string; title: string; lessons: number }>;
  onClose: () => void;
  onSelectJsonFile: (fileOrPath: File | string) => void;
  onSelectBook?: ((documentId: string) => void) | undefined;
}

export function TextbookPipelineImporterTab(props: TextbookPipelineImporterTabProps) {
  const flow = useTextbookImportFlow(props);
  const [monitorOpen, setMonitorOpen] = useState(false);
  const azureEndpoint = useOcrStore((s) => s.azureDiEndpoint);
  const azureKey = useOcrStore((s) => s.azureDiKey);
  const azure = azureEndpoint.trim() && azureKey.trim() ? { endpoint: azureEndpoint.trim(), key: azureKey.trim() } : undefined;
  const clear = () => {
    props.setPdfPath(''); props.setPdfFile(null); props.setDocPath(''); props.setDocUrl('');
    props.setParseError(null); props.setPdfFileError(null);
    flow.setEntries(null); flow.setStep(1);
  };
  const resetJob = () => {
    usePipelineJobStore.getState().clearActiveJob();
    flow.setStep(flow.entries ? 3 : 1);
  };
  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-2" aria-label="教材导入步骤">
        <Button variant={flow.step === 1 ? 'secondary' : 'outline'} size="sm" onClick={() => flow.setStep(1)}>1. 选择与检测教材</Button>
        <Button variant={flow.step === 2 ? 'secondary' : 'outline'} size="sm" disabled={!flow.filename} onClick={() => flow.setStep(2)}>2. 核对目录</Button>
        <Button variant={flow.step === 3 ? 'secondary' : 'outline'} size="sm" disabled={!flow.entries && !flow.activeJob} onClick={() => flow.setStep(3)}>3. 提取与检查内容</Button>
      </nav>
      {!flow.activeJob && flow.filename && <Button size="sm" variant="outline" onClick={() => setMonitorOpen(true)}>目录运行详情</Button>}
      {monitorOpen && <TextbookImportMonitor open onOpenChange={setMonitorOpen} userId={DEFAULT_USER_ID} traceId={flow.traceId} />}
      {flow.step === 1 && (
        <div className="space-y-4">
          <div className="space-y-3 rounded-2xl border border-line bg-surface p-4 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-semibold text-ink"><BookOpen className="h-4 w-4" />选择本地教材</span>
              <Button size="sm" onClick={flow.browse}><FolderOpen className="h-4 w-4" />浏览本地文件</Button>
            </div>
            <label className="block space-y-1 text-ink">
              本地 PDF 路径
              <input aria-label="本地 PDF 路径" value={props.pdfPath} onChange={(event) => {
                props.setPdfPath(event.target.value); props.setPdfFile(null); props.setDocPath('');
              }} placeholder="可通过文件选择器选择，也可粘贴路径" className="w-full rounded-lg border border-line bg-surface p-2 text-ink" />
            </label>
            {flow.filename && <p className="text-ink-muted">{flow.filename}</p>}
            {props.pdfFileError && <p role="alert" className="text-ink-rose-700-rose-400">{props.pdfFileError}</p>}
            <details className="border-t border-line-soft pt-2">
              <summary className="cursor-pointer text-ink-muted">EPUB / MOBI / 网页文档导入</summary>
              <div className="mt-3 space-y-2">
                <input aria-label="电子书路径" value={props.docPath} onChange={(event) => {
                  props.setDocPath(event.target.value); props.setDocUrl('');
                }} placeholder="本地 EPUB / MOBI 路径" className="w-full rounded-lg border border-line bg-surface p-2 text-ink" />
                <input aria-label="网页文档网址" value={props.docUrl} onChange={(event) => {
                  props.setDocUrl(event.target.value); props.setDocPath('');
                }} placeholder="或输入网页网址" className="w-full rounded-lg border border-line bg-surface p-2 text-ink" />
                <Button size="sm" variant="outline" disabled={flow.documentMutation.isPending || (!props.docPath.trim() && !props.docUrl.trim())} onClick={flow.importDocument}>导入文档</Button>
                {props.docNote && <p className="text-ink-muted">{props.docNote}</p>}
              </div>
            </details>
          </div>
          {(flow.filename || flow.activeJob) && <TextbookImportInspection
            result={flow.inspection.data} document={flow.displayDocument}
            pending={flow.inspection.isFetching} error={flow.inspection.error}
            onRecheck={() => { void flow.recheck(); }}
            onContinue={() => flow.setStep(2)}
            onUse={props.onSelectBook}
          />}
          <div className="flex justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={clear}>清除选择</Button>
            <Button disabled={!flow.filename || flow.inspection.isFetching || flow.inspection.isError} onClick={() => {
              flow.setStep(2);
            }}>{flow.targetDocument ? '查看已保存目录' : '识别新教材目录'}<ArrowRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}
      {flow.step === 2 && (
        <div className="space-y-4">
          <p className="text-xs text-ink-muted">核对《{flow.filename}》的课次、课内小节和印刷页码。确认后默认用本次目录结束页换算 PDF 页码，也可调整。</p>
          {flow.inspection.isFetching ? <p className="text-xs text-ink-muted">正在检查已保存目录…</p>
            : flow.inspection.isError ? <p role="alert" className="text-xs text-ink-rose-700-rose-400">{flow.inspection.error.message}</p>
            : flow.targetDocument?.outlineConfirmed && !flow.rescanOutline ? (
              <section aria-label="已保存目录" className="space-y-3 rounded-2xl border border-line bg-surface p-4 text-xs text-ink">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">《{flow.targetDocument.title}》的目录已保存</span>
                  <Button size="sm" variant="outline" onClick={flow.beginRescan}>重新识别目录</Button>
                </div>
                {flow.slots.isFetching ? <p>正在读取目录…</p> : flow.slots.isError ? <p role="alert">{flow.slots.error.message}</p> : (
                  <div className="max-h-64 overflow-auto"><table className="w-full text-left">
                    <thead><tr><th className="p-1">目录条目</th><th className="p-1">PDF 物理页</th><th className="p-1">内容状态</th></tr></thead>
                    <tbody>{flow.slots.data?.map(slot => <tr key={slot.lessonId} className="border-t border-line-soft">
                      <td className="p-1.5">{slot.title}</td><td className="p-1.5">{slot.startPage}{slot.endPage ? `–${slot.endPage}` : ''}</td>
                      <td className="p-1.5">{slot.status === 'ready' ? '已提取' : slot.status === 'failed' ? '待重试' : '待提取'}</td>
                    </tr>)}</tbody>
                  </table></div>
                )}
              </section>
            ) : <TocRecognitionPanel key={flow.sourceKey} file={props.pdfFile} filePath={flow.path}
            traceId={flow.traceId}
            {...(azure ? { azure } : {})}
            {...(flow.entries ? { initialEntries: flow.entries } : {})}
            onTocConfirmed={flow.confirmOutline} confirmPending={flow.outlineMutation.isPending} onTocInvalidated={() => flow.setEntries(null)} />}
          <div className="flex justify-between gap-2">
            <Button size="sm" variant="outline" onClick={() => flow.setStep(1)}><ArrowLeft className="h-4 w-4" />返回检测</Button>
            <Button disabled={!flow.entries?.length || flow.outlineMutation.isPending || flow.slots.isError} onClick={() => flow.setStep(3)}>目录已保存，继续提取<ArrowRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}
      {flow.step === 3 && (
        <div className="space-y-4">
          {flow.activeJob ? <TextbookPipelineProgress job={flow.activeJob} onClose={props.onClose} onReset={resetJob}
            onRecheck={() => { void flow.recheck(); flow.setStep(1); }} /> : flow.entries && (
            <>
              <TextbookPageMapping entries={flow.entries} onChange={flow.setEntries} />
              <Button variant="outline" size="sm" disabled={flow.outlineMutation.isPending} onClick={() => {
                if (flow.entries) void flow.confirmOutline(flow.entries).catch(error => props.setParseError(error instanceof Error ? error.message : '目录保存失败，请重试'));
              }}>{flow.outlineMutation.isPending ? '正在保存目录…' : '保存目录调整'}</Button>
              {flow.outlineMutation.error && <p role="alert" className="text-xs text-ink-rose-700-rose-400">{flow.outlineMutation.error.message}</p>}
              <TextbookExtractionSettings forceOverwrite={flow.forceOverwrite} onForceOverwrite={flow.setForceOverwrite}
                pending={flow.startMutation.isPending || flow.outlineMutation.isPending} onStart={flow.start} />
              <Button variant="outline" size="sm" onClick={() => flow.setStep(2)}>返回修改目录</Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
