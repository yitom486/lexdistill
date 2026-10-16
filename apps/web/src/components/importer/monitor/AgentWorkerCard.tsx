import React from 'react';
import { 
  Bot, 
  Cpu, 
  Sparkles, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  BookOpen, 
  RotateCcw, 
  ChevronRight,
  Database,
  FileText
} from 'lucide-react';
import type { ImportEvent } from '@study-studio/document-model';
import type { TextbookModelActivity } from '@study-studio/document-model';

export interface WorkerStatusInfo {
  workerIndex: number;
  sessionId: string;
  threadId?: string | null | undefined;
  nodeId?: string | null | undefined;
  lessonTitle?: string | undefined;
  stage: 'idle' | 'preparing' | 'thinking' | 'extracting' | 'validating' | 'saving' | 'saved' | 'retrying' | 'failed';
  stageText: string;
  activity?: TextbookModelActivity | undefined;
  recentMessage?: string | undefined;
  lastActiveTime?: string | undefined;
  stats?: {
    vocabCount?: number | undefined;
    grammarCount?: number | undefined;
    exerciseCount?: number | undefined;
    hasPassage?: boolean | undefined;
  } | undefined;
  attemptCount: number;
  durationSeconds?: number | undefined;
}

interface AgentWorkerCardProps {
  worker: WorkerStatusInfo;
  onClickDetails: () => void;
}

