import { Award, Layers, AlertTriangle } from 'lucide-react';
import { BentoCard, NumberTicker } from '../magicui/index.js';
import { Button } from '../ui/button.js';
import { sound } from '../../utils/audio.js';
import { useStudySessionStore } from '../../stores/useStudySessionStore.js';
import type { SourceKind } from './source-view.js';
import { SourceRetry } from './source-view.js';

interface EvidenceOverviewProps {
  metricsView: SourceKind;
  metricsStale: boolean;
  practiceSummary: string;
  practicePercent: number | null;
  observedSkillCount: number;
  onRefetchMetrics: () => void;
  cardsView: SourceKind;
  cardsStale: boolean;
  cardCount: number;
  retentionLine: string;
  onRefetchCards: () => void;
  mistakesView: SourceKind;
  mistakesStale: boolean;
  unresolved: number;
  mistakesLine: string;
  onRefetchMistakes: () => void;
}

/**
 * 学情证据区：正确率主卡 + 闪卡/错题独立状态。
 * 三个来源各自呈现 loading/失败/空/有效；一源失败不清零其他已知数据。
 */
export function EvidenceOverview({
  metricsView,
  metricsStale,
  practiceSummary,
  practicePercent,
  observedSkillCount,
  onRefetchMetrics,
  cardsView,
  cardsStale,
  cardCount,
  retentionLine,
  onRefetchCards,
  mistakesView,
  mistakesStale,
  unresolved,
  mistakesLine,
  onRefetchMistakes,
}: EvidenceOverviewProps) {
  const setActiveTab = useStudySessionStore((s) => s.setActiveTab);
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <BentoCard
        name="已练内容正确率"
        Icon={Award}
        className="p-5 min-h-[10.5rem] lg:col-span-3"
        description={practiceSummary}
      >
        {metricsView === 'loading' && (
          <p className="text-xs text-ink-faint-soft pt-2">正在读取学情画像…</p>
        )}
        {metricsView === 'error' && (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <p className="text-xs text-ink-rose-600-rose-400">画像读取失败，暂无数据。</p>
            <SourceRetry onRetry={onRefetchMetrics} />
          </div>
        )}
        {(metricsView === 'ready' || metricsView === 'empty') && (
          <div className="flex items-baseline gap-2 pt-2">
            <span className="text-3xl font-bold font-mono text-accent-ink leading-none">
              {practicePercent === null ? '待评测' : <><NumberTicker value={practicePercent} />%</>}
            </span>
            <span className="text-xs text-ink-emerald-600-emerald-400 font-semibold">
              累计记录
            </span>
          </div>
        )}
        {metricsStale && (
          <p className="text-xs text-ink-faint-soft pt-1">画像可能不是最新。<SourceRetry onRetry={onRefetchMetrics} /></p>
        )}
        {metricsView === 'empty' && (
          <div className="pt-2">
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
        )}
        {metricsView === 'ready' && practicePercent === null && (
          <p className="text-xs text-ink-faint-soft pt-1">
            {observedSkillCount} 个已练技能暂无有效作答；未测能力保持未知。
          </p>
        )}
      </BentoCard>

      <div className="space-y-4 lg:col-span-2">
        <div className="surface-card rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-gold-warm" />
            <h3 className="text-sm font-bold text-ink">生词闪卡</h3>
            <span className="flex-1" />
            {cardsStale && <span className="text-xs text-ink-faint-soft">可能不是最新<SourceRetry onRetry={onRefetchCards} /></span>}
          </div>
          {cardsView === 'loading' && <p className="text-xs text-ink-faint-soft">读取中…</p>}
          {cardsView === 'error' && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs text-ink-rose-600-rose-400">闪卡读取失败。</p>
              <SourceRetry onRetry={onRefetchCards} />
            </div>
          )}
          {cardsView === 'empty' && (
            <p className="text-xs text-ink-faint-soft">
              <span className="font-mono font-bold text-ink">0</span> 张活跃卡片 · 暂无闪卡
            </p>
          )}
          {cardsView === 'ready' && (
            <p className="text-xs text-ink-ghost">
              <span className="font-mono font-bold text-xl text-ink"><NumberTicker value={cardCount} /></span>
              {' '}张活跃卡片{retentionLine}
            </p>
          )}
        </div>

        <div className="surface-card rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-gold-warm" />
            <h3 className="text-sm font-bold text-ink">错题本</h3>
            <span className="flex-1" />
            {mistakesStale && <span className="text-xs text-ink-faint-soft">可能不是最新<SourceRetry onRetry={onRefetchMistakes} /></span>}
          </div>
          {mistakesView === 'loading' && <p className="text-xs text-ink-faint-soft">读取中…</p>}
          {mistakesView === 'error' && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs text-ink-rose-600-rose-400">错题读取失败。</p>
              <SourceRetry onRetry={onRefetchMistakes} />
            </div>
          )}
          {mistakesView === 'empty' && (
            <p className="text-xs text-ink-faint-soft">
              <span className="font-mono font-bold text-ink">0</span> 项 · 暂无错题记录
            </p>
          )}
          {mistakesView === 'ready' && (
            <p className="text-xs text-ink-ghost">
              <span className="font-mono font-bold text-xl text-ink"><NumberTicker value={unresolved} /></span>
              {' '}{mistakesLine}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
