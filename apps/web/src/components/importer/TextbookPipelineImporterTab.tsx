import { ArrowRight, ArrowLeft, Check, Sparkles, BookOpen, Layers, Bot } from 'lucide-react';
import { useState } from 'react';
import { TextbookImportMonitor } from './monitor/TextbookImportMonitor.js';
import { DEFAULT_USER_ID } from '../../queries/query-keys.js';
import type { TextbookAST } from '@study-studio/document-model';
import { Button } from '../ui/button.js';
import { TocRecognitionPanel } from '../toc/TocRecognitionPanel.js';
import { usePipelineJobStore } from '../../stores/usePipelineJobStore.js';
import { TextbookFileStep } from './TextbookFileStep.js';
import { ImportOptions } from './ImportOptions.js';
import { TextbookPageMapping } from './TextbookPageMapping.js';
import { TextbookExtractionSettings } from './TextbookExtractionSettings.js';
import { TextbookPipelineProgress } from './TextbookPipelineProgress.js';
import { useTextbookImportFlow, type TextbookImportSource } from './useTextbookImportFlow.js';

export interface TextbookPipelineImporterTabProps extends TextbookImportSource {
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

  const clear = () => {
    props.setPdfPath(''); props.setPdfFile(null); props.setDocPath(''); props.setDocUrl('');
    props.setParseError(null); props.setPdfFileError(null);
    flow.setEntries(null); flow.setStep(1);
  };

  const resetJob = () => {
    usePipelineJobStore.getState().clearActiveJob();
    flow.setStep(flow.entries ? 3 : 1);
  };

  const steps = [
    { id: 1, label: '1. 选择教材', desc: '上传 PDF / 电子书', icon: BookOpen },
    { id: 2, label: '2. 核对目录', desc: '确认章节与页码', icon: Layers },
    { id: 3, label: '3. 整理内容', desc: 'Agent池并发提炼', icon: Bot },
  ];

  return (
    <div className="space-y-6 text-ink">
      {/* 现代 Pipeline 步骤条 (Stepper) */}
      <nav aria-label="教材导入步骤" className="relative flex items-center justify-between border border-line-soft bg-paper-soft/60 backdrop-blur-xs rounded-2xl p-2.5">
        {steps.map((st, idx) => {
          const isActive = flow.step === st.id;
          const isDone = flow.step > st.id;
          const isDisabled = (st.id === 2 && (!flow.filename || flow.activeJob?.status === 'running')) || 
                             (st.id === 3 && (!flow.entries && !flow.activeJob)) || 
                             (st.id === 1 && flow.activeJob?.status === 'running');
          const Icon = st.icon;

          return (
            <div key={st.id} className="flex-1 flex items-center">
              <Button
                type="button"
                variant={isActive ? 'secondary' : 'outline'}
                disabled={isDisabled}
                onClick={() => flow.setStep(st.id as 1 | 2 | 3)}
                aria-current={isActive ? 'step' : undefined}
                className={`flex-1 flex items-center gap-3 px-3 py-2.5 h-auto rounded-xl transition-all text-left justify-start
                  ${isActive ? 'bg-surface shadow-xs border-line text-ink' : 
                    isDone ? 'text-ink-muted hover:text-ink' : 
                    'text-ink-muted/50'}`}
              >
                <div className={`w-7 h-7 rounded-xl flex items-center justify-center font-mono text-xs font-semibold shrink-0 transition-colors
                  ${isDone ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30' : 
                    isActive ? 'bg-accent-ink text-surface shadow-xs' : 
                    'bg-surface border border-line text-ink-muted'}`}
                >
                  {isDone ? <Check className="w-3.5 h-3.5 stroke-[2.5]" /> : <Icon className="w-3.5 h-3.5" />}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold flex items-center gap-1.5">
                    <span>{st.label}</span>
                    {isActive && st.id === 3 && flow.activeJob?.status === 'running' && (
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-ink-muted truncate hidden sm:block">
                    {st.desc}
                  </div>
                </div>
              </Button>
              {idx < steps.length - 1 && (
                <div className="w-4 flex items-center justify-center text-line-soft shrink-0">
                  <ArrowRight className="w-3.5 h-3.5" />
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {monitorOpen && <TextbookImportMonitor open onOpenChange={setMonitorOpen} userId={DEFAULT_USER_ID} traceId={flow.traceId} />}

      {flow.step === 1 && <TextbookFileStep flow={flow} source={props} onClear={clear} />}

      {flow.step === 2 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-muted">核对《{flow.filename}》的章节层级，正文按一级章节由 Agent 池并发提炼。</p>
            <Button size="sm" variant="ghost" onClick={() => setMonitorOpen(true)}>
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
                      <tr>
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
              file={props.pdfFile} 
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
      )}

      {flow.step === 3 && (
        <div className="space-y-4">
          {flow.activeJob ? (
            <TextbookPipelineProgress 
              job={flow.activeJob} 
              onClose={props.onClose} 
              onReset={resetJob}
              onRecheck={() => { void flow.recheck(); flow.setStep(1); }} 
            />
          ) : flow.entries && (
            <>
              <ImportOptions title="调整正文页码" summary="目录页码与 PDF 物理页码不对应时再微调">
                <TextbookPageMapping entries={flow.entries} onChange={flow.setEntries} />
                <Button 
                  variant="outline" 
                  size="sm" 
                  disabled={flow.outlineMutation.isPending} 
                  onClick={() => {
                    if (flow.entries) void flow.confirmOutline(flow.entries).catch(error => props.setParseError(error instanceof Error ? error.message : '目录保存失败，请重试'));
                  }}
                >
                  {flow.outlineMutation.isPending ? '正在保存目录…' : '保存目录调整'}
                </Button>
                {flow.outlineMutation.error && <p role="alert" className="text-xs text-ink-rose-700-rose-400">{flow.outlineMutation.error.message}</p>}
              </ImportOptions>
              <TextbookExtractionSettings 
                forceOverwrite={flow.forceOverwrite} 
                onForceOverwrite={flow.setForceOverwrite}
                pending={flow.startMutation.isPending || flow.outlineMutation.isPending} 
                onStart={flow.start} 
              />
              <Button variant="outline" size="sm" onClick={() => flow.setStep(2)}>
                返回修改目录
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
