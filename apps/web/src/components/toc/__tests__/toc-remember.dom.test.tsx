import { afterEach, describe, expect, it } from 'bun:test';
import * as React from 'react';
import { TocReviewConfigDialogContent } from '../TocReviewDialogs.js';
import { resolveRememberWrite } from '../../../lib/toc-confirm-flow.js';
import type { TocReviewModelMode } from '../../../lib/toc-confirm-flow.js';
import { usePreferencesStore } from '../../../stores/usePreferencesStore.js';
import { act, setupDom, type DomHandle } from './dom-setup.js';
import type { TocBaselineData } from '../../../lib/toc-confirm-flow.js';

/**
 * P3.5-FIX2-A1 remember 语义 DOM 回归（真实组件 + 真实 zustand persist store）。
 * P1 缺陷：inherit + 记住曾清空已保存偏好。现在：
 * - inherit/inherit 下记住复选框禁用（无可记住内容）；
 * - 混合模式只写 explicit 项，inherit 项逐字不动。
 */

let handle: DomHandle | null = null;

afterEach(() => {
  handle?.teardown();
  handle = null;
  usePreferencesStore.setState({ tocReviewModel: '', tocReviewEffort: '' });
});

const BASELINE = {
  entries: [{ title: '第1課', printedPage: 12, level: 1, kind: 'lesson' }],
  verdict: 'usable',
  pageEvidence: [{ page: 16, excerpt: 'x' }],
} as unknown as TocBaselineData;

function renderHarness(session?: {
  sessionModel: string;
  sessionModelMode: TocReviewModelMode;
  sessionEffort: string;
  sessionEffortMode: TocReviewModelMode;
}): void {
  if (!handle) throw new Error('dom not ready');
  const root = handle.root;
  const s = session ?? {
    sessionModel: '',
    sessionModelMode: 'inherit' as TocReviewModelMode,
    sessionEffort: '',
    sessionEffortMode: 'inherit' as TocReviewModelMode,
  };
  act(() => {
    root.render(
      React.createElement(() => {
        const savedModel = usePreferencesStore((st) => st.tocReviewModel);
        const savedEffort = usePreferencesStore((st) => st.tocReviewEffort);
        const setSavedTocModel = usePreferencesStore((st) => st.setTocReviewModel);
        const setSavedTocEffort = usePreferencesStore((st) => st.setTocReviewEffort);
        return React.createElement(TocReviewConfigDialogContent, {
          rangeText: '16–21',
          baseline: BASELINE,
          evidencePages: 1,
          sizeHint: null,
          reviewDisabledReason: null,
          starting: false,
          savedModel,
          savedEffort,
          sessionModel: s.sessionModel,
          sessionModelMode: s.sessionModelMode,
          sessionEffort: s.sessionEffort,
          sessionEffortMode: s.sessionEffortMode,
          // 与 Panel handleStartReview 完全相同的 persist 应用逻辑
          onStart: (config) => {
            const write = resolveRememberWrite(config);
            if (write.model !== undefined) setSavedTocModel(write.model);
            if (write.effort !== undefined) setSavedTocEffort(write.effort);
          },
          onClose: () => {},
        });
      })
    );
  });
}

function clickByLabel(label: string): void {
  const el = document.querySelector(`[aria-label="${label}"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`control not found: ${label}`);
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

describe('P3.5-FIX2-A1 remember 语义 DOM 回归', () => {
  it('inherit/inherit 下记住复选框禁用（无可记住内容）', async () => {
    handle = await setupDom();
    usePreferencesStore.setState({ tocReviewModel: 'm-saved', tocReviewEffort: 'high' });
    renderHarness();
    const box = document.querySelector('input[aria-label="记住为偏好"]');
    if (!(box instanceof HTMLInputElement)) throw new Error('remember checkbox missing');
    expect(box.disabled).toBe(true);
    expect(document.body.textContent).toContain('跟随偏好时无需记住');
  });

  it('混合模式记住：只写 explicit 项，inherit 项逐字不动', async () => {
    handle = await setupDom();
    usePreferencesStore.setState({ tocReviewModel: 'm-saved', tocReviewEffort: 'high' });
    // 指定模型态走本次覆盖 props 预置（与下拉点选同一条初始化路）；effort 保持跟随偏好
    renderHarness({
      sessionModel: 'm-once',
      sessionModelMode: 'explicit',
      sessionEffort: '',
      sessionEffortMode: 'inherit',
    });
    // 记住此时可用（存在 explicit 项）
    const box = document.querySelector('input[aria-label="记住为偏好"]');
    if (!(box instanceof HTMLInputElement)) throw new Error('remember checkbox missing');
    expect(box.disabled).toBe(false);
    clickByLabel('记住为偏好');
    const startBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('开始重建'));
    if (!startBtn) throw new Error('start button missing');
    act(() => {
      startBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    const state = usePreferencesStore.getState();
    expect(state.tocReviewModel).toBe('m-once');
    expect(state.tocReviewEffort).toBe('high');
  });
});
