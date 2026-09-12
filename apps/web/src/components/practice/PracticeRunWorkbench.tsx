import React, { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { PracticeRunner, type PracticeRunnerItem } from './PracticeRunner.js';
import { useStudySessionStore } from '../../stores/useStudySessionStore.js';
import { useLessonStore } from '../../stores/useLessonStore.js';
import { usePracticeRunSummaryQuery } from '../../queries/useLearnerQueries.js';
import {
  useAssemblePracticeRunMutation,
  usePracticeRunItemsQuery,
  usePracticeRunQuery,
} from '../../queries/useLearnerQueries.js';

/** P5：练习运行工作台。装配题目 -> 加载 -> 渲染 PracticeRunner；断点恢复。 */

interface PracticeRunWorkbenchProps {
  runId: string;
  userId: string;
  language: 'en' | 'ja' | 'ko';
  onCompleted?: () => void;
  onExit?: () => void;
}

export function PracticeRunWorkbench({ runId, userId, language, onCompleted, onExit }: PracticeRunWorkbenchProps) {
  const assemble = useAssemblePracticeRunMutation(userId);
  const itemsQuery = usePracticeRunItemsQuery(runId, userId);
  const runQuery = usePracticeRunQuery(runId, userId);

  // 进入时若尚无题目，自动装配一次：订阅查询 settled 状态，
  // 区分“失败/空数组”，且每个 runId 只自动尝试一次；失败后由用户手动重试。
  const assembleAttempted = useRef<string | null>(null);
  const itemsSettled = itemsQuery.isSuccess || itemsQuery.isError;
  const itemsCount = itemsQuery.data?.length ?? 0;
  const shouldAutoAssemble =
    Boolean(runId) && itemsSettled && !itemsQuery.isError && itemsCount === 0 &&
    assembleAttempted.current !== runId && !assemble.isPending;
  useEffect(() => {
    if (!shouldAutoAssemble) return;
    assembleAttempted.current = runId;
    assemble.mutate(runId, {
        onSuccess: (data) => {
          const skipped = data.skippedBlocks ?? [];
          if (skipped.length === 0) {
            toast.success('已装配练习题目');
          } else if (skipped.some((b) => b.reason === 'NEED_STUDY')) {
            // M2 学习门：新词没讲透，一个都不给，先去讲透。
            toast.warning('有新词还没讲透：先去生词闪卡把它们学透，再回来练', { duration: 6000 });
          } else if (skipped.some((b) => b.reason === 'NEED_LESSON')) {
            // 先讲后测：讲义没学完，一个都不给，先去学讲义（弹窗可直接开）。
            toast.warning('这类题的讲义还没学完：点「去学语法讲义」，学完自动解锁', {
              duration: 6000,
            });
          } else {
            toast.warning(`已装配题目，但 ${skipped.length} 个练习块暂无可用题被跳过`);
          }
        },
        onError: (e) => toast.error('装配题目失败：' + e.message),
      });
  }, [shouldAutoAssemble, runId, assemble]);

  const items: PracticeRunnerItem[] = (itemsQuery.data ?? []).map((d) => ({
    itemId: d.itemId,
    blockId: d.blockId,
    question: d.question,
    gradingMode: d.gradingMode,
  }));

  const attempts = runQuery.data?.attempts ?? [];
  const runStatus = runQuery.data?.run?.status;
  const summaryQuery = usePracticeRunSummaryQuery(runStatus === 'COMPLETED' ? runId : null, userId);

  if (assemble.isPending || itemsQuery.isLoading || runQuery.isLoading) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-ink-slate-500">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="text-sm">正在装配练习题目…</span>
      </div>
    );
  }

  if (itemsQuery.isError) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-ink-slate-500">
        <span className="text-sm">题目加载失败：{(itemsQuery.error as Error).message}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => itemsQuery.refetch()}>重试</Button>
          {onExit && <Button variant="ghost" size="sm" onClick={onExit}>返回</Button>}
        </div>
      </div>
    );
  }

  if (runQuery.isError) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-ink-slate-500">
        <span className="text-sm">运行记录加载失败：{(runQuery.error as Error).message}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => runQuery.refetch()}>重试</Button>
          {onExit && <Button variant="ghost" size="sm" onClick={onExit}>返回</Button>}
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    const assembleFailed = assemble.isError;
    const needStudy = (assemble.data?.skippedBlocks ?? []).some((b) => b.reason === 'NEED_STUDY');
    const needLesson = (assemble.data?.skippedBlocks ?? []).some(
      (b) => b.reason === 'NEED_LESSON'
    );
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-ink-slate-500">
        <Sparkles className="h-6 w-6" />
        <span className="text-sm">
          {assembleFailed
            ? `题目装配失败：${(assemble.error as Error).message}`
            : needStudy
              ? '新词还没讲透，一个都没放进练习池。先去生词闪卡把它们学透再回来。'
              : needLesson
                ? '这类题的讲义还没学完：先花 2 分钟学完讲义，学完自动解锁，再回来练。'
                : '该运行暂无可用题目（可能练习块暂无可用题）。'}
        </span>
        <div className="flex gap-2">
          {needStudy ? (
            <Button
              size="sm"
              onClick={() => {
                useStudySessionStore.getState().setActiveTab('CARDS');
                onExit?.();
              }}
            >
              去生词闪卡讲透 →
            </Button>
          ) : needLesson ? (
            <Button
              size="sm"
              onClick={() => {
                useLessonStore.getState().openLesson(null);
              }}
            >
              去学语法讲义 →
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={assemble.isPending}
              onClick={() => {
                assembleAttempted.current = null;
                assemble.mutate(runId);
              }}
            >
              {assemble.isPending ? '装配中…' : '重新装配'}
            </Button>
          )}
          {onExit && <Button variant="ghost" size="sm" onClick={onExit}>返回</Button>}
        </div>
      </div>
    );
  }

  // 完成后复盘视图：COMPLETED 后等待 summary 时展示加载态，失败时可重试，不回退到练习界面
  if (runStatus === 'COMPLETED') {
    if (summaryQuery.isLoading) {
      return (
        <div className="flex flex-col items-center gap-3 py-12 text-ink-slate-500">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-sm">正在生成练习复盘…</span>
        </div>
      );
    }
    if (summaryQuery.isError) {
      return (
        <div className="flex flex-col items-center gap-3 py-12 text-ink-slate-500">
          <span className="text-sm">复盘加载失败：{(summaryQuery.error as Error).message}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => summaryQuery.refetch()}>重试</Button>
            {onExit && <Button variant="ghost" size="sm" onClick={onExit}>返回计划</Button>}
          </div>
        </div>
      );
    }
    const s = summaryQuery.data;
    if (!s) {
      return (
        <div className="flex flex-col items-center gap-3 py-12 text-ink-slate-500">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-sm">正在生成练习复盘…</span>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">练习复盘</h2>
          {onExit && <Button variant="ghost" size="sm" onClick={onExit}>返回计划</Button>}
        </div>
        <div className="rounded-md border border-line-slate-200-slate-700 p-4">
          <div className="mb-2 flex items-center gap-2">
            <Badge variant={s.source === 'ai' ? 'default' : 'secondary'}>{s.source === 'ai' ? 'AI 汇总' : '本地规则汇总'}</Badge>
            <span className="text-xs text-ink-slate-500">{s.generatedAt}</span>
          </div>
          <p className="text-sm">{s.summary}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-ink-slate-600-slate-300">
            <span>已提交 {s.submittedCount}/{s.totalItems}</span>
            <span>已批改 {s.gradedCount}</span>
            <span>正确 {s.correctCount}</span>
            <span>平均分 {s.averageScore}</span>
          </div>
          {s.commonIssues.length > 0 && (
            <div className="mt-3">
              <h4 className="text-xs font-semibold">共性问题</h4>
              <ul className="ml-4 list-disc text-xs text-ink-slate-600-slate-300">
                {s.commonIssues.map((iss) => <li key={iss}>{iss}</li>)}
              </ul>
            </div>
          )}
          <div className="mt-3">
            <h4 className="text-xs font-semibold">下次建议</h4>
            <ul className="ml-4 list-disc text-xs text-ink-slate-600-slate-300">
              {s.nextPlanSuggestions.map((sg, i) => <li key={i}>{sg}</li>)}
            </ul>
          </div>
          {s.failureReason && (
            <p className="mt-3 text-xs text-tone-amber-600">模型不可用已回退本地规则：{s.failureReason}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">练习运行</h2>
        {onExit && <Button variant="ghost" size="sm" onClick={onExit}>返回计划</Button>}
      </div>
      <PracticeRunner
        key={`${userId}:${runId}`}
        runId={runId}
        userId={userId}
        items={items}
        attempts={attempts}
        language={language}
        onCompleted={onCompleted}
      />
    </div>
  );
}
