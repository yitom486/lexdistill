import { describe, expect, it } from 'bun:test';
import { buildAiAdoptedEntries } from '../toc-confirm-flow.js';
import type {
  EditableTocEntry,
  TocBaselineEntry,
  TocReviewDiffRow,
} from '../toc-confirm-flow.js';

/**
 * P3.5-FIX 父级采用链（失败测试先行）。
 *
 * 契约：Dialog 只回传“选中的增删改操作 + 当前编辑”，父级以
 * baseline + 已确认操作构造完整、有序的 EditableTocEntry[]：
 * - keep 保持原值；selected update 覆盖；selected add 插入；
 *   selected remove 才真正移除；
 * - 绝不把 remove 的 diff.before 当作最终 entries；
 * - 顺序跟随 draft.diff 顺序（合并后顺序）；
 * - 全程页面 state，不触 DB/导入。
 */

function baseline(): TocBaselineEntry[] {
  return [
    { title: '第1課 会話', printedPage: 12, level: 1, source: 'geometry-block', kind: 'lesson' },
    { title: '第2課 文法', printedPage: 20, level: 1, source: 'geometry-block', kind: 'lesson' },
    { title: '旧付録', printedPage: 99, level: 2, source: 'text-fallback', kind: 'section' },
  ];
}

function diff(): TocReviewDiffRow[] {
  return [
    {
      entryId: 'b0', change: 'keep', needsReview: false, reason: null,
      before: { title: '第1課 会話', printedPage: 12, level: 1, kind: 'lesson', confidence: null },
      after: { title: '第1課 会話', printedPage: 12, level: 1, kind: 'lesson', confidence: null },
    },
    {
      entryId: 'n0', change: 'add', needsReview: false, reason: '漏项补录',
      before: null,
      after: { title: '復習A', printedPage: 16, level: 1, kind: 'lesson', confidence: 'high' },
    },
    {
      entryId: 'b1', change: 'update', needsReview: false, reason: '标题校正',
      before: { title: '第2課 文法', printedPage: 20, level: 1, kind: 'lesson', confidence: null },
      after: { title: '第2課 文法まとめ', printedPage: 20, level: 1, kind: 'lesson', confidence: 'high' },
    },
    {
      entryId: 'b2', change: 'remove', needsReview: false, reason: '上一版残留',
      before: { title: '旧付録', printedPage: 99, level: 2, kind: 'section', confidence: null },
      after: null,
    },
  ];
}

function edited(id: string, patch: Partial<EditableTocEntry>): EditableTocEntry {
  return {
    key: id,
    title: `EDITED-${id}`,
    printedPage: '1',
    level: 1,
    kind: 'lesson',
    confidence: null,
    ...patch,
  };
}

describe('P3.5-FIX buildAiAdoptedEntries', () => {
  it('空选中 = 纯基线（顺序/值不变，无 AI 痕迹）', () => {
    const out = buildAiAdoptedEntries({ baselineEntries: baseline(), diff: diff(), selectedIds: [], editedById: {} });
    expect(out.map((e) => e.title)).toEqual(['第1課 会話', '第2課 文法', '旧付録']);
    expect(out.map((e) => e.key)).toEqual(['b0', 'b1', 'b2']);
  });

  it('selected update 覆盖，其余保持基线', () => {
    const out = buildAiAdoptedEntries({
      baselineEntries: baseline(),
      diff: diff(),
      selectedIds: ['b1'],
      editedById: { b1: edited('b1', { title: '第2課 文法まとめ', printedPage: '20' }) },
    });
    expect(out.find((e) => e.key === 'b1')?.title).toBe('第2課 文法まとめ');
    expect(out.find((e) => e.key === 'b0')?.title).toBe('第1課 会話');
    expect(out.find((e) => e.key === 'b2')?.title).toBe('旧付録');
  });

  it('未选中的 update/add 不生效（保持基线，不插入）', () => {
    const out = buildAiAdoptedEntries({
      baselineEntries: baseline(),
      diff: diff(),
      selectedIds: [],
      editedById: { b1: edited('b1', { title: '不该出现' }), n0: edited('n0', { title: '不该插入' }) },
    });
    expect(out.map((e) => e.title)).toEqual(['第1課 会話', '第2課 文法', '旧付録']);
  });

  it('selected add 按 diff 顺序插入（用户编辑值）', () => {
    const out = buildAiAdoptedEntries({
      baselineEntries: baseline(),
      diff: diff(),
      selectedIds: ['n0'],
      editedById: { n0: edited('n0', { title: '復習A（改）', printedPage: '16' }) },
    });
    expect(out.map((e) => e.key)).toEqual(['b0', 'n0', 'b1', 'b2']);
    expect(out[1]).toMatchObject({ title: '復習A（改）', printedPage: '16' });
  });

  it('selected remove 真正移除；绝不回传 diff.before', () => {
    const out = buildAiAdoptedEntries({
      baselineEntries: baseline(),
      diff: diff(),
      selectedIds: ['b2'],
      editedById: {},
    });
    expect(out.map((e) => e.key)).toEqual(['b0', 'b1']);
    expect(out.some((e) => e.title.includes('旧付録'))).toBe(false);
  });

  it('全部采用 = keep + 更新覆盖 + 新增插入 − 删除', () => {
    const out = buildAiAdoptedEntries({
      baselineEntries: baseline(),
      diff: diff(),
      selectedIds: ['n0', 'b1', 'b2'],
      editedById: {
        n0: edited('n0', { title: '復習A', printedPage: '16' }),
        b1: edited('b1', { title: '第2課 文法まとめ', printedPage: '20' }),
      },
    });
    expect(out.map((e) => e.key)).toEqual(['b0', 'n0', 'b1']);
  });

  it('未知 id 与缺编辑值 fail-closed（未知选中忽略，选中无编辑用草稿值）', () => {
    const out = buildAiAdoptedEntries({
      baselineEntries: baseline(),
      diff: diff(),
      selectedIds: ['zzz', 'b1'],
      editedById: {},
    });
    // b1 无编辑值 → 回退草稿 after；zzz 被忽略
    expect(out.map((e) => e.key)).toEqual(['b0', 'b1', 'b2']);
    expect(out.find((e) => e.key === 'b1')?.title).toBe('第2課 文法まとめ');
  });
});
