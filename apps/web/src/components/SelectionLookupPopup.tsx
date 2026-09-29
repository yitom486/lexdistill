import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { BookPlus, LoaderCircle, X } from 'lucide-react';
import {
  useCollectDictionaryEntryMutation,
  useDictionaryLookupQuery,
} from '../queries/useLearnerQueries.js';
import {
  LOOKUP_SCOPE_ATTR,
  MANUAL_LOOKUP_ATTR,
  LOOKUP_POPUP_ATTR,
  normalizeSelectionText,
  normalizeLookupLanguage,
  type LookupLanguage,
} from '../lib/selection-text.js';
import { subscribeLookupPopup } from '../lib/lookup-popup-bus.js';
import { sound } from '../utils/audio.js';

interface PopupState {
  text: string;
  language: LookupLanguage;
  x: number;
  y: number;
  documentId?: string | undefined;
}

/** 选中目标是否可触发（输入框/浮层自身/手动工具栏容器一律跳过）。 */
function selectionTargetAllowed(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest(`[${LOOKUP_POPUP_ATTR}]`)) return false;
  if (target.closest('[data-manual-lookup]')) return false;
  const editable = target.closest('input, textarea, select, [contenteditable="true"]');
  return !editable;
}

function clampPopup(x: number, y: number): { x: number; y: number } {
  if (typeof window === 'undefined') return { x, y };
  return {
    x: Math.max(8, Math.min(x, window.innerWidth - 280)),
    y: Math.max(8, Math.min(y, window.innerHeight - 240)),
  };
}

/**
 * 划选查词浮层（App 级单挂载）。
 * 两路打开：① 标注 data-lookup-scope 容器内的划选（自动）；② 总线发布（阅读工具栏自有划选栏）。
 * 查词与收藏走既有领域命令；浮层只负责位置与开关，不拥有业务规则。
 */
export function SelectionLookupPopup() {
  const [popup, setPopup] = useState<PopupState | null>(null);
  const collect = useCollectDictionaryEntryMutation();
  const lookup = useDictionaryLookupQuery(
    popup?.language ?? 'ja',
    popup?.text ?? '',
    popup?.documentId
  );

  useEffect(() => subscribeLookupPopup((req) => setPopup(req)), []);

  useEffect(() => {
    const onMouseUp = (e: MouseEvent) => {
      if (!selectionTargetAllowed(e.target)) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      const anchor = sel.anchorNode?.parentElement;
      const scope = anchor?.closest(`[${LOOKUP_SCOPE_ATTR}]`);
      if (!scope) return;
      const language = normalizeLookupLanguage(scope.getAttribute(LOOKUP_SCOPE_ATTR));
      const text = normalizeSelectionText(sel.toString());
      if (!language || !text) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const pos = clampPopup(rect.left + rect.width / 2 - 130, rect.bottom + 10);
      sound.playClick();
      setPopup({ text, language, ...pos });
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopup(null);
    };
    // 新一轮点按先关旧浮层（随后的 mouseup 若选中有效会重新打开）。
    const onMouseDown = (e: MouseEvent) => {
      if (!selectionTargetAllowed(e.target)) return;
      setPopup(null);
    };
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  if (!popup) return null;
  const entries = lookup.data?.entries.slice(0, 2) ?? [];

  return (
    <div
      {...{ [LOOKUP_POPUP_ATTR]: 'true' }}
      className="fixed z-[70] w-64 rounded-xl border border-line-amber-900o15 bg-tone-white p-3 shadow-2xl dark:border-tone-amber-500o25 dark:bg-surface-h211e1b transition-colors"
      style={{ left: popup.x, top: popup.y }}
      role="dialog"
      aria-label={`查词：${popup.text}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate font-serif text-sm font-bold text-ink">
          {popup.text}
        </p>
        <button
          type="button"
          onClick={() => setPopup(null)}
          className="shrink-0 rounded-md p-1 text-ink-stone-400 hover:bg-tone-stone-100 hover:text-tone-stone-600 dark:hover:bg-tone-stone-800 transition-colors"
          aria-label="关闭查词浮层"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {lookup.isFetching ? (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-stone-400">
          <LoaderCircle className="h-3 w-3 animate-spin" /> 查询中…
        </p>
      ) : lookup.isError ? (
        <p className="mt-2 text-[11px] text-ink-stone-500">网关未连接，无法查词。</p>
      ) : entries.length > 0 ? (
        <div className="mt-1.5 space-y-2">
          {entries.map((entry) => (
            <div key={entry.id} className="border-t border-tone-stone-100 pt-1.5 first:border-0 first:pt-0 dark:border-tone-stone-800 transition-colors">
              <p className="text-xs font-semibold text-ink-soft">
                {entry.headword}
                {entry.reading && (
                  <span className="ml-1.5 font-mono text-[10px] font-normal text-accent-ink-strong">
                    {entry.reading}
                  </span>
                )}
              </p>
              <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-ink-ghost">
                {entry.meanings.slice(0, 2).join('；')}
              </p>
              <button
                type="button"
                disabled={collect.isPending}
                onClick={() => {
                  sound.playClick();
                  collect.mutate(entry.id, {
                    onSuccess: (r) =>
                      toast.success(r.created ? '已加入生词本。' : '已在生词本中。'),
                    onError: (e) =>
                      toast.error(e instanceof Error ? e.message : '加入生词本失败。'),
                  });
                }}
                className="mt-1 inline-flex items-center gap-1 rounded-lg border border-tone-amber-500o40 px-2 py-0.5 text-[11px] font-medium text-tone-amber-700 hover:bg-wash-amber-500o10 dark:text-ink-amber-300 transition-colors"
              >
                <BookPlus className="h-3 w-3" />
                加入生词本
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-ink-stone-500">本地词典暂未收录，去生词本查完整结果。</p>
      )}
    </div>
  );
}
