import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '../ui/button.js';
import { TocRecognitionPanel } from '../toc/TocRecognitionPanel.js';
import type { TextbookPipelineImporterTabProps } from './TextbookPipelineImporterTab.js';
import type { useTextbookImportFlow } from './useTextbookImportFlow.js';

export interface TextbookTocStepProps {
  flow: ReturnType<typeof useTextbookImportFlow>;
  source: TextbookPipelineImporterTabProps;
  onOpenMonitor: () => void;
}

export function TextbookTocStep({ flow, source, onOpenMonitor }: TextbookTocStepProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">核对《{flow.filename}》的章节层级，正文按一级章节由 Agent 池并发提炼。</p>
        <Button size="sm" variant="ghost" onClick={onOpenMonitor}>
          目录运行详情
        </Button>
      </div>
      {flow.inspection.isFetching ? (
        <p className="text-xs text-ink-muted">正在检查已保存目录…</p>
      ) : flow.inspection.isError ? (
        <p role="alert" className="text-xs text-ink-rose-700-rose-400">{flow.inspection.error.message}</p>
      ) : flow.targetDocument?.outlineConfirmed && !flow.rescanOutline ? (
        <section aria-label="已保存目录" className="space-y-3 rounded-2xl border border-line-soft bg-paper-soft p-5 text-sm text-ink">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">《{flow.targetDocument.title}》的目录已保存</span>
            <Button size="sm" variant="outline" onClick={flow.beginRescan}>重新识别目录</Button>
          </div>
          {flow.slots.isFetching ? (
            <p>正在读取目录…</p>
          ) : flow.slots.isError ? (
            <p role="alert">{flow.slots.error.message}</p>
          ) : (
            <div className="max-h-64 overflow-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-line-soft text-ink-muted">
                    <th className="p-1">目录条目</th>
                    <th className="p-1">PDF 物理页</th>
                    <th className="p-1">内容状态</th>
                  </tr>
                </thead>
                <tbody>
                  {flow.slots.data?.map(slot => (
                    <tr key={slot.lessonId} className="border-t border-line-soft">
                      <td className="p-1.5">{slot.title}</td>
                      <td className="p-1.5">{slot.startPage}{slot.endPage ? `–${slot.endPage}` : ''}</td>
                      <td className="p-1.5">{slot.status === 'ready' ? '已提取' : slot.status === 'failed' ? '待重试' : '待提取'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <TocRecognitionPanel 
          key={flow.sourceKey} 
          file={source.pdfFile} 
          filePath={flow.path}
          traceId={flow.traceId}
          {...(flow.entries ? { initialEntries: flow.entries } : {})}
          onTocConfirmed={flow.confirmOutline} 
          confirmPending={flow.outlineMutation.isPending} 
          onTocInvalidated={() => flow.setEntries(null)} 
        />
      )}
      <div className="flex justify-between gap-2 pt-2">
        <Button size="sm" variant="outline" onClick={() => flow.setStep(1)}>
          <ArrowLeft className="h-4 w-4" />返回检测
        </Button>
        <Button disabled={!flow.entries?.length || flow.outlineMutation.isPending || flow.slots.isError} onClick={() => flow.setStep(3)}>
          继续整理内容<ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
