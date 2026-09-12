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
import type { DailyPlanStep, DailyPlanStepKind } from '@study-studio/learner-core';
import { NumberTicker } from './magicui/index.js';
import { CourseRouteBanner } from './CourseRouteBanner.js';
import { Badge } from './ui/badge.js';
import { Button } from './ui/button.js';
import { Progress } from './ui/progress.js';
import { sound } from '../utils/audio.js';
import { useLearningShell } from '../hooks/useLearningShell.js';
import { useStudySessionStore } from '../stores/useStudySessionStore.js';
import { useCompletePlanStepMutation, useDailyPlanQuery } from '../queries/useLearnerQueries.js';

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

export function TodayPlanWorkbench() {
  const shell = useLearningShell();
  const { data: plan, isLoading, isError, refetch } = useDailyPlanQuery();
  const completeStep = useCompletePlanStepMutation();
  const setActiveTab = useStudySessionStore((s) => s.setActiveTab);
  const setCardFilter = useStudySessionStore((s) => s.setCardFilter);
  const setPlanIntent = useStudySessionStore((s) => s.setPlanIntent);

  const startStep = (step: DailyPlanStep) => {
    sound.playClick();
    setPlanIntent({
      stepId: step.id,
      kind: step.kind,
      title: step.title,
      skillId: step.skillId,
      skillName: step.skillName,
    });
    if (step.kind === 'NEW_WORDS') setCardFilter('VOCAB');
    if (step.kind === 'CARDS') setCardFilter('ALL');
    setActiveTab(step.navigateTo);
    toast.success(`已进入「${step.title}」`);
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

  const completed = plan?.completedCount ?? 0;
  const total = plan?.totalCount ?? 0;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const nextStep = plan?.steps.find((step) => !step.done);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5 max-w-3xl"
    >
      <div className="rounded-2xl border border-line-accent bg-paper-soft p-5 shadow-sm space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-wash-amber-500o15 border border-line-amber-500o30 text-ink-amber-900-amber-300 flex items-center justify-center">
              <CalendarCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold font-serif text-ink">
                今日学习
              </h2>
              <p className="text-xs text-ink-ghost mt-0.5">
                {shell.trackName}轨道 · 今天要做的 {total > 0 ? `${total} 件事，做完即达标` : '事项'}，每天按你的进度换新；都是现有模块的入口，不另起一套课程。
              </p>
            </div>
          </div>
          <Badge variant={percent >= 100 ? 'emerald' : 'amber'}>
            {plan?.planDate ?? '今日'}
          </Badge>
        </div>

        <div className="flex items-end justify-between gap-3">
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold font-mono text-accent-ink">
              <NumberTicker value={completed} />
            </span>
            <span className="text-xs text-ink-stone-500">/ {total} 步完成</span>
          </div>
          <span className="text-xs font-mono text-ink-stone-500">{percent}%</span>
        </div>
        <Progress value={percent} className="h-2" />
      </div>

      {isLoading && (
        <p className="text-xs text-ink-stone-500">正在生成今日计划…</p>
      )}
      <CourseRouteBanner />
      {isError && (
        <div className="rounded-2xl border border-line-rose-500o20 bg-wash-rose-500o5 p-4 text-xs text-ink-rose-800-rose-200">
          暂时无法读取今日计划。
          <Button variant="ghost" size="sm" className="ml-2" onClick={() => void refetch()}>
            重试
          </Button>
        </div>
      )}

      {plan && (
        <ol className="space-y-3">
          {plan.steps.map((step, index) => {
            const Icon = STEP_ICONS[step.kind];
            const isNext = nextStep?.id === step.id;
            return (
              <li
                key={step.id}
                className={`rounded-2xl border p-4 shadow-xs ${
                  step.done
                    ? 'border-line-emerald-500o20 bg-wash-emerald-500o5'
                    : isNext
                      ? 'border-line-amber-500o30 bg-wash-amber-500o8'
                      : 'border-line-accent bg-veil-paper-70'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                      step.done
                        ? 'bg-tone-emerald-500o15 border-line-emerald-500o30 text-ink-emerald-700-emerald-300'
                        : 'bg-wash-amber-500o15 border-line-amber-500o30 text-ink-amber-900-amber-300'
                    }`}
                  >
                    {step.done ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-mono text-ink-stone-400">{index + 1}</span>
                      <h3 className="text-sm font-bold text-ink">
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
                    <p className="text-xs text-ink-ghost">{step.summary}</p>
                    <p className="text-[11px] font-mono text-ink-stone-400">
                      {step.currentCount}/{step.targetCount ?? 1}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => startStep(step)} className="gap-1.5">
                        {step.done ? '再练一次' : '开始'}
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Button>
                      {!step.done && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={completeStep.isPending}
                          onClick={() => markDone(step)}
                        >
                          记录已完成活动
                        </Button>
                      )}
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
