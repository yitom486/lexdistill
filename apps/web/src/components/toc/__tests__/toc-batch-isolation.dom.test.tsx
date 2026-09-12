import { afterEach, describe, expect, it } from 'bun:test';
import * as React from 'react';
import { TocResultDialogContent } from '../TocResultDialog.js';
import type { TocReviewDraft } from '../../../lib/toc-confirm-flow.js';
import { act, setupDom, type DomHandle } from './dom-setup.js';

/**
 * P3.5-FIX2 批次隔离 DOM 回归（真实组件挂载）。
 *
 * - 同一批次（同 key）关闭再打开：勾选/编辑/筛选回显；
 * - 新批次（新 key + 新 draft）：rows、selectedIds、filter、编辑全部清空；
 * - key 变化必须重挂（state 不得跨批次泄漏）。
 */

let handle: DomHandle | null = null;

afterEach(() => {
  handle?.teardown();
  handle = null;
});

function draftWithTitle(title: string): TocReviewDraft {
  return {
    entries: [
      { entryId: 'b0', title, printedPage: 12, level: 1, kind: 'lesson', confidence: null, needsReview: false },
      { entryId: 'n0', title: '復習A', printedPage: 16, level: 1, kind: 'lesson', confidence: 'high', needsReview: false },
    ],
    warnings: [],
    diff: [
      {
        entryId: 'b0', change: 'keep', needsReview: false, reason: null,
        before: { title, printedPage: 12, level: 1, kind: 'lesson', confidence: null },
        after: { title, printedPage: 12, level: 1, kind: 'lesson', confidence: null },
      },
      {
        entryId: 'n0', change: 'add', needsReview: false, reason: '漏项',
        before: null,
        after: { title: '復習A', printedPage: 16, level: 1, kind: 'lesson', confidence: 'high' },
      },
    ],
  };
}

function renderBatch(batchKey: string | number, draft: TocReviewDraft, adoption?: { ids: string[] }): void {
  if (!handle) throw new Error('dom not ready');
  const root = handle.root;
  act(() => {
    root.render(
      React.createElement(TocResultDialogContent, {
        key: String(batchKey),
        rangeText: '1–2',
        baselineCount: 1,
        draft,
        ...(adoption ? { initialAdoption: { ids: adoption.ids, editedById: {} } } : {}),
        onClose: () => {},
      })
    );
  });
}

function unmount(): void {
  if (!handle) throw new Error('dom not ready');
  const root = handle.root;
  act(() => {
    root.render(null);
  });
}

function clickByText(text: string): void {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
  if (!btn) throw new Error(`button not found: ${text}`);
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function adoptedBadgeCount(): number {
  return [...document.querySelectorAll('div,span')].filter((s) => s.textContent === '已采用').length;
}

function titleValue(entryId: string): string | null {
  const el = document.querySelector(`input[aria-label="条目标题 ${entryId}"]`);
  return el instanceof HTMLInputElement ? el.value : null;
}

function filterState(): string | null {
  const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-pressed') === 'true');
  return btn?.textContent ?? null;
}

describe('P3.5-FIX2 批次隔离 DOM 回归', () => {
  it('同批次关闭重开经父级回执回显；新批次清空 rows/selected/filter/编辑', async () => {
    handle = await setupDom();
    const batch1 = draftWithTitle('第1課 会話');
    renderBatch('run-1', batch1);
    // 标记 n0 + 切到仅看变更
    const n0Row = document.querySelector('input[aria-label="条目标题 n0"]')?.closest('tr');
    if (!n0Row) throw new Error('n0 row missing');
    const confirmBtn = [...n0Row.querySelectorAll('button')].find((b) => b.textContent?.includes('确认本条'));
    if (!confirmBtn) throw new Error('confirm button missing');
    act(() => {
      confirmBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    clickByText('仅看变更');
    expect(adoptedBadgeCount()).toBe(1);
    // 仅看变更下 keep 行隐藏（查 input 不存在，而非 textContent）
    expect(titleValue('b0')).toBeNull();

    // 关闭（卸载）→ 同批次重开：无父级回执则干净（不残留旧勾选）
    unmount();
    renderBatch('run-1', batch1);
    expect(adoptedBadgeCount()).toBe(0);

    // 同批次重开携带父级回执 → 回显勾选
    unmount();
    renderBatch('run-1', batch1, { ids: ['n0'] });
    expect(adoptedBadgeCount()).toBe(1);

    // 新批次：不同标题 + 新 key，必须全清（即使旧回执也不得串入）
    unmount();
    const batch2 = draftWithTitle('第9課 新标题');
    renderBatch('run-2', batch2);
    expect(adoptedBadgeCount()).toBe(0);
    // filter 回到完整目录：keep 行可见且为新值
    expect(filterState()).toContain('完整目录');
    expect(titleValue('b0')).toBe('第9課 新标题');
    // footer 回到 0 采用
    expect(document.body.textContent).toContain('已采用 0/1');
  });
});
