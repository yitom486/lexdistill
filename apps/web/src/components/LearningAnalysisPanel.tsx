import React from 'react';
import { motion } from 'framer-motion';
import { useMotionPreference } from '../hooks/useMotionPreference.js';
import { readCssDurationSeconds } from '../lib/css-tokens.js';
import { toast } from 'sonner';
import { Brain, RefreshCw, Lightbulb, Target, BookOpen, Sparkles } from 'lucide-react';
import type { LearningAnalysisReport, LearningSuggestion } from '@study-studio/protocol';
import {
  useLearningAnalysisQuery,
  useRefreshLearningAnalysisMutation,
} from '../queries/useLearnerQueries.js';
import { Badge } from './ui/badge.js';
import { Button } from './ui/button.js';

const SOURCE_LABEL: Record<LearningAnalysisReport['source'], { text: string; tone: string }> = {
  ai: { text: 'AI 分析', tone: 'bg-wash-blue-500o10 text-ink-blue-600 dark:text-ink-blue-400' },
  cached: { text: '上次可信分析', tone: 'bg-wash-amber-500o10 text-accent-ink' },
  'local-rules': { text: '本地规则建议', tone: 'bg-wash-emerald-500o10 text-ink-emerald-600-emerald-400' },
};

const KIND_ICON: Record<LearningSuggestion['kind'], React.ReactNode> = {
  WEAKNESS: <Target className="h-4 w-4 text-tone-rose-500" />,
  PLAN: <BookOpen className="h-4 w-4 text-ink-indigo-500" />,
  TIP: <Lightbulb className="h-4 w-4 text-tone-amber-500" />,
  ENCOURAGEMENT: <Sparkles className="h-4 w-4 text-tone-emerald-500" />,
};

/**
 * P4-C：AI 学习分析面板。
 * 模型不可用时展示上次可信分析或本地规则建议（source 徽标区分来源）；
 * AI 结论只给建议，不直接改学习状态。
 */
export function LearningAnalysisPanel({ userId }: { userId?: string }) {
  const { data, isLoading, isError } = useLearningAnalysisQuery(userId);
  const refresh = useRefreshLearningAnalysisMutation(userId);
  // R10：减少动态效果时级联延迟归零，列表直接呈现终态
  const reduceMotion = useMotionPreference();

  const report = data ?? null;
  const source = report?.source ?? 'local-rules';

  const handleRefresh = () => {
    refresh.mutate(undefined, {
      onSuccess: () => toast.success('已重新生成学习分析'),
      onError: () => toast.error('刷新分析失败，请稍后重试'),
    });
  };

  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          <h3 className="text-base font-semibold">学习分析</h3>
          {report && (
            <Badge variant="secondary" className={SOURCE_LABEL[source].tone}>
              {SOURCE_LABEL[source].text}
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={refresh.isPending}
          aria-label="重新生成学习分析"
        >
          <RefreshCw className={`h-4 w-4 ${refresh.isPending ? 'animate-spin' : ''}`} />
          <span className="ml-1">刷新</span>
        </Button>
      </header>

      {isLoading && <p className="text-sm text-muted-foreground">正在生成学习分析…</p>}
      {isError && <p className="text-sm text-destructive">分析加载失败，请稍后重试。</p>}

      {report && (
        <>
          <p className="text-sm text-foreground/80">{report.summary}</p>
          <ul className="flex flex-col gap-2">
            {report.suggestions.map((s, idx) => (
              <motion.li
                key={`${s.kind}-${idx}`}
                initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: reduceMotion ? 0 : idx * readCssDurationSeconds('--motion-analysis-stagger'), duration: readCssDurationSeconds('--motion-layout-enter-duration') }}
                className="flex gap-2 rounded-lg border bg-background/60 p-2.5"
              >
                <span className="mt-0.5 shrink-0">{KIND_ICON[s.kind]}</span>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{s.title}</span>
                  <span className="text-xs text-muted-foreground">{s.detail}</span>
                </div>
              </motion.li>
            ))}
            {report.suggestions.length === 0 && (
              <li className="text-sm text-muted-foreground">暂无紧急任务，可探索新内容或查词学新词。</li>
            )}
          </ul>
        </>
      )}
    </section>
  );
}
