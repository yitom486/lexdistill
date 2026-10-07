import React, { useState } from 'react';
import { Flame, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button.js';
import { sound } from '../utils/audio.js';
import { useLearningShell } from '../hooks/useLearningShell.js';
import { useStudySessionStore } from '../stores/useStudySessionStore.js';
import { useEncounteredTermsQuery, useBackfillEncounteredTermsMutation } from '../queries/useLearnerQueries.js';

/** 相遇词热力：查词/收藏中真实见过的词，按相遇次数排序；点词跳生词本。 */
export function EncounteredTermsHeat() {
  const shell = useLearningShell();
  const setActiveTab = useStudySessionStore((s) => s.setActiveTab);
  const { data: terms = [], isLoading } = useEncounteredTermsQuery(shell.track, 50);
  const backfill = useBackfillEncounteredTermsMutation(shell.track);
  const [showAll, setShowAll] = useState(false);

  const sortedTerms = [...terms].sort((a, b) => b.exposureCount - a.exposureCount);
  const displayTerms = showAll ? sortedTerms : sortedTerms.slice(0, 16);

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
      ) : terms.length === 0 ? (
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
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {displayTerms.map((t) => (
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

          {terms.length > 16 && (
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => {
                  sound.playClick();
                  setShowAll((v) => !v);
                }}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent-ink hover:underline cursor-pointer"
              >
                <span>{showAll ? '收起部分' : `展开全部 ${terms.length} 个词`}</span>
                {showAll ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