export function AgentWorkerCard({ worker, onClickDetails }: AgentWorkerCardProps) {
  // 根据 stage 决定卡片视觉风格：重试是正在干活，不是等待。
  const isRunning = ['preparing', 'thinking', 'extracting', 'validating', 'saving', 'retrying'].includes(worker.stage);
  const isSuccess = worker.stage === 'saved';
  const isError = worker.stage === 'failed';
  const isRetrying = worker.stage === 'retrying';

  const badgeColor = {
    idle: 'bg-worker-idle-wash text-worker-idle-fg border-worker-idle-line',
    preparing: 'bg-status-info-wash text-status-info-fg border-status-info-line',
    thinking: 'bg-worker-thinking-wash text-worker-thinking-fg border-worker-thinking-line',
    extracting: 'bg-status-warn-wash-strong text-status-warn-fg border-status-warn-line',
    validating: 'bg-worker-validating-wash text-worker-validating-fg border-worker-validating-line',
    saving: 'bg-worker-saving-wash text-worker-saving-fg border-worker-saving-line',
    saved: 'bg-status-success-wash-strong text-status-success-fg border-status-success-line',
    retrying: 'bg-status-rose-wash-strong text-status-rose-fg border-status-rose-line',
    failed: 'bg-status-danger-wash-strong text-status-danger-fg border-status-danger-line',
  }[worker.stage];

  const statusIndicator = isRunning ? (
    <span className="relative flex h-2.5 w-2.5">
      <span className="animate-ping motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-status-warn-pulse opacity-75"></span>
      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-status-warn-dot"></span>
    </span>
  ) : isSuccess ? (
    <CheckCircle2 className="w-3.5 h-3.5 text-status-success-dot" />
  ) : isError ? (
    <AlertCircle className="w-3.5 h-3.5 text-status-danger-dot" />
  ) : (
    <span className="h-2 w-2 rounded-full bg-worker-idle-dot" />
  );

  return (
    <div 
      onClick={onClickDetails}
      onKeyDown={(e) => {
        if (e.repeat || e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClickDetails();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`查看会话详情${worker.lessonTitle ? `：${worker.lessonTitle}` : ''}（${worker.stageText}）`}
      className={`group relative flex flex-col justify-between rounded-2xl border p-4.5 transition-all duration-[var(--motion-card-hover-duration)] cursor-pointer overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring
        ${isRunning 
          ? 'bg-gradient-to-br from-surface to-paper-soft border-status-warn-line-strong shadow-sm hover:border-status-warn-line-bold hover:shadow-md' 
          : isSuccess 
          ? 'bg-paper-soft/80 border-status-success-line hover:border-status-success-line-strong'
          : isError
          ? 'bg-status-danger-wash-faint border-status-danger-line hover:border-status-danger-line-strong'
          : 'bg-paper-soft border-line-soft hover:border-line'
        }`}
    >
      {/* 顶部状态与 Worker ID */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-7 h-7 rounded-xl bg-surface border border-line text-ink font-mono text-xs font-semibold shadow-xs">
              #{worker.workerIndex}
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-medium text-ink flex items-center gap-1.5">
                <Bot className="w-3.5 h-3.5 text-accent-ink" />
                会话 {worker.sessionId ? `${worker.sessionId.slice(0, 10)}…` : '等待分配'}
              </span>
            </div>
          </div>
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${badgeColor}`}>
            {statusIndicator}
            <span>{worker.stageText}</span>
          </div>
        </div>

        {/* 锁定章节 */}
        <div className="rounded-xl bg-surface/70 border border-line-soft/80 p-3 mb-3">
          <div className="flex items-center gap-1.5 text-xs text-ink-muted mb-1">
            <BookOpen className="w-3.5 h-3.5 text-accent-ink shrink-0" />
            <span className="truncate">当前处理章节</span>
          </div>
          <div className="font-serif text-sm font-semibold text-ink line-clamp-1" title={worker.lessonTitle || '等待章节队列'}>
            {worker.lessonTitle || '暂无任务，就绪待命'}
          </div>
        </div>

        {/* 实时动态活动信息 */}
        <div className="min-h-[2.5rem] mb-3">
          <div className="text-xs text-ink-muted flex items-start gap-1.5 line-clamp-2">
            <Sparkles className="w-3.5 h-3.5 text-status-warn-dot shrink-0 mt-0.5" />
            <span className="break-all">
              {worker.recentMessage || (isRetrying ? '上一轮未成功，正在换新一轮重新提炼…' : isRunning ? '模型正在分析章节上下文并生成结构化内容…' : isSuccess ? '本课全部内容已完成格式校验并存入 SQLite' : '等待任务队列调度')}
            </span>
          </div>
        </div>
      </div>

      {/* 底部产出数据与操作指引 */}
      <div>
        {worker.stats && (worker.stats.vocabCount || worker.stats.grammarCount || worker.stats.exerciseCount) ? (
          <div className="flex items-center gap-2 pt-2 border-t border-line-soft text-xs text-ink-muted mb-2.5">
            <span className="px-2 py-0.5 rounded-md bg-surface border border-line text-ink">
              生词 <strong className="font-mono text-accent-ink">{worker.stats.vocabCount ?? 0}</strong>
            </span>
            <span className="px-2 py-0.5 rounded-md bg-surface border border-line text-ink">
              语法 <strong className="font-mono text-accent-ink">{worker.stats.grammarCount ?? 0}</strong>
            </span>
            <span className="px-2 py-0.5 rounded-md bg-surface border border-line text-ink">
              习题 <strong className="font-mono text-accent-ink">{worker.stats.exerciseCount ?? 0}</strong>
            </span>
          </div>
        ) : null}

        <div className="flex items-center justify-between pt-2 border-t border-line-soft text-xs text-ink-muted">
          <div className="flex items-center gap-2">
            {worker.attemptCount > 1 && (
              <span className="flex items-center gap-1 text-status-warn-fg font-mono">
                <RotateCcw className="w-3 h-3" />
                第 {worker.attemptCount} 次尝试
              </span>
            )}
            {worker.lastActiveTime && (
              <span className="flex items-center gap-1 font-mono">
                <Clock className="w-3 h-3" />
                {worker.lastActiveTime}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 text-accent-ink font-medium group-hover:translate-x-0.5 transition-transform">
            <span>会话实况</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>
    </div>
  );
}
