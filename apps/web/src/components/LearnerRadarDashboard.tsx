import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Award, Layers, AlertTriangle, Flame } from 'lucide-react';
import { BentoGrid, BentoCard, NumberTicker } from './magicui/index.js';
import { StudyStreakHeatmap } from './StudyStreakHeatmap.js';
import { LevelCard } from './LevelCard.js';
import { sound } from '../utils/audio.js';
import { useStudySessionStore } from '../stores/useStudySessionStore.js';
import { useUserProfileStore } from '../stores/useUserProfileStore.js';
import { useLearningShell } from '../hooks/useLearningShell.js';
import { summarizeLearningEvidence, type SkillMetric } from '@study-studio/learner-core';
import { useEncounteredTermsQuery, useBackfillEncounteredTermsMutation } from '../queries/useLearnerQueries.js';
import { Tabs, TabsList, TabsTrigger, TabsIndicator } from './ui/tabs.js';
import { Button } from './ui/button.js';
import { Progress } from './ui/progress.js';
import { Badge } from './ui/badge.js';

interface LearnerRadarDashboardProps {
  metrics: SkillMetric[];
  activeCardsCount: number;
  unresolvedMistakesCount: number;
}

/** 相遇词热力：查词/收藏中真实见过的词，按相遇次数排序；点词跳生词本。 */
function EncounteredTermsHeat() {
  const shell = useLearningShell();
  const setActiveTab = useStudySessionStore((s) => s.setActiveTab);
  const { data: terms = [], isLoading } = useEncounteredTermsQuery(shell.track, 50);
  const backfill = useBackfillEncounteredTermsMutation(shell.track);
  const top = [...terms].sort((a, b) => b.exposureCount - a.exposureCount).slice(0, 12);

  return (
    <div className="bg-paper-soft rounded-2xl p-5 border border-line-accent shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink-mute flex items-center gap-2">
          <Flame className="w-4 h-4 text-accent-ink" />
          相遇词热力（{terms.length}）
        </h3>
        <span className="text-[11px] text-ink-stone-400">查过/收过的词，见得越多越热 · 点词去生词本</span>
      </div>
      {isLoading ? (
        <p className="text-xs text-ink-stone-400">加载中…</p>
      ) : top.length === 0 ? (
        <div className="py-4 px-4 text-center rounded-xl bg-veil-stone-100o50-stone-900o30 border border-dashed border-line-soft space-y-2">
          <p className="text-xs text-ink-ghost">
            还没有相遇词——去生词闪卡查第一个词，这里就会热起来
          </p>
          <div className="flex items-center justify-center gap-2">
            <Button
              size="sm"
              onClick={() => {
                sound.playClick();
                setActiveTab('CARDS');
              }}
              className="text-xs font-semibold"
            >
              去查第一个词 →
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={backfill.isPending}
              onClick={() => {
                sound.playClick();
                backfill.mutate(undefined, {
                  onSuccess: (r) => {
                    sound.playCorrect();
                    toast.success(`已点亮 ${r.terms} 个相遇词`);
                  },
                  onError: (e) => {
                    sound.playMistake();
                    toast.error(e instanceof Error ? e.message : '回填失败');
                  },
                });
              }}
              className="text-xs"
              title="以前查过的词，一键倒进热力"
            >
              {backfill.isPending ? '点亮中…' : '从查词历史点亮'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {top.map((t) => (
            <button
              key={t.termKey}
              type="button"
              title={`${t.headword}${t.reading ? `（${t.reading}）` : ''} · 相遇 ${t.exposureCount} 次 · ${t.status === 'collected' ? '已收藏' : '见过'}`}
              onClick={() => {
                sound.playClick();
                setActiveTab('CARDS');
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-xs font-semibold cursor-pointer transition-colors border-line-amber-500o30 bg-wash-amber-500o5 hover:bg-wash-amber-500o15 text-ink-mute-deep"
            >
              <span>{t.headword}</span>
              <span className="font-mono text-[10px] text-accent-ink">
                ×{t.exposureCount}
              </span>
              {t.status === 'collected' && (
                <span className="w-1.5 h-1.5 rounded-full bg-tone-emerald-500" title="已收藏" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function LearnerRadarDashboard({
  metrics,
  activeCardsCount,
  unresolvedMistakesCount,
}: LearnerRadarDashboardProps) {
  const [metricDimension, setMetricDimension] = useState<string>('ALL');
  const setActiveTab = useStudySessionStore((s) => s.setActiveTab);
  const profile = useUserProfileStore((s) => s.profile);
  const shell = useLearningShell();

  // 前端防御层：严禁非日语轨道混入 jp.* 日语技能，反之亦然
  const displayMetrics = useMemo<SkillMetric[]>(() => {
    return metrics.filter((m: SkillMetric) => {
      if (shell.track !== 'ja' && m.id.startsWith('jp.')) return false;
      if (shell.track !== 'en' && m.id.startsWith('en.')) return false;
      if (shell.track !== 'ko' && m.id.startsWith('ko.')) return false;
      return true;
    });
  }, [metrics, shell.track]);

  const evidence = summarizeLearningEvidence(displayMetrics, shell.track);
  const practicePercent = evidence.accuracy === null ? null : Math.round(evidence.accuracy * 100);
  const retentionPercent = Math.round((profile.retentionRate || 0) * 100);

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

      {/* Magic UI BentoGrid 核心概览指标 */}
      <BentoGrid className="auto-rows-[9.5rem] md:grid-cols-3">
        <BentoCard
          name="已练内容正确率"
          Icon={Award}
          description={evidence.attempts > 0 ? `${evidence.correct}/${evidence.attempts} 次答对 · ${evidence.observedSkillCount} 个已练技能；不代表整体水平` : '尚无有效练习记录，未测能力保持未知'}
        >
          <div className="flex items-baseline gap-1 pt-1">
            <span className="text-3xl font-bold font-mono text-accent-ink">
              {practicePercent === null ? '待评测' : <><NumberTicker value={practicePercent} />%</>}
            </span>
            <span className="text-xs text-ink-emerald-600-emerald-400 font-semibold">
              累计记录
            </span>
          </div>
        </BentoCard>

        <BentoCard
          name="FSRS 记忆卡片库"
          Icon={Layers}
          description="4 级抗遗忘间隔重复智能调度"
        >
          <div className="flex items-baseline gap-1 pt-1">
            <span className="text-3xl font-bold font-mono text-accent-ink">
              <NumberTicker value={activeCardsCount} />
            </span>
            <span className="text-xs text-ink-ghost">
              {profile.totalCardsReviewed > 0
                ? `张活跃卡片 · 稳固率 ${retentionPercent}%`
                : '张卡片 · 待开始复习'}
            </span>
          </div>
        </BentoCard>

        <BentoCard
          name="待攻克疑难痛点"
          Icon={AlertTriangle}
          description={shell.copy.targetWeaknessLabel}
        >
          <div className="flex items-baseline gap-1 pt-1">
            <span className="text-3xl font-bold font-mono text-ink-rose-600-rose-400">
              <NumberTicker value={unresolvedMistakesCount} />
            </span>
            <span className="text-xs text-ink-ghost">项弱点待清零</span>
          </div>
        </BentoCard>
      </BentoGrid>

      {/* 连续学习与 28 天热力图组件 */}
      <StudyStreakHeatmap />

      {/* 相遇词热力 */}
      <EncounteredTermsHeat />

      {/* 掌握度细项雷达 */}
      <div className="bg-paper-soft rounded-2xl p-5 border border-line-accent shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-ink-mute flex items-center gap-2">
            <Award className="w-4 h-4 text-accent-ink" />
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
              <TabsIndicator className="bg-tone-amber-500 shadow-sm" />
              {['ALL', 'GRAMMAR', 'VOCAB', 'LISTENING', 'NUANCE'].map((dim) => (
                <TabsTrigger
                  key={dim}
                  value={dim}
                  className="px-2.5 py-1 text-xs data-[selected]:text-tone-stone-950 data-[selected]:font-bold"
                >
                  {dim === 'ALL'
                    ? '全部'
                    : dim === 'GRAMMAR'
                    ? '文法'
                    : dim === 'VOCAB'
                    ? '词汇'
                    : dim === 'LISTENING'
                    ? '听力'
                    : '语感'}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {visibleMetrics.length === 0 ? (
          <div className="py-8 px-4 text-center rounded-xl bg-veil-stone-100o50-stone-900o30 border border-dashed border-line-soft">
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
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {visibleMetrics.map((metric: SkillMetric) => {
                const isWeak = metric.proficiency < 0.6;
                const isStrong = metric.proficiency >= 0.85;

                return (
                  <div
                    key={metric.id}
                    className="p-4 rounded-xl bg-veil-stone-100o70-stone-900o50 border border-tone-stone-200o80-stone-800 space-y-2"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-ink-soft">
                        {metric.name}
                      </span>
                      <Badge
                        variant={isStrong ? 'emerald' : isWeak ? 'destructive' : 'amber'}
                        className="rounded font-mono"
                      >
                        {Math.round(metric.proficiency * 100)}%
                      </Badge>
                    </div>

                    <Progress
                      value={metric.proficiency * 100}
                      indicatorClassName={
                        isStrong ? 'bg-tone-emerald-500' : isWeak ? 'bg-tone-rose-500' : 'bg-tone-amber-500'
                      }
                    />

                    <div className="flex justify-between items-center text-[11px] text-ink-stone-400 pt-1">
                      <span>总练习 {metric.totalAttempts} 次 · 连续错误 {metric.consecutiveErrors} 次</span>
                      {isWeak && (
                        <Button
                          variant="link"
                          size="sm"
                          onClick={() => {
                            sound.playClick();
                            setActiveTab('QUIZ');
                            toast.info(`已为您调取针对【${metric.name}】的加练题目！`);
                          }}
                          className="h-auto p-0 text-[11px] font-bold"
                        >
                          靶向加练 →
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
