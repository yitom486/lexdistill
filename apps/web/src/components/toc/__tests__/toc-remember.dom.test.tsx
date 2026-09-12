import { afterEach, describe, expect, it } from 'bun:test';
import * as React from 'react';
import { TocReviewConfigDialogContent, type TocModelOption } from '../TocReviewDialogs.js';
import { resolveRememberWrite } from '../../../lib/toc-confirm-flow.js';
import type { TocReviewModelMode } from '../../../lib/toc-confirm-flow.js';
import { usePreferencesStore } from '../../../stores/usePreferencesStore.js';
import { act, setupDom, type DomHandle } from './dom-setup.js';
import type { TocBaselineData } from '../../../lib/toc-confirm-flow.js';

/**
 * remember 语义 DOM 回归（真实组件 + 真实 zustand persist store）。
 * 复选框已删除：开始即记住显式选择（zustand，下次默认使用）；
 * 双默认不动已保存（无静默清空）。
 *
 * 基座限制见 toc-config-default.dom.test.tsx 头注：下拉点开不在 jsdom 里驱动。
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

const MODELS: TocModelOption[] = [
  { id: 'm-big', label: 'Big', supportedEfforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium' },
  { id: 'm-saved', label: 'Saved', supportedEfforts: [], defaultEffort: '' },
  { id: 'm-luna', label: 'Luna', supportedEfforts: ['low', 'medium'], defaultEffort: 'low' },
];

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
          models: MODELS,
          modelsLoading: false,
          modelsError: null,
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

function clickStart(): void {
  const startBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('开始重建'));
  if (!startBtn) throw new Error('start button missing');
  act(() => {
    startBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

describe('remember 语义 DOM 回归', () => {
  it('双默认开始 → store 逐字不动（无静默清空）', async () => {
    handle = await setupDom();
    usePreferencesStore.setState({ tocReviewModel: 'm-saved', tocReviewEffort: 'high' });
    renderHarness({
      sessionModel: '',
      sessionModelMode: 'default',
      sessionEffort: '',
      sessionEffortMode: 'default',
    });
    clickStart();
    const state = usePreferencesStore.getState();
    expect(state.tocReviewModel).toBe('m-saved');
    expect(state.tocReviewEffort).toBe('high');
  });

  it('显式模型开始 → 只写模型，默认思考档清空已保存（预览已明示）', async () => {
    handle = await setupDom();
    usePreferencesStore.setState({ tocReviewModel: 'm-saved', tocReviewEffort: 'high' });
    renderHarness({
      sessionModel: 'm-luna',
      sessionModelMode: 'explicit',
      sessionEffort: '',
      sessionEffortMode: 'default',
    });
    expect(document.body.textContent).toContain('将清空已保存思考等级偏好');
    clickStart();
    const state = usePreferencesStore.getState();
    expect(state.tocReviewModel).toBe('m-luna');
    expect(state.tocReviewEffort).toBe('');
  });
});
