import React, { useEffect, useRef } from 'react';
import { Loader2, XCircle, RotateCcw, Sparkles, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import type { EnrichJobSnapshot } from '@study-studio/protocol';
import { sound } from '../utils/audio.js';
import { Button } from './ui/button.js';
import { Progress } from './ui/progress.js';
import {
  DEFAULT_USER_ID,
  useStartEnrichJobMutation,
  useEnrichJobQuery,
  useCancelEnrichJobMutation,
  useEnrichJobSubscription,
} from '../queries/useLearnerQueries.js';
import { useEnrichJobLedgerStore } from '../stores/useEnrichJobLedgerStore.js';

interface EnrichJobPanelProps {
  documentId: string | undefined;
  /** 尚无生词的课数（0 则不展示启动入口） */
  pendingCount: number;
}

/**
 * 整本后台抽取面板：启动→进度条→取消/重试失败，全程不锁页面。
 * 任务跑在网关：逐课落库，刷新页面凭台账续看；失败课可单独重试。
 */
export function EnrichJobPanel({ documentId, pendingCount }: EnrichJobPanelProps) {
  const startJob = useStartEnrichJobMutation();
  const cancelJob = useCancelEnrichJobMutation();
  const trackedJobId = useEnrichJobLedgerStore((s) =>
    documentId ? (s.jobByDocument[documentId] ?? null) : null
  );
  const track = useEnrichJobLedgerStore((s) => s.track);
  const untrack = useEnrichJobLedgerStore((s) => s.untrack);

  const jobQuery = useEnrichJobQuery(DEFAULT_USER_ID, documentId ?? '', trackedJobId);
  useEnrichJobSubscription(DEFAULT_USER_ID, documentId ?? '', trackedJobId);
  const job: EnrichJobSnapshot | undefined = jobQuery.data;
  const announcedRef = useRef<string | null>(null);

  // 终态播报一次：成功音/失败 toast，并从台账摘除（失败保留 jobId？不清——面板就地给重试入口）
  useEffect(() => {
    if (!job || job.status === 'running') return;
    if (announcedRef.current === job.jobId) return;
    announcedRef.current = job.jobId;
    if (job.status === 'done' && job.failed.length === 0) {
      sound.playCorrect();
      toast.success(
        `整本抽取完成：${job.doneLessons} 课 · 生词 ${job.vocabularies} · 文法 ${job.grammarPoints}` +
          (job.dropped > 0 ? `（丢弃可疑 ${job.dropped} 条）` : '')
      );
      if (documentId) untrack(documentId);
    } else if (job.status === 'done') {
      toast.warning(`抽取完成，${job.failed.length} 课失败，可单独重试`);
    } else if (job.status === 'cancelled') {
      toast.info(`已取消：${job.doneLessons}/${job.totalLessons} 课已保存，可继续抽剩余`);
    } else if (job.status === 'failed') {
      sound.playMistake();
      toast.error(job.error || '抽取任务失败');
    }
  }, [job, documentId, untrack]);

  if (!documentId) return null;

  const launch = (lessonIds?: string[]) => {
    sound.playClick();
    announcedRef.current = null;
    startJob.mutate(
      { documentId, ...(lessonIds ? { lessonIds } : {}) },
      {
        onSuccess: (snapshot) => {
          track(documentId, snapshot.jobId);
          toast.info(
            snapshot.totalLessons > 0
              ? `后台抽取已启动：共 ${snapshot.totalLessons} 课，可随意浏览别处`
              : '任务已启动'
          );
        },
        onError: (e) => {
          sound.playMistake();
          toast.error(e instanceof Error ? e.message : '启动抽取失败');
        },
      }
    );
  };

  // 无任务 + 无待抽：静默（整本已有词）
  if (!job && pendingCount === 0) return null;

  // 无任务：启动入口
  if (!job) {
    return (
      <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
        <Sparkles className="w-3.5 h-3.5 text-amber-500" />
        <span>整本 {pendingCount} 课待抽（后台运行，不锁页面）</span>
        <Button
          variant="outline"
          size="sm"
          disabled={startJob.isPending}
          onClick={() => launch()}
          className="gap-1"
        >
          {startJob.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          <span>{startJob.isPending ? '启动中…' : '整本后台抽取'}</span>
        </Button>
      </div>
    );
  }

  const pct = job.totalLessons > 0 ? job.doneLessons / job.totalLessons : 0;
  const failedIds = job.failed.map((f) => f.lessonId);

  return (
    <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 dark:bg-amber-500/10 px-3.5 py-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-200">
          {job.status === 'running' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" />
          ) : job.status === 'done' && failedIds.length === 0 ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
          )}
          <span>
            {job.status === 'running'
              ? `后台抽取中 ${job.doneLessons}/${job.totalLessons} 课`
              : job.status === 'done'
                ? `抽取完成 ${job.doneLessons}/${job.totalLessons} 课`
                : job.status === 'cancelled'
                  ? `已取消（${job.doneLessons}/${job.totalLessons} 课已保存）`
                  : '抽取失败'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {job.status === 'running' && (
            <Button
              variant="ghost"
              size="sm"
              disabled={cancelJob.isPending}
              onClick={() => {
                sound.playClick();
                cancelJob.mutate(
                  { documentId, jobId: job.jobId },
                  { onError: (e) => toast.error(e instanceof Error ? e.message : '取消失败') }
                );
              }}
              className="gap-1 text-xs"
            >
              <XCircle className="w-3.5 h-3.5" />
              <span>取消</span>
            </Button>
          )}
          {job.status !== 'running' && failedIds.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              disabled={startJob.isPending}
              onClick={() => launch(failedIds)}
              className="gap-1 text-xs"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{startJob.isPending ? '启动中…' : `重试失败 ${failedIds.length} 课`}</span>
            </Button>
          )}
          {job.status !== 'running' && failedIds.length === 0 && pendingCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              disabled={startJob.isPending}
              onClick={() => launch()}
              className="gap-1 text-xs"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>继续抽剩余 {pendingCount} 课</span>
            </Button>
          )}
          {job.status !== 'running' && failedIds.length === 0 && pendingCount === 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                untrack(documentId);
              }}
              className="text-xs"
            >
              <span>收起</span>
            </Button>
          )}
        </div>
      </div>

      <Progress value={job.doneLessons} max={Math.max(job.totalLessons, 1)} />

      <div className="flex items-center justify-between text-[11px] text-stone-500 dark:text-stone-400">
        <span>
          {job.status === 'running' && job.currentLessonTitle
            ? `正在抽：${job.currentLessonTitle}`
            : `生词 ${job.vocabularies} · 文法 ${job.grammarPoints} · 丢弃可疑 ${job.dropped}`}
        </span>
        <span>{Math.round(pct * 100)}%</span>
      </div>

      {failedIds.length > 0 && (
        <div className="text-[11px] text-amber-700 dark:text-amber-400 space-y-0.5">
          {job.failed.map((f) => (
            <div key={f.lessonId}>
              {f.lessonTitle}：{f.error}
            </div>
          ))}
        </div>
      )}
      {job.status === 'failed' && job.error && (
        <div className="text-[11px] text-red-600 dark:text-red-400">{job.error}</div>
      )}
    </div>
  );
}
