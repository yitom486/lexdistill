import { afterEach, describe, expect, it } from 'bun:test';
import * as React from 'react';
import { TocReviewConfigDialogContent, type TocModelConfig } from '../TocReviewDialogs.js';
import type { TocBaselineData } from '../../../lib/toc-confirm-flow.js';
import { act, setupDom, type DomHandle } from './dom-setup.js';

/**
 * P3.5-FIX2 配置强制默认 DOM 回归（真实组件）。
 * saved model 存在时点“使用默认” → onStart 必须带 force-default，
 * 不得回退已保存值。
 */

let handle: DomHandle | null = null;

afterEach(() => {
  handle?.teardown();
  handle = null;
});

const BASELINE = {
  entries: [{ title: '第1課', printedPage: 12, level: 1, kind: 'lesson' }],
  verdict: 'usable',
  pageEvidence: [{ page: 16, excerpt: 'x' }],
} as unknown as TocBaselineData;

function clickByLabel(label: string): void {
  const el = document.querySelector(`[aria-label="${label}"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`control not found: ${label}`);
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

describe('P3.5-FIX2 配置强制默认 DOM 回归', () => {
  it('saved 存在时点使用默认 → onStart 为 force-default（模型与 effort 皆空）', async () => {
    handle = await setupDom();
    const configs: TocModelConfig[] = [];
    const root = handle.root;
    act(() => {
      root.render(
        React.createElement(TocReviewConfigDialogContent, {
          rangeText: '16–21',
          baseline: BASELINE,
          evidencePages: 1,
          sizeHint: null,
          reviewDisabledReason: null,
          starting: false,
          savedModel: 'm-saved',
          savedEffort: 'high',
          sessionModel: '',
          sessionModelMode: 'inherit',
          sessionEffort: '',
          sessionEffortMode: 'inherit',
          onStart: (config) => configs.push(config),
          onClose: () => {},
        })
      );
    });
    // 初始跟随偏好：来源行展示已保存值
    expect(document.body.textContent).toContain('m-saved');
    // 切到使用服务端默认（模型 radio）
    clickByLabel('使用服务端默认模型');
    expect(document.body.textContent).toContain('服务端默认配置');
    // 开始重建
    const startBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('开始重建'));
    if (!startBtn) throw new Error('start button missing');
    act(() => {
      startBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({ model: '', modelMode: 'default' });
  });
});
