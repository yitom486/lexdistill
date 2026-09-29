import React from 'react';
import {
  Sparkles,
  Cpu,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronDown,
  X,
  ExternalLink,
  Loader2,
  BookOpen,
  StopCircle,
} from 'lucide-react';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { sound } from '../../utils/audio.js';
import { usePipelineJobStore } from '../../stores/usePipelineJobStore.js';
import { useStudySessionStore } from '../../stores/useStudySessionStore.js';
import { useCancelPipelineJobMutation } from '../../queries/pipeline-jobs.js';

export function GlobalPipelineTaskWidget() {
  const activeJob = usePipelineJobStore((s) => s.activeJob);
  const isMinimized = usePipelineJobStore((s) => s.isWidgetMinimized);
  const setIsMinimized = usePipelineJobStore((s) => s.setIsWidgetMinimized);
  const setIsImporterModalOpen = usePipelineJobStore((s) => s.setIsImporterModalOpen);
  const clearActiveJob = usePipelineJobStore((s) => s.clearActiveJob);
  const setActiveTab = useStudySessionStore((s) => s.setActiveTab);

  const cancelJob = useCancelPipelineJobMutation();

  if (!activeJob || activeJob.status === 'idle') {
    return null;
  }

  const isRunning = activeJob.status === 'running';
  const isDone = activeJob.status === 'done';
  const isFailed = activeJob.status === 'failed';
  const isCancelled = activeJob.status === 'cancelled';

  const percent = activeJob.totalLessons > 0
    ? Math.min(100, Math.round((activeJob.doneLessons / activeJob.totalLessons) * 100))
    : 0;

  const handleOpenDetails = () => {
    sound.playClick();
    setActiveTab('TEXTBOOK');
    setIsImporterModalOpen(true);
  };

  const handleCancel = () => {
    sound.playClick();
    if (window.confirm(`确定要中止教材《${activeJob.title}》的提炼吗？已完成的课次将得以保留。`)) {
      cancelJob.mutate(activeJob.jobId);
    }
  };

  const handleClose = () => {
    sound.playClick();
    clearActiveJob();
  };

  // 极简小球态（Floating Bubble）
  if (isMinimized) {
    return (
      <div
        className="fixed bottom-6 right-6 z-50 animate-in fade-in zoom-in-95 duration-200"
        title={`《${activeJob.title}》整书提炼：${percent}% (${activeJob.doneLessons}/${activeJob.totalLessons})`}
      >
        <button
          type="button"
          onClick={() => {
            sound.playClick();
            setIsMinimized(false);
          }}
          className={`relative group flex items-center gap-2 px-3.5 py-2.5 rounded-full border shadow-xl backdrop-blur-md transition-all hover:scale-105 active:scale-95 ${
            isRunning
              ? 'bg-surface/95 border-tone-amber-500/40 text-ink hover:border-tone-amber-500 shadow-tone-amber-500/10'
              : isDone
                ? 'bg-surface/95 border-tone-emerald-500/40 text-ink hover:border-tone-emerald-500 shadow-tone-emerald-500/10'
                : 'bg-surface/95 border-tone-rose-500/40 text-ink hover:border-tone-rose-500'
          }`}
        >
          {/* 微光呼吸光环 */}
          {isRunning && (
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-tone-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-tone-amber-500" />
            </span>
          )}

          {isRunning ? (
            <Loader2 className="w-4 h-4 text-tone-amber-500 animate-spin" />
          ) : isDone ? (
            <CheckCircle2 className="w-4 h-4 text-tone-emerald-500" />
          ) : isFailed ? (
            <XCircle className="w-4 h-4 text-tone-rose-500" />
          ) : (
            <AlertCircle className="w-4 h-4 text-ink-ghost" />
          )}

          <div className="flex flex-col text-left">
            <span className="text-[11px] font-bold tracking-tight text-ink">
              {isRunning ? `${percent}%` : isDone ? '提炼完成' : '提炼中断'}
            </span>
            <span className="text-[9px] text-ink-muted truncate max-w-[80px]">
              {activeJob.doneLessons}/{activeJob.totalLessons} 课
            </span>
          </div>
        </button>
      </div>
    );
  }

  // 展开进度胶囊态（Floating Capsule / Card）
  return (
    <div
      className="fixed bottom-6 right-6 z-50 w-88 max-w-[calc(100vw-2rem)] rounded-2xl border border-line bg-surface/95 backdrop-blur-md shadow-2xl p-4 space-y-3 animate-in fade-in slide-in-from-bottom-3 duration-200"
    >
      {/* 头部信息 */}
      <div className="flex items-start justify-between gap-2 border-b border-line-soft pb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`p-1.5 rounded-lg border shrink-0 ${
            isRunning
              ? 'bg-tone-amber-500/10 border-tone-amber-500/30 text-tone-amber-500'
              : isDone
                ? 'bg-tone-emerald-500/10 border-tone-emerald-500/30 text-tone-emerald-500'
                : 'bg-surface-elevated border-line text-ink-muted'
          }`}>
            {isRunning ? (
              <Sparkles className="w-4 h-4 animate-pulse" />
            ) : isDone ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : (
              <BookOpen className="w-4 h-4" />
            )}
          </div>
          <div className="min-w-0">
            <h4 className="text-xs font-bold text-ink truncate" title={activeJob.title}>
              《{activeJob.title}》
            </h4>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Badge
                variant={isRunning ? 'secondary' : isDone ? 'emerald' : 'outline'}
                className="text-[10px] py-0 px-1.5 h-4"
              >
                {isRunning ? 'AI 并发提炼中' : isDone ? '提炼完成' : isFailed ? '提炼失败' : '已中止'}
              </Badge>
              {activeJob.concurrency && (
                <span className="text-[10px] text-ink-ghost font-mono">
                  {activeJob.concurrency} Workers
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 窗口操作按钮 */}
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="w-6 h-6 text-ink-muted hover:text-ink"
            onClick={() => {
              sound.playClick();
              setIsMinimized(true);
            }}
            title="最小化为悬浮球"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </Button>
          {!isRunning && (
            <Button
              variant="ghost"
              size="icon"
              className="w-6 h-6 text-ink-muted hover:text-ink"
              onClick={handleClose}
              title="关闭并清除此任务卡片"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* 进度条与数字 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-ink">
            {percent}% <span className="text-ink-ghost font-normal">完成</span>
          </span>
          <span className="font-mono text-[11px] text-ink-muted">
            {activeJob.doneLessons} / {activeJob.totalLessons} 课
          </span>
        </div>

        {/* 动态进度条 */}
        <div className="w-full h-2 rounded-full bg-surface-elevated border border-line overflow-hidden">
          <div
            className={`h-full transition-all duration-300 rounded-full ${
              isRunning
                ? 'bg-tone-amber-500'
                : isDone
                  ? 'bg-tone-emerald-500'
                  : 'bg-tone-rose-500'
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {/* 当前处理状态 */}
      <div className="text-[11px] text-ink-muted bg-surface-elevated/70 rounded-xl p-2 border border-line-soft">
        {isRunning ? (
          <div className="flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 text-tone-amber-500 animate-spin shrink-0" />
            <span className="truncate">
              正在提炼: <span className="font-medium text-ink">{activeJob.currentLessonTitle || '课次切片中...'}</span>
            </span>
          </div>
        ) : isDone ? (
          <div className="flex items-center gap-1.5 text-ink-emerald-700-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">全书 {activeJob.successfulLessons} 课已原子入库并生成大纲</span>
          </div>
        ) : isFailed ? (
          <div className="flex items-center gap-1.5 text-tone-rose-500">
            <XCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{activeJob.error || '提炼过程出现异常'}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-ink-ghost">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>用户已主动中止任务</span>
          </div>
        )}
      </div>

      {/* 底部行动栏 */}
      <div className="flex items-center justify-between pt-1 gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleOpenDetails}
          className="text-xs h-7 gap-1.5 flex-1"
        >
          <ExternalLink className="w-3 h-3" />
          {isRunning ? '查看实时大屏' : '查看提炼详情'}
        </Button>

        {isRunning ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCancel}
            disabled={cancelJob.isPending}
            className="text-xs h-7 text-tone-rose-500 hover:text-tone-rose-600 hover:bg-tone-rose-500/10 px-2"
            title="中止提炼流水线"
          >
            <StopCircle className="w-3 h-3 mr-1" />
            中止
          </Button>
        ) : isDone ? (
          <Button
            size="sm"
            onClick={() => {
              sound.playClick();
              setActiveTab('TEXTBOOK');
              clearActiveJob();
            }}
            className="text-xs h-7 px-3 bg-tone-emerald-600 hover:bg-tone-emerald-700 text-tone-white"
          >
            前往学习
          </Button>
        ) : null}
      </div>
    </div>
  );
}
