import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Inbox, Layers } from 'lucide-react';
import { Badge } from './ui/badge.js';
import { Button } from './ui/button.js';
import {
  usePracticeCollectionsQuery,
  usePracticeItemsQuery,
  usePracticeItemsToCardsMutation,
} from '../queries/useLearnerQueries.js';
import { sound } from '../utils/audio.js';
import { humanizeCollectionTitle } from '../utils/collection-titles.js';

/**
 * 练习队列 → 勾选转入 FSRS（collect 入库 ≠ 自动建卡）
 */
export function PracticeQueueToCardsPanel() {
  const { data: collections = [], isLoading } = usePracticeCollectionsQuery();
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const { data: items = [], isLoading: itemsLoading } = usePracticeItemsQuery(activeCollectionId);
  const toCards = usePracticeItemsToCardsMutation();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!activeCollectionId && collections[0]?.id) {
      setActiveCollectionId(collections[0].id);
    }
  }, [collections, activeCollectionId]);

  useEffect(() => {
    setSelected(new Set());
  }, [activeCollectionId]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === items.length) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(items.map((i) => i.id)));
  };

  const handleConvert = async () => {
    if (selected.size === 0) {
      toast.message('请先勾选要转入复习的条目');
      return;
    }
    sound.playClick();
    try {
      const result = await toCards.mutateAsync([...selected]);
      sound.playSuccess();
      toast.success(`已转入 ${result.createdCount} 张 FSRS 闪卡`);
      setSelected(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '转入复习失败');
    }
  };

  return (
    <section className="rounded-xl border border-line-amber-900o15-amber-500o20 bg-wash-amber-500o4 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <Inbox className="w-4 h-4 text-accent-ink-warm" />
            <h4 className="text-sm font-semibold text-ink">练习队列</h4>
            <Badge variant="outline" className="text-[10px]">
              ≠ 自动进 FSRS
            </Badge>
          </div>
          <p className="text-[11px] text-ink-stone-500 leading-relaxed">
            Agent / 出题入库只进练习队列。勾选条目后点「转入复习」才会生成闪卡。
          </p>
        </div>
        <Button
          size="sm"
          className="shrink-0 gap-1 text-xs"
          disabled={selected.size === 0 || toCards.isPending}
          onClick={() => void handleConvert()}
        >
          <Layers className="w-3.5 h-3.5" />
          转入复习{selected.size > 0 ? ` (${selected.size})` : ''}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-xs text-ink-stone-400">加载练习集合…</p>
      ) : collections.length === 0 ? (
        <p className="text-xs text-ink-stone-400">
          暂无练习队列。做题时若开启 collect，生成结果会出现在这里。
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {collections.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  sound.playClick();
                  setActiveCollectionId(c.id);
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] border transition-colors ${
                  activeCollectionId === c.id
                    ? 'border-line-amber-600o50 bg-wash-amber-500o15 text-ink-amber-900-amber-100'
                    : 'border-line text-ink-faint hover:bg-veil-stone-100o80 dark:hover:bg-veil-stone-800o60'
                }`}
              >
                {humanizeCollectionTitle(c.title)}
              </button>
            ))}
          </div>

          {itemsLoading ? (
            <p className="text-xs text-ink-stone-400">加载条目…</p>
          ) : items.length === 0 ? (
            <p className="text-xs text-ink-stone-400">该集合暂无条目。</p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  className="text-[11px] text-ink-amber-800-amber-300 hover:underline"
                  onClick={toggleAll}
                >
                  {selected.size === items.length ? '取消全选' : '全选本集合'}
                </button>
                <span className="text-[10px] text-ink-stone-400">{items.length} 条</span>
              </div>
              <ul className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                {items.map((item) => {
                  const label =
                    item.question.content?.trim() ||
                    item.question.prompt?.trim() ||
                    item.id;
                  return (
                    <li key={item.id}>
                      <label className="flex items-start gap-2 rounded-lg border border-line-stone-200o80-stone-700o80 px-2.5 py-2 cursor-pointer hover:bg-veil-stone-50o80 dark:hover:bg-veil-stone-900o40">
                        <input
                          type="checkbox"
                          className="mt-0.5 accent-tone-amber-700"
                          checked={selected.has(item.id)}
                          onChange={() => toggle(item.id)}
                        />
                        <span className="min-w-0 text-[12px] text-ink-soft leading-snug line-clamp-2">
                          {label}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
