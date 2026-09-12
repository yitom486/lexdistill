import { describe, expect, it } from 'bun:test';
import {
  adoptedSummaryText,
  changeLabel,
  countAdoptable,
  filterDiffRows,
  type TocChangeFilter,
} from '../toc-result-view.js';
import type { TocReviewDiffRow } from '../toc-confirm-flow.js';

function row(entryId: string, change: TocReviewDiffRow['change']): TocReviewDiffRow {
  return { entryId, change, before: null, after: null, reason: change === 'keep' ? null : 'r', needsReview: false };
}

describe('P3.5 结果展示纯逻辑', () => {
  it('filterDiffRows：默认全量，仅看变更去掉 keep', () => {
    const diff = [row('b0', 'keep'), row('n0', 'add'), row('b1', 'update')];
    expect(filterDiffRows(diff, 'all' as TocChangeFilter).map((d) => d.entryId)).toEqual(['b0', 'n0', 'b1']);
    expect(filterDiffRows(diff, 'changed' as TocChangeFilter).map((d) => d.entryId)).toEqual(['n0', 'b1']);
    expect(filterDiffRows([], 'changed' as TocChangeFilter)).toEqual([]);
  });

  it('countAdoptable：只计非 keep', () => {
    expect(countAdoptable([row('b0', 'keep')])).toBe(0);
    expect(countAdoptable([row('b0', 'keep'), row('n0', 'add'), row('b1', 'remove')])).toBe(2);
  });

  it('changeLabel：四态 + 待确认后缀', () => {
    expect(changeLabel('keep', false)).toBe('保留');
    expect(changeLabel('add', false)).toBe('新增');
    expect(changeLabel('update', true)).toBe('修改·待确认');
    expect(changeLabel('remove', false)).toBe('删除');
  });

  it('adoptedSummaryText：只描述本地数量', () => {
    expect(adoptedSummaryText(0, 0)).toContain('无可采用');
    expect(adoptedSummaryText(0, 3)).toBe('已采用 0/3 项变更（只存本页，未入库）');
    expect(adoptedSummaryText(2, 3)).toBe('已采用 2/3 项变更（只存本页，未入库）');
  });
});
