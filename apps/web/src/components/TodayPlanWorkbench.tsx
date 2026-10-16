import React from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  CalendarCheck,
  CheckCircle2,
  ArrowRight,
  BookPlus,
  Layers,
  Sparkles,
  Newspaper,
  Zap,
  AlertTriangle,
  ClipboardList,
  AudioLines,
} from 'lucide-react';
import type { DailyPlanStep, DailyPlanStepKind } from '@lexdistill/learner-core';
import { NumberTicker } from './magicui/index.js';
import { CourseRouteBanner } from './CourseRouteBanner.js';
import { PlanSyncNote } from './today-plan/PlanSyncNote.js';
import { Badge } from './ui/badge.js';
import { Button } from './ui/button.js';
import { Progress } from './ui/progress.js';
import { cn } from '../lib/utils.js';
import { sound } from '../utils/audio.js';
import { useLearningShell } from '../hooks/useLearningShell.js';
import { useStudySessionStore } from '../stores/useStudySessionStore.js';
import { useCompletePlanStepMutation, useDailyPlanQuery, useCourseRouteQuery } from '../queries/useLearnerQueries.js';

const STEP_ICONS: Record<DailyPlanStepKind, typeof Layers> = {
  NEW_WORDS: BookPlus,
  CARDS: Layers,
  GRAMMAR: Sparkles,
  READING: Newspaper,
  QUIZ: Zap,
  MISTAKES: AlertTriangle,
  PRACTICE_PLAN: ClipboardList,
  ALPHABET: AudioLines,
};

const STEP_KIND_LABEL: Record<DailyPlanStepKind, string> = {
  NEW_WORDS: '生词',
  CARDS: '闪卡',
  GRAMMAR: '语法',
  READING: '阅读',
  QUIZ: '测验',
  MISTAKES: '错题',
  PRACTICE_PLAN: '计划',
  ALPHABET: '发音',
};

/**
 * 每日研习早报（Daily Study Gazette）：
 * Hero 晨报（二合一：今日成就 + 学程里程碑内嵌）与研习节点时间轴。
 * 全屏仅下一步拥有 Primary 金按钮；其余为次级描边；已完成为静默链接。
 */
