import type { EditableTocEntry, TocReviewDiffRow } from './toc-confirm-flow.js';

/**
 * CMD-LINGUA-P3.5 结果 Dialog 纯展示逻辑（无 React、无网络、无存储）。
 * 表格列严格对齐：状态、标题、印刷页、层级、置信度、变更依据。
 */

export type TocChangeFilter = 'all' | 'changed';

/** diff 筛选（纯函数）：默认完整合并目录；仅看变更去掉 keep 行。 */
export function filterDiffRows(diff: TocReviewDiffRow[], filter: TocChangeFilter): TocReviewDiffRow[] {
  if (filter !== 'changed') return [...diff];
  return diff.filter((row) => row.change !== 'keep');
}

/** 可采用条数（纯函数）：非 keep 行数（keep 无需采用）。 */
export function countAdoptable(diff: TocReviewDiffRow[]): number {
  return diff.filter((row) => row.change !== 'keep').length;
}

export type TocChangeKind = TocReviewDiffRow['change'];

const CHANGE_LABEL: Record<TocChangeKind, string> = {
  keep: '保留',
  add: '新增',
  update: '修改',
  remove: '删除',
};

/** 变更状态文案（纯函数）：keep/add/update/remove + 待确认后缀。 */
export function changeLabel(change: TocChangeKind, needsReview: boolean): string {
  const base = CHANGE_LABEL[change] ?? change;
  return needsReview ? `${base}·待确认` : base;
}

/** 采用摘要（纯函数）：只描述本地暂存数量，不触网络。 */
export function adoptedSummaryText(adoptedCount: number, adoptableCount: number): string {
  if (adoptableCount === 0) return '无可采用的变更（基线已确认无误）';
  if (adoptedCount === 0) return `已采用 0/${adoptableCount} 项变更（只存本页，未入库）`;
  return `已采用 ${adoptedCount}/${adoptableCount} 项变更（只存本页，未入库）`;
}

export interface TocAdoptReport {
  /** 用户选中的操作 id（entryId；仅真实存在的行，未知 id 已剔除）。 */
  selectedIds: string[];
  /** Dialog 内当前全部编辑行（entryId → 行；父级按选中取用）。 */
  edited: EditableTocEntry[];
}

/**
 * Dialog 采用回执（纯函数）：把内部 adopted 集合 + 当前编辑行打包给父级。
 * 父级以 baseline + 本回执构造最终 entries；Dialog 自身不决定最终目录。
 */
export function buildAdoptReport(rows: EditableTocEntry[], adoptedIds: ReadonlySet<string>): TocAdoptReport {
  const byId = new Map(rows.map((row) => [row.key, row]));
  const selectedIds = [...adoptedIds].filter((id) => byId.has(id));
  return { selectedIds, edited: rows.map((row) => ({ ...row })) };
}
