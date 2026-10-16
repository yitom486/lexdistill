import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Award } from 'lucide-react';
import { StudyStreakHeatmap } from './StudyStreakHeatmap.js';
import { LevelCard } from './LevelCard.js';
import { EncounteredTermsHeat } from './EncounteredTermsHeat.js';
import { sound } from '../utils/audio.js';
import { useStudySessionStore } from '../stores/useStudySessionStore.js';
import { useUserProfileStore } from '../stores/useUserProfileStore.js';
import { useLearningShell } from '../hooks/useLearningShell.js';
import { summarizeLearningEvidence, type SkillMetric } from '@study-studio/learner-core';
import type { StudyCardItem, MistakeNotebookItem } from '../models/learning.js';
import { Tabs, TabsList, TabsTrigger, TabsIndicator } from './ui/tabs.js';
import { Button } from './ui/button.js';
import { Progress } from './ui/progress.js';
import { Badge } from './ui/badge.js';
import { NextStepStrip, type NextStep } from './learner-dashboard/NextStepStrip.js';
import { EvidenceOverview } from './learner-dashboard/EvidenceOverview.js';
import { sourceKind } from './learner-dashboard/source-view.js';

/** 查询快照：App 透传同 queryKey 的真实查询结果，展示层只读状态派生视图。 */
export interface RadarQuerySnapshot<T> {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => void;
}

interface LearnerRadarDashboardProps {
  cardsQuery: RadarQuerySnapshot<StudyCardItem[]>;
  mistakesQuery: RadarQuerySnapshot<MistakeNotebookItem[]>;
  metricsQuery: RadarQuerySnapshot<SkillMetric[]>;
}

