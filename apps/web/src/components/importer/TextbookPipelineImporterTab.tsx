import { ArrowRight, ArrowLeft, Check, Sparkles, BookOpen, Layers, Bot } from 'lucide-react';
import { useState } from 'react';
import { TextbookImportMonitor } from './monitor/TextbookImportMonitor.js';
import { DEFAULT_USER_ID } from '../../queries/query-keys.js';
import type { TextbookAST } from '@lexdistill/document-model';
import { Button } from '../ui/button.js';
import { TextbookFileStep } from './TextbookFileStep.js';
import { TextbookTocStep } from './TextbookTocStep.js';
import { ImportOptions } from './ImportOptions.js';
import { TextbookPageMapping } from './TextbookPageMapping.js';
import { TextbookExtractionSettings } from './TextbookExtractionSettings.js';
import { TextbookPipelineProgress } from './TextbookPipelineProgress.js';
import { useTextbookImportFlow, type TextbookImportSource } from './useTextbookImportFlow.js';
import { usePipelineJobStore } from '../../stores/usePipelineJobStore.js';

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
                  ${isDone ? 'bg-status-success-wash-strong text-status-success-fg border border-status-success-line' : 
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
                        <span className="animate-ping motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-status-success-pulse opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-status-success-dot"></span>
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-ink-muted truncate hidden sm:block">
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

      {monitorOpen && <TextbookImportMonitor open onOpenChange={setMonitorOpen} userId={DEFAULT_USER_ID} traceId={flow.traceId} directoryOnly />}

      {flow.step === 1 && <TextbookFileStep flow={flow} source={props} onClear={clear} />}

      {flow.step === 2 && (
        <TextbookTocStep flow={flow} source={props} onOpenMonitor={() => setMonitorOpen(true)} />
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
