import * as React from 'react';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
import { Dialog, DialogContent } from '../ui/dialog.js';
import type {
  EditableTocEntry,
  TocDraftConfidence,
  TocReviewDiffRow,
  TocReviewDraft,
} from '../../lib/toc-confirm-flow.js';
import { diffSideToEditable } from '../../lib/toc-confirm-flow.js';
import {
  adoptedSummaryText,
  buildAdoptReport,
  changeLabel,
  countAdoptable,
  filterDiffRows,
  type TocAdoptReport,
  type TocChangeFilter,
} from '../../lib/toc-result-view.js';

/**
 * CMD-LINGUA-P3.5 AI 目录结果大 Dialog（只读网关数据 + 页面临时状态，零写）。
 *
 * 布局铁律（任务验收项）：
 * - 结果 Dialog ≥ 90vw / 90vh；header / footer 固定；目录表是唯一的滚动区；
 * - 默认展示完整合并后目录；“仅看变更”筛选去掉 keep 行；
 * - 表格列严格对齐：状态、标题、印刷页、层级、置信度、变更依据；
 * - 不允许多个并排独立滚动区（warnings 与表格同处一个滚动容器）。
 * 颜色铁律：只用 toc 语义工具类（bg-toc、text-toc、border-toc 前缀，index.css 双模式定义），
 * 禁止色值字面量、hex、arbitrary color（静态门禁锁定）。
 * 采用铁律（P3.5-FIX）：勾选只活本组件 useState；点“采用 N 项变更”回传
 * {selectedIds, edited} 给父级，最终 entries 由父级以 baseline + 回执构造；
 * 不调任何 mutation/fetch；关闭即失（父级已存回执， reopen 回显）。
 * 组件内禁止 import 任何 queries/mutation。
 */

function toRowState(entry: TocReviewDraft['entries'][number]): EditableTocEntry {
  return {
    key: entry.entryId,
    title: entry.title,
    printedPage: String(entry.printedPage),
    level: entry.level,
    kind: entry.kind,
    confidence: entry.confidence,
  };
}

function kindLabel(kind: string): string {
  return kind === 'lesson' ? '课' : '节';
}

function confidenceLabel(confidence: TocDraftConfidence | null): string {
  return confidence ?? '—';
}

function rowTone(change: TocReviewDiffRow['change']): string {
  if (change === 'add') return 'bg-toc-add-bg border-toc-add-border';
  if (change === 'update') return 'bg-toc-update-bg border-toc-update-border';
  if (change === 'remove') return 'bg-toc-remove-bg border-toc-remove-border';
  return 'bg-toc-surface border-toc-border';
}

function statusTone(change: TocReviewDiffRow['change']): string {
  if (change === 'add') return 'bg-toc-add-bg text-toc-add-fg border-toc-add-border';
  if (change === 'update') return 'bg-toc-update-bg text-toc-update-fg border-toc-update-border';
  if (change === 'remove') return 'bg-toc-remove-bg text-toc-remove-fg border-toc-remove-border';
  return 'bg-toc-surface text-toc-muted border-toc-border';
}

export interface TocInitialAdoption {
  /** 父级已存的选中 id（关闭再打开回显用）。 */
  ids: string[];
  /** 父级已存的编辑（entryId → 行；打开时覆盖草稿值）。 */
  editedById: Record<string, EditableTocEntry>;
}

export interface TocResultDialogContentProps {
  rangeText: string;
  baselineCount: number;
  draft: TocReviewDraft;
  initialFilter?: TocChangeFilter;
  /** 关闭再打开回显（父级状态为准；缺席=全新）。 */
  initialAdoption?: TocInitialAdoption;
  /** 关闭（稍后处理按钮用）。 */
  onClose(): void;
  /**
   * 采用回执：用户点“采用 N 项变更”时回传选中 id + 当前全部编辑行。
   * 最终 entries 由父级以 baseline + 本回执构造；Dialog 自身只做展示与勾选。
   */
  onAdopt?(report: TocAdoptReport): void;
}