export function LearnerRadarDashboard({
  cardsQuery,
  mistakesQuery,
  metricsQuery,
}: LearnerRadarDashboardProps) {
  const [metricDimension, setMetricDimension] = useState<string>('ALL');
  const setActiveTab = useStudySessionStore((s) => s.setActiveTab);
  const profile = useUserProfileStore((s) => s.profile);
  const shell = useLearningShell();

  const cards = cardsQuery.data;
  const mistakes = mistakesQuery.data;
  const metrics = metricsQuery.data;
  const cardsView = sourceKind(cards, cardsQuery.isLoading, cardsQuery.isError);
  const mistakesView = sourceKind(mistakes, mistakesQuery.isLoading, mistakesQuery.isError);
  const metricsView = sourceKind(metrics, metricsQuery.isLoading, metricsQuery.isError);
  const cardsStale = cardsQuery.isError && cards !== undefined;
  const mistakesStale = mistakesQuery.isError && mistakes !== undefined;
  const metricsStale = metricsQuery.isError && metrics !== undefined;

  // 前端防御层：严禁非日语轨道混入 jp.* 日语技能，反之亦然
  const displayMetrics = useMemo<SkillMetric[]>(() => {
    return (metrics ?? []).filter((m: SkillMetric) => {
      if (shell.track !== 'ja' && m.id.startsWith('jp.')) return false;
      if (shell.track !== 'en' && m.id.startsWith('en.')) return false;
      if (shell.track !== 'ko' && m.id.startsWith('ko.')) return false;
      return true;
    });
  }, [metrics, shell.track]);

  const evidence = summarizeLearningEvidence(displayMetrics, shell.track);
  const practicePercent = evidence.accuracy === null ? null : Math.round(evidence.accuracy * 100);
  const unresolved = (mistakes ?? []).filter((m) => !m.isResolved).length;
  const nowIso = new Date().toISOString();
  const dueCards = (cards ?? []).filter((c) => !c.dueAt || c.dueAt <= nowIso).length;

  // 下一步：只用已就绪来源的真实计数排优先级，无依据时不渲染
  let nextStep: NextStep | null = null;
  if (mistakesView === 'ready' && unresolved > 0) {
    nextStep = { text: `错题本还有 ${unresolved} 道待攻克`, cta: '去清错题', tab: 'MISTAKES' };
  } else if (cardsView === 'ready' && dueCards > 0) {
    nextStep = { text: `${dueCards} 张闪卡到期待复习`, cta: '去复习闪卡', tab: 'CARDS' };
  } else if ((metricsView === 'ready' || metricsView === 'empty') && evidence.status === 'unassessed') {
    nextStep = { text: '从一次自适应做题开始建立画像', cta: '去做题', tab: 'QUIZ' };
  } else if (metricsView === 'ready' && cardsView === 'ready' && mistakesView === 'ready') {
    nextStep = { text: '保持节奏，今日复习见今日计划', cta: '去今日学习', tab: 'TODAY' };
  }
  if (nextStep && ((nextStep.tab === 'MISTAKES' && mistakesStale) ||
    (nextStep.tab === 'CARDS' && cardsStale) || (nextStep.tab === 'QUIZ' && metricsStale))) {
    nextStep = { ...nextStep, text: `按上次记录：${nextStep.text}` };
  }

  const dimensionCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: displayMetrics.length };
    for (const m of displayMetrics) {
      counts[m.dimension] = (counts[m.dimension] ?? 0) + 1;
    }
    return counts;
  }, [displayMetrics]);

  const visibleMetrics = displayMetrics.filter(
    (m: SkillMetric) => metricDimension === 'ALL' || m.dimension === metricDimension
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 max-w-4xl"
    >
      {/* 档位状态机：当前档 + 升级提示 + 定级考 */}
      <LevelCard />

      {/* 下一步：真实证据支撑的单个动作 */}
      <NextStepStrip step={nextStep} />

      {/* 学情证据：正确率主卡 + 闪卡/错题独立状态 */}
      <EvidenceOverview
        metricsView={metricsView}
        metricsStale={metricsStale}
        practiceSummary={metrics === undefined ? '练习记录尚未读取，未测能力保持未知' : evidence.attempts > 0 ? `${evidence.correct}/${evidence.attempts} 次答对 · ${evidence.observedSkillCount} 个已练技能；不代表整体水平` : '尚无有效练习记录，未测能力保持未知'}
        practicePercent={practicePercent}
        observedSkillCount={evidence.observedSkillCount}
        onRefetchMetrics={() => void metricsQuery.refetch()}
        cardsView={cardsView}
        cardsStale={cardsStale}
        cardCount={cards?.length ?? 0}
        retentionLine={profile.totalCardsReviewed > 0 ? ` · 本地累计复习 ${profile.totalCardsReviewed} 次` : ' · 本地尚无复习记录'}
        onRefetchCards={() => void cardsQuery.refetch()}
        mistakesView={mistakesView}
        mistakesStale={mistakesStale}
        unresolved={unresolved}
        mistakesLine={unresolved === 0 && (mistakes?.length ?? 0) > 0 ? '项 · 已全部攻克' : '项待清零'}
        onRefetchMistakes={() => void mistakesQuery.refetch()}
      />

      {/* 连续学习与 28 天热力图组件 */}
      <StudyStreakHeatmap />

      {/* 相遇词热力 */}
      <EncounteredTermsHeat />

      {/* 掌握度细项雷达 */}
      <div className="surface-card rounded-2xl p-5 border border-line-hairline shadow-inner-hi space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-ink-mute flex items-center gap-2">
            <Award className="w-4 h-4 text-gold-warm" />
            {shell.trackName}技能画像 ({shell.copy.levelSchemeLabel})
          </h3>
          <Tabs
            value={metricDimension}
            onValueChange={(val) => {
              if (!val) return;
              setMetricDimension(val);
            }}
          >
            <TabsList className="bg-transparent p-0 border-0 gap-1">
              <TabsIndicator className="bg-gold-warm shadow-sm" />
              {[
                { key: 'ALL', label: '全部' },
                { key: 'GRAMMAR', label: '文法' },
                { key: 'VOCABULARY', label: '词汇' },
                { key: 'LISTENING', label: '听力' },
                { key: 'NUANCE_PRAGMATIC', label: '语感' },
              ].map(({ key, label }) => {
                const count = dimensionCounts[key] ?? 0;
                return (
                  <TabsTrigger
                    key={key}
                    value={key}
                    className="px-2.5 py-1 text-xs aria-selected:text-tone-stone-950 aria-selected:font-bold"
                  >
                    {label}
                    {count > 0 && (
                      <span className="ml-1 font-mono text-xs opacity-75">
                        {count}
                      </span>
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
        </div>

        {metricsView === 'loading' && (
          <p className="text-xs text-ink-faint-soft">正在读取技能画像…</p>
        )}
        {metricsView === 'error' && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line-rose-500o20 bg-wash-rose-500o5 p-4">
            <p className="text-xs text-ink-rose-600-rose-400">技能画像读取失败。</p>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void metricsQuery.refetch()}>
              重试
            </Button>
          </div>
        )}
        {(metricsView === 'ready' || metricsView === 'empty') && visibleMetrics.length === 0 ? (
          <div className="py-8 px-4 text-center rounded-xl bg-veil-stone-100o50-stone-900o30 border border-dashed border-line-hairline">
            <p className="text-xs text-ink-ghost mb-2.5">
              {shell.copy.emptySkillsHint}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                sound.playClick();
                setActiveTab('QUIZ');
              }}
              className="text-xs font-semibold"
            >
              前往自适应做题 →
            </Button>
          </div>
        ) : (metricsView === 'ready' || metricsView === 'empty') && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {visibleMetrics.map((metric: SkillMetric) => {
              const isAssessed = metric.totalAttempts > 0;
              const isWeak = isAssessed && metric.proficiency < 0.6;
              const isStrong = isAssessed && metric.proficiency >= 0.85;

              return (
                <div
                  key={metric.id}
                  className="p-4 rounded-xl bg-veil-stone-100o70-stone-900o50 border border-line-hairline space-y-2"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-ink-soft">
                      {metric.name}
                    </span>
                    <Badge
                      variant={isStrong ? 'emerald' : isWeak ? 'destructive' : 'gold'}
                      className="rounded font-mono"
                    >
                      {isAssessed ? `${Math.round(metric.proficiency * 100)}%` : '待练习'}
                    </Badge>
                  </div>

                  {isAssessed && <Progress
                    value={metric.proficiency * 100}
                    indicatorClassName={
                      isStrong ? 'bg-tone-emerald-500' : isWeak ? 'bg-tone-rose-500' : 'bg-gold-warm'
                    }
                  />}

                  <div className="flex justify-between items-center text-xs text-ink-faint pt-1">
                    <span>总练习 {metric.totalAttempts} 次 · 连续错误 {metric.consecutiveErrors} 次</span>
                    {isWeak && (
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => {
                          sound.playClick();
                          setActiveTab('QUIZ');
                        }}
                        className="h-auto p-0 text-xs font-bold text-gold-warm hover:underline"
                      >
                        去做题 →
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </motion.div>
  );
}
