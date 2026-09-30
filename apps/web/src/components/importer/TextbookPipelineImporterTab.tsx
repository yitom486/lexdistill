import { BookOpen, ArrowRight, ArrowLeft, FolderOpen } from 'lucide-react';
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
            }}>{flow.targetDocument ? '重新识别这本教材的目录' : '识别新教材目录'}<ArrowRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}
      {flow.step === 2 && (
        <div className="space-y-4">
          <p className="text-xs text-ink-muted">核对《{flow.filename}》的课次、课内小节和印刷页码。正式提取前还需确认 PDF 实际页码。</p>
          {flow.targetDocument && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3 text-xs text-ink">
            <span>已选择《{flow.targetDocument.title}》，可复用已保存目录。</span>
            <Button size="sm" variant="outline" disabled={flow.slots.isFetching} onClick={flow.reuseOutline}>复用已存目录并核对页码</Button>
          </div>}
          <TocRecognitionPanel key={flow.sourceKey} file={props.pdfFile} filePath={flow.path}
            {...(azure ? { azure } : {})}
            {...(flow.entries ? { initialEntries: flow.entries } : {})}
            onTocConfirmed={flow.setEntries} onTocInvalidated={() => flow.setEntries(null)} />
          <div className="flex justify-between gap-2">
            <Button size="sm" variant="outline" onClick={() => flow.setStep(1)}><ArrowLeft className="h-4 w-4" />返回检测</Button>
            <Button disabled={!flow.entries?.length} onClick={() => flow.setStep(3)}>目录已核对，确认正文页码<ArrowRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}
      {flow.step === 3 && (
        <div className="space-y-4">
          {flow.activeJob ? <TextbookPipelineProgress job={flow.activeJob} onClose={props.onClose} onReset={resetJob}
            onRecheck={() => { void flow.recheck(); flow.setStep(1); }} /> : flow.entries && (
            <>
              <TextbookPageMapping entries={flow.entries} onChange={flow.setEntries} />
              <TextbookExtractionSettings forceOverwrite={flow.forceOverwrite} onForceOverwrite={flow.setForceOverwrite}
                pending={flow.startMutation.isPending} onStart={flow.start} />
              <Button variant="outline" size="sm" onClick={() => flow.setStep(2)}>返回修改目录</Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
