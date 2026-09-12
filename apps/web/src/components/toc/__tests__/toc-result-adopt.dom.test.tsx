import { afterEach, describe, expect, it } from 'bun:test';
import * as React from 'react';
import { TocResultDialogContent } from '../TocResultDialog.js';
import { buildAiAdoptedEntries, type TocBaselineEntry, type TocReviewDraft } from '../../../lib/toc-confirm-flow.js';
import { buildPreviewEntries } from '../../../lib/toc-anchor-flow.js';
import type { TocAdoptReport } from '../../../lib/toc-result-view.js';
import { act, setupDom, type DomHandle } from './dom-setup.js';

/**
 * P3.5-FIX2 DOM 级交互回归（jsdom + React act, 真实组件）。
 *
 * - 确认本条只标记；“采用已确认”只提交已标记项；另有“确认全部并采用”；
 * - 只确认 update 时，add/remove 不进最终 entries（经真实 buildAiAdoptedEntries 断言）；
 * - keep 行编辑自动转为人工 update，不静默丢失，最终 preview 输入可验证。
 */

let handle: DomHandle | null = null;

afterEach(() => {
  handle?.teardown();
  handle = null;
});

function renderContent(props: Parameters<typeof TocResultDialogContent>[0]): void {
  if (!handle) throw new Error('dom not ready');
  const root = handle.root;
  act(() => {
    root.render(React.createElement(TocResultDialogContent, props));
  });
}

function clickByText(text: string, scope?: ParentNode): void {
  const base = scope ?? document;
  const btn = [...base.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
  if (!btn) throw new Error(`button not found: ${text}`);
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function inputByLabel(label: string): HTMLInputElement {
  const el = document.querySelector(`input[aria-label="${label}"]`);
  if (!(el instanceof HTMLInputElement)) throw new Error(`input not found: ${label}`);
  return el;
}

const BASELINE: TocBaselineEntry[] = [
  { title: '第1課 会話', printedPage: 12, level: 1, source: 'geometry-block', kind: 'lesson' },
  { title: '第2課 文法', printedPage: 20, level: 1, source: 'geometry-block', kind: 'lesson' },
  { title: '旧付録', printedPage: 99, level: 2, source: 'text-fallback', kind: 'section' },
];

const DRAFT: TocReviewDraft = {
  entries: [
    { entryId: 'b0', title: '第1課 会話', printedPage: 12, level: 1, kind: 'lesson', confidence: null, needsReview: false },
    { entryId: 'n0', title: '復習A', printedPage: 16, level: 1, kind: 'lesson', confidence: 'high', needsReview: false },
    { entryId: 'b1', title: '第2課 文法まとめ', printedPage: 20, level: 1, kind: 'lesson', confidence: 'high', needsReview: false },
  ],
  warnings: [],
  diff: [
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
  ],
};

function buildParentEntries(report: TocAdoptReport) {
  const editedById: Record<string, Parameters<typeof buildAiAdoptedEntries>[0]['editedById'][string]> = {};
  for (const row of report.edited) editedById[row.key] = row;
  return buildAiAdoptedEntries({ baselineEntries: BASELINE, diff: DRAFT.diff, selectedIds: report.selectedIds, editedById });
}

describe('P3.5-FIX2 部分采用 DOM 交互', () => {
  it('只确认 update → 采用已确认：add/remove 不进最终 entries', async () => {
    handle = await setupDom();
    const reports: TocAdoptReport[] = [];
    renderContent({
      rangeText: '1–2',
      baselineCount: 3,
      draft: DRAFT,
      onClose: () => {},
      onAdopt: (report) => reports.push(report),
    });
    // 只点 update 行(b1)的确认本条
    const b1Row = inputByLabel('条目标题 b1').closest('tr');
    if (!b1Row) throw new Error('b1 row missing');
    clickByText('确认本条', b1Row);
    // 采用已确认（不是全部采用）
    clickByText('采用已确认');
    expect(reports).toHaveLength(1);
    expect(reports[0]?.selectedIds).toEqual(['b1']);
    const entries = buildParentEntries(reports[0]!);
    expect(entries.map((e) => e.key)).toEqual(['b0', 'b1', 'b2']);
    expect(entries.find((e) => e.key === 'b1')?.title).toBe('第2課 文法まとめ');
  });

  it('确认全部并采用：keep 保留 + update/add 生效 + remove 真删', async () => {
    handle = await setupDom();
    const reports: TocAdoptReport[] = [];
    renderContent({
      rangeText: '1–2',
      baselineCount: 3,
      draft: DRAFT,
      onClose: () => {},
      onAdopt: (report) => reports.push(report),
    });
    clickByText('确认全部并采用');
    expect(reports).toHaveLength(1);
    expect([...(reports[0]?.selectedIds ?? [])].sort()).toEqual(['b1', 'b2', 'n0']);
    const entries = buildParentEntries(reports[0]!);
    expect(entries.map((e) => e.key)).toEqual(['b0', 'n0', 'b1']);
  });

  it('keep 行编辑自动转为人工 update：最终 entries 与 preview 输入含编辑值', async () => {
    handle = await setupDom();
    const reports: TocAdoptReport[] = [];
    renderContent({
      rangeText: '1–2',
      baselineCount: 3,
      draft: DRAFT,
      onClose: () => {},
      onAdopt: (report) => reports.push(report),
    });
    const titleInput = inputByLabel('条目标题 b0');
    // React 受控 input：用原生 setter 触发变更（无需 focus；jsdom focus 会触发 React IE 兼容分支报错）
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) throw new Error('no value setter');
    act(() => {
      setter.call(titleInput, '第1課 会話（订正）');
      titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // 编辑后 keep 行应被自动标记（不再静默丢失）
    expect(document.body.textContent).toContain('已采用');
    clickByText('采用已确认');
    expect(reports).toHaveLength(1);
    expect(reports[0]?.selectedIds).toContain('b0');
    const entries = buildParentEntries(reports[0]!);
    expect(entries.find((e) => e.key === 'b0')?.title).toBe('第1課 会話（订正）');
    const preview = buildPreviewEntries(
      entries.map((e) => ({ title: e.title, printedPage: e.printedPage, level: e.level, kind: e.kind }))
    );
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.entries.some((e) => e.title === '第1課 会話（订正）')).toBe(true);
    }
  });
});