export function TocResultDialogContent(props: TocResultDialogContentProps): React.ReactElement {
  const { rangeText, baselineCount, draft, initialFilter, initialAdoption, onClose, onAdopt } = props;
  const [filter, setFilter] = React.useState<TocChangeFilter>(initialFilter ?? 'all');
  const [rows, setRows] = React.useState<EditableTocEntry[]>(() => {
    const entryIds = new Set(draft.entries.map((entry) => entry.entryId));
    const stored = initialAdoption?.editedById ?? {};
    const applyStored = (row: EditableTocEntry): EditableTocEntry => {
      const saved = stored[row.key];
      return saved ? { ...saved, key: row.key } : row;
    };
    const base = draft.entries.map((entry) => applyStored(toRowState(entry)));
    for (const diff of draft.diff) {
      if (entryIds.has(diff.entryId)) continue;
      const side = diff.before ?? diff.after;
      if (side) base.push(applyStored(diffSideToEditable(diff.entryId, side)));
    }
    return base;
  });
  const [adopted, setAdopted] = React.useState<ReadonlySet<string>>(
    () => new Set(initialAdoption?.ids ?? [])
  );
  // P3.5-FIX2：初始行快照（脏检查用；编辑即自动标记，绝不静默丢编辑）。
  // 首挂载一次性快照；新批次靠父级 key 重挂，旧快照随组件销毁。
  const initialRowsRef = React.useRef<Map<string, EditableTocEntry> | null>(null);
  if (initialRowsRef.current === null) {
    initialRowsRef.current = new Map(rows.map((row) => [row.key, { ...row }]));
  }
  const isDirty = (key: string): boolean => {
    const initial = initialRowsRef.current?.get(key);
    const current = rows.find((row) => row.key === key);
    if (!initial || !current) return false;
    return (
      current.title !== initial.title ||
      current.printedPage !== initial.printedPage ||
      current.level !== initial.level ||
      current.kind !== initial.kind
    );
  };

  const visibleDiff = filterDiffRows(draft.diff, filter);
  const visibleRows = React.useMemo(() => {
    const byId = new Map(rows.map((row) => [row.key, row]));
    return visibleDiff
      .map((row) => ({ diff: row, edited: byId.get(row.entryId) ?? null }))
      .filter((item): item is { diff: TocReviewDiffRow; edited: EditableTocEntry } => item.edited !== null);
  }, [visibleDiff, rows]);
  const adoptableCount = countAdoptable(draft.diff);

  const updateRow = (key: string, patch: Partial<EditableTocEntry>): void => {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    // P3.5-FIX2：任何编辑自动标记为已确认（keep 脏行转为人工 update，不静默丢失）。
    setAdopted((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  };

  const adoptRows = (ids: string[]): void => {
    setAdopted((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  };

  const unmarkRow = (id: string): void => {
    setAdopted((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const changedIds = visibleRows.filter((item) => item.diff.change !== 'keep').map((item) => item.diff.entryId);

  /**
   * P3.5-FIX2 真实部分采用：
   * - 确认本条只标记（adoptRows）；
   * - 采用已确认只提交已标记项；
   * - 确认全部并采用才全选变更。
   */
  const handleAdoptMarked = (): void => {
    const report = buildAdoptReport(rows, adopted);
    if (onAdopt) onAdopt(report);
  };

  const handleAdoptAll = (): void => {
    const all = new Set([...adopted, ...changedIds]);
    setAdopted(all);
    if (onAdopt) onAdopt(buildAdoptReport(rows, all));
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="shrink-0 space-y-1.5">
        <p className="text-[14px] font-bold text-toc-strong">AI 目录草稿（待人工确认，未入库）</p>
        <p className="text-[11px] text-toc-muted">
          AI 重建目录（保留正确项并标记变更）：{rangeText} · 基线 {baselineCount} 条 → 合并 {draft.entries.length} 条
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex shrink-0 items-center gap-1" role="group" aria-label="目录显示范围">
            <Button
              type="button"
              variant={filter === 'all' ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-[11px]"
              aria-pressed={filter === 'all'}
              onClick={() => setFilter('all')}
            >
              完整目录
            </Button>
            <Button
              type="button"
              variant={filter === 'changed' ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-[11px]"
              aria-pressed={filter === 'changed'}
              onClick={() => setFilter('changed')}
            >
              仅看变更（{adoptableCount}）
            </Button>
          </span>
        </div>
        <p className="text-[11px] text-toc-muted">印刷页为书内页码，非 PDF 物理页，请勿直接当页码跳转。</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {draft.warnings.length > 0 && (
          <div className="mb-2 space-y-0.5 rounded-xl border border-toc-border bg-toc-surface p-2 text-[11px] text-toc-strong">
            <p className="font-bold">AI 存疑提醒：</p>
            {draft.warnings.map((warning, index) => (
              <p key={`warn-${index}`}>· {warning}</p>
            ))}
          </div>
        )}
        {visibleRows.length === 0 && (
          <p className="p-2 text-[11px] text-toc-muted">筛选条件下无条目。</p>
        )}
        <table className="w-full border-collapse text-[14px]">
          <thead className="sticky top-0 bg-toc-surface">
            <tr className="text-left text-[12px] text-toc-muted">
              <th className="w-24 px-2 py-2 font-bold">状态</th>
              <th className="px-2 py-2 font-bold">标题</th>
              <th className="w-28 px-2 py-2 font-bold">印刷页</th>
              <th className="w-20 px-2 py-2 font-bold">层级</th>
              <th className="w-20 px-2 py-2 font-bold">置信度</th>
              <th className="w-64 px-2 py-2 font-bold">变更依据</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(({ diff, edited }) => {
              const isAdopted = adopted.has(diff.entryId);
              const struck = diff.change === 'remove' ? 'line-through' : '';
              // remove 行展示的是删除快照（entries 已无此条），输入框只读，确认=确认删除。
              const readOnly = diff.change === 'remove';
              // P3.5-FIX2：keep 脏行显式转为人工 update（徽标/底色同步翻转，不静默）。
              const dirtyKeep = diff.change === 'keep' && isDirty(diff.entryId);
              const effectiveChange = dirtyKeep ? 'update' : diff.change;
              return (
                <tr key={diff.entryId} className={`border-t border-toc-border ${rowTone(effectiveChange)}`}>
                  <td className="px-2 py-1 align-top">
                    <span className="flex flex-col items-start gap-1">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[12px] font-bold ${statusTone(effectiveChange)}`}>
                        {dirtyKeep ? '修改（人工）' : changeLabel(diff.change, diff.needsReview)}
                      </span>
                      {isAdopted && (
                        <Badge variant="outline" className="text-[10px]">
                          已采用
                        </Badge>
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-1 align-top">
                    <input
                      type="text"
                      aria-label={`条目标题 ${diff.entryId}`}
                      value={edited.title}
                      disabled={readOnly}
                      onChange={(e) => updateRow(edited.key, { title: e.target.value })}
                      className={`h-9 min-h-[36px] w-full rounded-lg border border-toc-border bg-toc-surface px-2 text-toc-strong outline-none ${struck}`}
                    />
                    {((diff.change === 'update' && diff.before && diff.before.title !== edited.title) ||
                      (dirtyKeep && diff.before && diff.before.title !== edited.title)) && (
                      <p className="mt-0.5 truncate text-[12px] text-toc-muted">原：{diff.before.title}</p>
                    )}
                    {diff.change === 'remove' && diff.before && (
                      <p className="mt-0.5 truncate text-[12px] text-toc-muted">删前：{diff.before.title}</p>
                    )}
                  </td>
                  <td className="px-2 py-1 align-top">
                    <input
                      type="number"
                      min={1}
                      aria-label={`印刷页码 ${diff.entryId}`}
                      title="教材印刷页（书内页码），不是 PDF 物理页"
                      value={edited.printedPage}
                      disabled={readOnly}
                      onChange={(e) => updateRow(edited.key, { printedPage: e.target.value })}
                      className="h-9 min-h-[36px] w-full rounded-lg border border-toc-border bg-toc-surface px-2 font-mono text-toc-strong outline-none"
                    />
                  </td>
                  <td className="px-2 py-1 align-top">
                    <Select
                      value={edited.level === 1 ? '1' : '2'}
                      disabled={readOnly}
                      onValueChange={(v) => {
                        if (v === '1' || v === '2') updateRow(edited.key, { level: v === '1' ? 1 : 2 });
                      }}
                    >
                      <SelectTrigger className="h-9 min-h-[36px] w-full text-[14px]" aria-label={`层级 ${diff.entryId}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1" className="text-[14px]">
                          1·课
                        </SelectItem>
                        <SelectItem value="2" className="text-[14px]">
                          2·节
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="mt-0.5 text-[10px] text-toc-muted">{kindLabel(edited.kind)}</p>
                  </td>
                  <td className="px-2 py-1 align-top">
                    <span className="font-mono text-[14px] text-toc-muted" title={edited.confidence === null ? 'OCR 原文保留，未经 AI 判定' : undefined}>
                      {confidenceLabel(edited.confidence)}
                    </span>
                    {diff.needsReview && (
                      <p className="mt-0.5 text-[12px] font-bold text-toc-review-fg">待确认</p>
                    )}
                  </td>
                  <td className="px-2 py-1 align-top">
                    <p className="text-[14px] text-toc-strong">{diff.reason ?? '—'}</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-1 h-6 text-[10px]"
                      aria-pressed={isAdopted}
                      aria-label={isAdopted ? `撤销确认 ${diff.entryId}` : `确认本条 ${diff.entryId}`}
                      onClick={() => {
                        if (isAdopted) unmarkRow(diff.entryId);
                        else adoptRows([diff.entryId]);
                      }}
                    >
                      {isAdopted ? '撤销确认' : '确认本条'}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-toc-border pt-2">
        <p className="text-[11px] text-toc-muted">{adoptedSummaryText(adopted.size, adoptableCount)}</p>
        <span className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={onClose}>
            稍后处理
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            disabled={adopted.size === 0}
            onClick={handleAdoptMarked}
          >
            采用已确认 {adopted.size} 项
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-7 text-[11px]"
            disabled={adoptableCount === 0}
            onClick={handleAdoptAll}
          >
            确认全部并采用
          </Button>
        </span>
      </div>
    </div>
  );
}

export interface TocResultDialogProps extends Omit<TocResultDialogContentProps, 'onClose'> {
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function TocResultDialog(props: TocResultDialogProps): React.ReactElement {
  const { open, onOpenChange, ...contentProps } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] w-[90vw] max-w-none flex-col" showCloseButton aria-label="AI 目录草稿结果">
        <TocResultDialogContent {...contentProps} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