export function TodayPlanWorkbench() {
  const shell = useLearningShell();
  const { data: plan, isLoading, isError, isFetching, refetch } = useDailyPlanQuery();
  // 同 queryKey 命中 TanStack 缓存，无额外请求；仅决定 Hero 单/双栏
  const { data: route } = useCourseRouteQuery();
  const hasRoute = !!route && route.units.length > 0;
  const completeStep = useCompletePlanStepMutation();
  const startPlanStep = useStudySessionStore((s) => s.startPlanStep);

  const startStep = (step: DailyPlanStep) => {
    sound.playClick();
    startPlanStep(step);
  };

  const markDone = (step: DailyPlanStep) => {
    sound.playClick();
    completeStep.mutate(
      {
        stepId: step.id,
        ...(plan?.planDate ? { date: plan.planDate } : {}),
      },
      {
        onSuccess: () => toast.success(`已勾选「${step.title}」`),
        onError: (error) =>
          toast.error(error instanceof Error ? error.message : '暂时无法标记完成'),
      }
    );
  };

  const hasPlan = plan !== null && plan !== undefined;
  // 状态矩阵（只读 query 状态，不自建 loading 机，不改缓存/重试策略）：
  // 首读中 / 无数据失败 / 成功为空 / 后台刷新中 / 刷新失败但有缓存
  const firstLoading = isLoading && !hasPlan;
  const fatalError = isError && !hasPlan;
  const emptyPlan = (plan?.totalCount ?? -1) === 0 || (plan?.steps.length ?? -1) === 0;
  const stale = isError && hasPlan;
  const refreshing = isFetching && hasPlan && !isError;

  const completed = plan?.completedCount ?? 0;
  const total = plan?.totalCount ?? 0;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const nextStep = plan?.steps.find((step) => !step.done);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5 w-full max-w-5xl"
    >
      {/* 二合一 Hero 晨报：宽屏双栏（成就左 / 里程碑右） */}
      <div className="surface-card rounded-2xl p-5 sm:p-6 relative overflow-hidden">
        <div className={cn('grid gap-5 lg:gap-6', hasRoute && 'lg:grid-cols-[1.05fr_1fr]')}>
          <div className="space-y-4 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3.5">
                <div className="surface-elevated w-10 h-10 rounded-xl flex items-center justify-center shrink-0">
                  <CalendarCheck className="w-5 h-5 text-gold-warm" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold font-serif text-ink tracking-tight">
                    今日研习计划
                  </h2>
                  <p className="text-xs text-ink-ghost mt-0.5 leading-relaxed">
                    {shell.trackName}轨道 · 依据认知遗忘曲线与课程解锁进度动态编排
                  </p>
                </div>
              </div>
              <Badge variant={percent >= 100 ? 'emerald' : 'amber'} className="font-mono text-xs shrink-0">
                {plan?.planDate ?? '今日'}
              </Badge>
            </div>

            <div className="flex items-end justify-between gap-3">
              {hasPlan && !emptyPlan ? (
                <>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-3xl sm:text-4xl font-bold font-mono text-accent-ink tracking-tight">
                      <NumberTicker value={completed} />
                    </span>
                    <span className="text-xs text-ink-stone-500 font-medium">/ {total} 步已达成</span>
                  </div>
                  <span className="text-xs font-mono font-semibold text-ink-stone-500">{percent}%</span>
                </>
              ) : (
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl sm:text-4xl font-bold font-mono text-ink-faint-soft tracking-tight">
                    —
                  </span>
                  <span className="text-xs text-ink-stone-500 font-medium">
                    {emptyPlan ? '今日暂无安排' : '计划暂未读取'}
                  </span>
                </div>
              )}
            </div>
            {/* 数值进度只在确有有效非空计划时渲染；未知/失败/成功空不暴露假零。
                侧栏本地目标进度不受影响。 */}
            {hasPlan && !emptyPlan && (
              <Progress value={percent} className="h-1" indicatorClassName="bg-gold-warm" />
            )}
            <PlanSyncNote refreshing={refreshing} stale={stale} onRetry={() => void refetch()} />
          </div>

          <CourseRouteBanner className="lg:border-t-0 lg:border-l lg:pt-1 lg:pl-5" />
        </div>
      </div>

      {firstLoading && (
        <p className="text-xs text-ink-stone-500">正在生成今日计划…</p>
      )}
      {fatalError && (
        <div className="rounded-2xl border border-line-rose-500o20 bg-wash-rose-500o5 p-4 text-xs text-ink-rose-800-rose-200">
          暂时无法读取今日计划。
          <Button variant="ghost" size="sm" className="ml-2" onClick={() => void refetch()}>
            重试
          </Button>
        </div>
      )}

      {emptyPlan && (
        <p className="text-xs text-ink-faint-soft rounded-2xl border border-line-hairline p-4">
          今日暂无待办，完成日常复习即可。
        </p>
      )}

      {plan && !emptyPlan && plan.steps.length > 0 && (
        <p className="font-mono text-[10px] tracking-wider uppercase text-ink-stone-400 font-semibold px-1">
          研习节点 · {total} 项
        </p>
      )}

      {plan && !emptyPlan && (
        <ol className="-mt-3 space-y-1.5">
          {plan.steps.map((step, index) => {
            const Icon = STEP_ICONS[step.kind];
            const isNext = nextStep?.id === step.id;
            const isLast = index === plan.steps.length - 1;
            return (
              <li key={step.id} className="relative flex gap-3">
                <div aria-hidden className="flex flex-col items-center shrink-0 w-7 pt-4">
                  <span className="font-mono text-[11px] font-bold text-ink-faint-soft leading-none">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  {!isLast && <span className="w-px flex-1 mt-1.5 bg-line-hairline" />}
                </div>
                <div
                  className={cn(
                    'flex-1 min-w-0 rounded-xl p-3.5 sm:p-4 transition-all duration-[var(--motion-card-hover-duration)]',
                    step.done
                      ? 'border border-line-emerald-500o20 bg-wash-emerald-500o5'
                      : 'surface-card surface-card-hover'
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        'w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border',
                        step.done
                          ? 'bg-tone-emerald-500o15 border-line-emerald-500o30 text-ink-emerald-700-emerald-300'
                          : isNext
                            ? 'bg-gold-warm/10 border-gold-warm/30 text-gold-warm'
                            : 'bg-surface-coal border-line-hairline text-ink-faint-soft'
                      )}
                    >
                      {step.done ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold text-ink">
                          {step.title}
                        </h3>
                        {step.done && (
                          <Badge variant="emerald" className="text-[10px] px-1.5 py-0">
                            已完成
                          </Badge>
                        )}
                        {isNext && !step.done && (
                          <Badge variant="amber" className="text-[10px] px-1.5 py-0">
                            下一步
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-ink-ghost leading-relaxed">{step.summary}</p>
                      <p className="text-[11px] font-mono text-ink-faint-soft">
                        {STEP_KIND_LABEL[step.kind]} · {step.progressText ?? `${step.currentCount}/${step.targetCount ?? 1}`}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        {step.done ? (
                          <button
                            type="button"
                            onClick={() => startStep(step)}
                            className="text-[11px] text-ink-faint-soft hover:text-gold-warm underline-offset-4 hover:underline transition-colors cursor-pointer"
                          >
                            再练一次
                          </button>
                        ) : isNext ? (
                          <button
                            type="button"
                            onClick={() => startStep(step)}
                            className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-xs font-bold bg-gold-warm text-tone-stone-950 transition-all cursor-pointer active:scale-[0.98] hover:shadow-[0_0_16px_0_var(--line-glow-hover)]"
                          >
                            开始
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startStep(step)}
                            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium border border-line-hairline text-ink-faint-soft hover:text-ink hover:border-gold-warm/40 hover:bg-surface-coal/60 transition-all cursor-pointer active:scale-[0.98]"
                          >
                            开始
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {!step.done && !step.courseUnitId && (
                          <button
                            type="button"
                            disabled={completeStep.isPending}
                            onClick={() => markDone(step)}
                            className="h-7 px-2.5 rounded-lg text-[11px] text-ink-faint-soft hover:text-ink border border-transparent hover:border-line-hairline hover:bg-surface-coal/60 transition-colors cursor-pointer disabled:opacity-50"
                          >
                            记录已完成活动
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </motion.div>
  );
}
