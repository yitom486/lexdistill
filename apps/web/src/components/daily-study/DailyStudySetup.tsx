import React from 'react';
import { Sparkles, Dices, ArrowRight, Lock, Rocket } from 'lucide-react';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { sound } from '../../utils/audio.js';

export interface StudySourceOption {
  id: string;
  title: string;
  subtitle: string;
  total: number;
  studied: number;
  collected: number;
}

interface DailyStudySetupProps {
  sources: StudySourceOption[];
  selectedSourceId: string;
  onSelectSource: (id: string) => void;
  batchSize: 10 | 20;
  onSelectBatchSize: (size: 10 | 20) => void;
  isRandom: boolean;
  onToggleRandom: () => void;
  onStart: () => void;
  isLoading: boolean;
  lockMessage?: string | null | undefined;
  unitWordCount?: number | undefined;
  /** 词库目录读取失败（与加载中/空列表独立展示，不静默空网格）。 */
  sourcesError: boolean;
  onRetrySources: () => void;
}

export function DailyStudySetup({
  sources,
  selectedSourceId,
  onSelectSource,
  batchSize,
  onSelectBatchSize,
  isRandom,
  onToggleRandom,
  onStart,
  isLoading,
  lockMessage,
  unitWordCount,
  sourcesError,
  onRetrySources,
}: DailyStudySetupProps) {
  const activeSource = sources.find((s) => s.id === selectedSourceId) || sources[0];

  return (
    <div className="space-y-5 rounded-3xl border border-line-amber-900o10 bg-paper-soft p-6">
      <header className="space-y-1.5 border-b border-line pb-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-wash-amber-500o10-stone-900o60 text-accent-ink-warm">
            <Sparkles className="h-4 w-4" />
          </div>
          <h2 className="text-base font-bold text-ink">今日生词精学</h2>
          <Badge variant="amber" className="text-xs">
            词义 · 例句 · 用法
          </Badge>
        </div>
        <p className="text-xs text-ink-ghost leading-relaxed">
          {unitWordCount !== undefined ? '按当前路线单元学习指定词汇，完成学习后继续进行闪卡复习。' : '选择词库与数量，阅读词义、例句和已有学习内容，再决定加入复习。'}
        </p>
      </header>

      {/* 词库来源挑选 */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-ink flex items-center justify-between">
          <span>选择词库来源</span>
          <span className="text-xs text-ink-ghost">以实际可用词库为准</span>
        </label>
        {isLoading && !sources.length ? <p role="status" className="text-xs text-ink-ghost">正在读取词库目录…</p> : sourcesError ? (
          <div role="alert" className="rounded-2xl border border-line p-3.5 text-xs text-ink-ghost space-y-2">
            <p>词库目录读取失败，请检查网关后重试。</p>
            <Button type="button" size="sm" variant="outline" onClick={onRetrySources} className="gap-1 text-xs">
              重新读取
            </Button>
          </div>
        ) : sources.length === 0 && !isLoading ? (
          <p className="rounded-2xl border border-line p-3.5 text-xs text-ink-ghost">
            暂无可用词库。可先去词典收藏生词，或检查网关词库目录。
          </p>
        ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {sources.map((src) => {
            const isSelected = src.id === selectedSourceId;
            const percent = src.total > 0 ? Math.round((src.studied / src.total) * 100) : 0;
            return (
              <button
                key={src.id}
                type="button"
                onClick={() => {
                  sound.playClick();
                  onSelectSource(src.id);
                }}
                className={`flex flex-col justify-between rounded-2xl border p-3.5 text-left transition-all ${
                  isSelected
                    ? 'border-tone-amber-500o40 bg-wash-amber-500o10-stone-900o60 shadow-xs'
                    : 'border-line hover:border-tone-amber-500o25 bg-paper'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-sm font-bold text-ink">{src.title}</span>
                    <Badge variant={isSelected ? 'amber' : 'outline'} className="text-xs">
                      {src.total} 词
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-ink-ghost line-clamp-1">{src.subtitle}</p>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-ink-stone-400 border-t border-line pt-2">
                  <span>已学透 {src.studied} / {src.total}</span>
                  <span className="font-mono font-medium">{percent}%</span>
                </div>
              </button>
            );
          })}
        </div>
        )}
      </div>

      {/* 学习参数配置 */}
      {unitWordCount === undefined && <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-line pt-4">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-ink">抽取数量</label>
          <div className="flex gap-2">
            {([10, 20] as const).map((size) => (
              <Button
                key={size}
                type="button"
                size="sm"
                variant={batchSize === size ? 'secondary' : 'outline'}
                className="flex-1 text-xs"
                onClick={() => {
                  sound.playClick();
                  onSelectBatchSize(size);
                }}
              >
                {size} 词
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-ink">出词方式</label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full text-xs justify-between gap-2"
            onClick={() => {
              sound.playClick();
              onToggleRandom();
            }}
          >
            <span className="flex items-center gap-1.5">
              <Dices className="h-3.5 w-3.5 text-accent-ink-warm" />
              {isRandom ? '随机抽取' : '按词库顺序'}
            </span>
            <span className="text-xs text-ink-ghost">切换</span>
          </Button>
        </div>
      </div>

      }
      {/* 启动按钮 */}
      <div className="pt-2 space-y-3">
        <Button
          type="button"
          size="default"
          className="w-full gap-2 text-sm font-semibold h-11"
          disabled={isLoading || sourcesError || !activeSource || Boolean(lockMessage)}
          onClick={() => {
            sound.playClick();
            onStart();
          }}
        >
          <span className="flex items-center gap-1.5">
            <Rocket className="h-4 w-4" />
            {unitWordCount !== undefined ? `开始学习本单元 ${unitWordCount} 词` : `开始学习今日 ${batchSize} 词`}
          </span>
          <ArrowRight className="h-4 w-4" />
        </Button>

        {lockMessage && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-2xl border border-line-amber-900o10 bg-wash-amber-500o10-stone-900o60 p-3.5 text-xs"
          >
            <Lock className="h-4 w-4 shrink-0 mt-0.5 text-accent-ink-warm" />
            <div className="space-y-0.5">
              <span className="font-semibold text-ink">词库已锁定</span>
              <p className="text-ink-ghost leading-relaxed">{lockMessage}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
