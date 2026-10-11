import { useEffect, useMemo, useState } from 'react';
import { Sparkles, Timer, FileText, Bot, BrainCircuit, CheckCircle2, ChevronDown, ChevronUp, Terminal } from 'lucide-react';
import { BorderBeam } from '../magicui/BorderBeam.js';
import { Progress } from '../ui/progress.js';
import { useImportMonitorQuery } from '../../queries/textbook-import-monitor.js';
import { DEFAULT_USER_ID } from '../../queries/query-keys.js';
import type { ImportEvent } from '@study-studio/document-model';

export interface TocLiveProgressProps {
  userId?: string | undefined;
  traceId?: string | undefined;
  isExtracting: boolean;
  startedAt?: number | null | undefined;
  lastExtractedCount?: number | null | undefined;
  modelName?: string | undefined;
}

interface StepItem {
  id: number;
  label: string;
  icon: typeof FileText;
}

const STEPS: StepItem[] = [
  { id: 1, label: '切片目录', icon: FileText },
  { id: 2, label: '会话建立', icon: Bot },
  { id: 3, label: '流式推理', icon: BrainCircuit },
  { id: 4, label: '大纲组装', icon: CheckCircle2 },
];

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}s`;
}

function eventToSummary(event: ImportEvent): string {
  if (event.category === 'directory') {
    if (event.name === 'pages_prepared') return '已完成目录页码范围切片与材料预备';
    if (event.name.includes('started')) return '启动目录提取流水线工作区';
    return `目录准备阶段：${event.name}`;
  }
  if (event.category === 'session') {
    if (event.name === 'opened') return 'Agent 目录提取独立会话已开启';
    if (event.name === 'closed') return 'Agent 会话完成并安全释放';
  }
  if (event.category === 'model') {
    if (event.name === 'input') return '已投递目录提示词与排版参考';
    if (event.name === 'message') {
      const detail = event.detail as { reasoning?: string; text?: string } | undefined;
      if (detail?.reasoning) return `模型思考：${detail.reasoning.slice(0, 48)}…`;
      if (detail?.text) return `大模型生成增量：${detail.text.slice(0, 48)}…`;
      return '大模型正在深度解析排版与章节';
    }
  }
  if (event.category === 'tool') {
    if (event.name === 'requested') return '模型调用目录草稿提炼工具 (library.propose_toc)';
    if (event.name === 'result') return '已接收模型草稿并执行层级校验';
  }
  if (event.category === 'validation') {
    if (event.name === 'accepted') return '大纲校验通过，结构规范合法';
    if (event.name === 'rejected') return '草稿存在异常，模型正在重试调整';
  }
  return `${event.category}: ${event.name}`;
}

export function TocLiveProgress({
  userId = DEFAULT_USER_ID,
  traceId = '',
  isExtracting,
  startedAt,
  lastExtractedCount,
  modelName = '大模型',
}: TocLiveProgressProps) {
  const [elapsed, setElapsed] = useState(0);
  const [showLogStream, setShowLogStream] = useState(false);

  // 耗时计时器
  useEffect(() => {
    if (!isExtracting) return;
    const start = startedAt ?? Date.now();
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [isExtracting, startedAt]);

  const monitorQuery = useImportMonitorQuery(userId, traceId, Boolean(traceId && isExtracting));
  const rawEvents = monitorQuery.data?.events ?? [];

  const relevantEvents = useMemo(() => {
    return rawEvents.filter(e => ['directory', 'session', 'model', 'tool', 'validation'].includes(e.category));
  }, [rawEvents]);

  // 计算当前阶段 (1 ~ 4) 与进度百分比
  const { currentStep, progressPct, activeMessage } = useMemo(() => {
    if (!isExtracting && lastExtractedCount !== null && lastExtractedCount !== undefined) {
      return {
        currentStep: 4,
        progressPct: 100,
        activeMessage: `目录提炼完成！成功识别 ${lastExtractedCount} 条章节与课次大纲`,
      };
    }

    if (!isExtracting) {
      return { currentStep: 1, progressPct: 0, activeMessage: '' };
    }

    const hasValidation = relevantEvents.some(e => e.category === 'validation' || (e.category === 'tool' && e.name === 'result'));
    if (hasValidation) {
      return {
        currentStep: 4,
        progressPct: 92,
        activeMessage: '大模型已提交目录草稿，正在校验层级并组装纯语义大纲…',
      };
    }

    const hasToolRequested = relevantEvents.some(e => e.category === 'tool' && e.name === 'requested');
    if (hasToolRequested) {
      return {
        currentStep: 3,
        progressPct: 84,
        activeMessage: '大模型已识别出课次大纲，正在调用工具提交结构化草稿…',
      };
    }

    const latestModelMessage = relevantEvents.filter(e => e.category === 'model' && e.name === 'message').at(-1);
    if (latestModelMessage) {
      const detail = latestModelMessage.detail as { reasoning?: string; text?: string } | undefined;
      const snippet = detail?.reasoning || detail?.text;
      return {
        currentStep: 3,
        progressPct: Math.min(80, 55 + Math.floor(elapsed * 1.5)),
        activeMessage: snippet ? `大模型思考中：${snippet.slice(0, 60)}…` : '大模型正在流式解析排版缩进与课文标题…',
      };
    }

    const hasSessionOpened = relevantEvents.some(e => e.category === 'session' && e.name === 'opened') || relevantEvents.some(e => e.category === 'model' && e.name === 'input');
    if (hasSessionOpened) {
      return {
        currentStep: 2,
        progressPct: 40,
        activeMessage: `已启动 ${modelName} 会话，挂载目录工具与提示词…`,
      };
    }

    const hasPagesPrepared = relevantEvents.some(e => e.category === 'directory' && e.name === 'pages_prepared');
    if (hasPagesPrepared) {
      return {
        currentStep: 2,
        progressPct: 30,
        activeMessage: '目录页切片已就绪，正在准备连接大模型…',
      };
    }

    return {
      currentStep: 1,
      progressPct: Math.min(25, 10 + elapsed * 2),
      activeMessage: '正在读取 PDF 物理页，切片目录候选页与排版材料…',
    };
  }, [isExtracting, lastExtractedCount, relevantEvents, elapsed, modelName]);

  if (!isExtracting && (lastExtractedCount === null || lastExtractedCount === undefined)) {
    return null;
  }

  // 成功完成态微展示
  if (!isExtracting && lastExtractedCount !== null) {
    return (
      <div className="flex items-center justify-between rounded-2xl border border-line-accent bg-paper-soft/80 p-4 text-xs text-ink shadow-xs">
        <div className="flex items-center gap-2 font-medium text-status-success-fg">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>目录提炼完成！成功识别 {lastExtractedCount} 条章节与课次大纲</span>
        </div>
        <span className="font-mono text-ink-muted">耗时 {formatElapsed(elapsed)}</span>
      </div>
    );
  }

  return (
    <section aria-label="大模型目录提炼实时进度" className="relative overflow-hidden rounded-2xl border border-line-accent/40 bg-surface/90 p-5 text-ink shadow-md backdrop-blur-md">
      {/* Magic UI 动态流光边框 */}
      <BorderBeam
        size={180}
        duration="var(--motion-border-beam-agent-tool-duration)"
        colorFrom="var(--visual-agent-beam-from)"
        colorTo="var(--visual-agent-beam-to)"
      />

      {/* 头部标题与耗时仪表 */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent-soft text-accent-ink shadow-xs">
            <Sparkles className="h-4 w-4 animate-pulse" />
          </div>
          <div>
            <h4 className="font-semibold text-sm leading-tight text-ink">大模型智能提炼目录中</h4>
            <p className="mt-0.5 text-xs text-ink-muted">AI 视觉排版解析与纯语义层级识别</p>
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs text-ink-muted">
          <span className="flex h-2 w-2 rounded-full bg-status-success-fg animate-ping" />
          <Timer className="h-3.5 w-3.5" />
          <span className="font-medium text-ink">{formatElapsed(elapsed)}</span>
        </div>
      </div>

      {/* 4 阶段步进导航 */}
      <div className="my-3 grid grid-cols-4 gap-2 border-y border-line-soft py-3 text-xs">
        {STEPS.map((step) => {
          const Icon = step.icon;
          const isDone = currentStep > step.id;
          const isActive = currentStep === step.id;
          return (
            <div
              key={step.id}
              className={`flex flex-col items-center gap-1.5 rounded-lg py-1.5 text-center transition-colors ${
                isActive
                  ? 'bg-accent-soft/40 font-semibold text-accent-ink'
                  : isDone
                  ? 'text-status-success-fg'
                  : 'text-ink-muted opacity-60'
              }`}
            >
              <div className="flex h-6 w-6 items-center justify-center rounded-full border border-current">
                {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
              </div>
              <span className="text-[11px] leading-tight">{step.label}</span>
            </div>
          );
        })}
      </div>

      {/* 平滑光泽进度条 */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-[11px] text-ink-muted">
          <span>提炼进度</span>
          <span className="font-mono font-medium text-ink">{progressPct}%</span>
        </div>
        <Progress value={progressPct} className="h-2 rounded-full" />
      </div>

      {/* 实时活动/大模型思考摘要卡片 */}
      <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-line-soft bg-paper-soft/60 p-3 text-xs leading-relaxed text-ink">
        <BrainCircuit className="mt-0.5 h-4 w-4 shrink-0 text-accent-ink animate-pulse" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">{activeMessage}</p>
        </div>
      </div>

      {/* 可折叠的实时事件终端流 (Live Event Stream) */}
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setShowLogStream(prev => !prev)}
          className="flex w-full items-center justify-between text-[11px] text-ink-muted hover:text-ink transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <Terminal className="h-3.5 w-3.5" />
            实时事件流 ({relevantEvents.length} 条已捕获)
          </span>
          {showLogStream ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>

        {showLogStream && (
          <div className="mt-2 max-h-36 overflow-auto rounded-xl border border-line-soft bg-paper-soft/90 p-2.5 font-mono text-[11px] space-y-1.5">
            {relevantEvents.length === 0 ? (
              <p className="text-ink-muted">等待首个事件流推送…</p>
            ) : (
              relevantEvents.slice(-6).map((event) => (
                <div key={event.sequence} className="flex items-start gap-2 text-ink leading-tight">
                  <span className="text-ink-muted shrink-0 text-[10px]">
                    {event.occurredAt.slice(11, 19)}
                  </span>
                  <span className="rounded-xs bg-accent-soft px-1 text-[10px] text-accent-ink shrink-0">
                    {event.category}
                  </span>
                  <span className="truncate">{eventToSummary(event)}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </section>
  );
}
