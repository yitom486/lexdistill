import { afterEach, describe, expect, it } from 'bun:test';
import * as React from 'react';
import { TocReviewConfigDialogContent, type TocModelConfig } from '../TocReviewDialogs.js';
import type { TocBaselineData, TocReviewModelMode } from '../../../lib/toc-confirm-flow.js';
import { act, setupDom, type DomHandle } from './dom-setup.js';

/**
 * P3.5-FIX2 配置强制默认 DOM 回归（真实组件）。
 * saved model 存在时选“服务端默认” → onStart 必须带 force-default，
 * 不得回退已保存值。
 *
 * 基座限制（2026-09-12 实测）：Base UI Select 的 mousedown/pointerdown/focus/
 * KeyboardEvent 链在 jsdom 基座里会删掉注入的 window/document 全局（浏览器里
 * window 不可配置故无影响，纯基座产物），因此下拉"点开"动作不在 jsdom 里驱动；
 * 状态预置走 props（与 panel 传入 session 覆盖同一条路），点选动作由浏览器
 * 真机断言覆盖。click（普通按钮/复选框）与 input 输入在基座里安全。
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

function renderConfig(args: {
  onStart: (config: TocModelConfig) => void;
  sessionModelMode: TocReviewModelMode;
  sessionEffortMode: TocReviewModelMode;
}): void {
  if (!handle) throw new Error('dom not ready');
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
        sessionModelMode: args.sessionModelMode,
        sessionEffort: '',
        sessionEffortMode: args.sessionEffortMode,
        onStart: args.onStart,
        onClose: () => {},
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

describe('P3.5-FIX2 配置强制默认 DOM 回归', () => {
  it('跟随偏好：生效预览展示已保存值，onStart 为 inherit 且皆空（后端决议）', async () => {
    handle = await setupDom();
    const configs: TocModelConfig[] = [];
    renderConfig({ onStart: (config) => configs.push(config), sessionModelMode: 'inherit', sessionEffortMode: 'inherit' });
    // 生效预览即真相：跟随态展示将发送的已保存值
    expect(document.body.textContent).toContain('m-saved');
    expect(document.body.textContent).toContain('本次发送已保存思考等级：high');
    clickStart();
    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({ model: '', modelMode: 'inherit', effort: '', effortMode: 'inherit' });
  });

  it('强制服务端默认：预览明示不发送，onStart 为 force-default', async () => {
    handle = await setupDom();
    const configs: TocModelConfig[] = [];
    renderConfig({ onStart: (config) => configs.push(config), sessionModelMode: 'default', sessionEffortMode: 'default' });
    expect(document.body.textContent).toContain('本次不发送模型');
    expect(document.body.textContent).toContain('本次不发送思考等级');
    clickStart();
    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({ model: '', modelMode: 'default', effort: '', effortMode: 'default' });
  });

  it('思考等级显式 low：预览带便宜提示，onStart 透传 low/explicit', async () => {
    handle = await setupDom();
    const configs: TocModelConfig[] = [];
    if (!handle) throw new Error('dom not ready');
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
          sessionEffort: 'low',
          sessionEffortMode: 'explicit',
          onStart: (config) => configs.push(config),
          onClose: () => {},
        })
      );
    });
    expect(document.body.textContent).toContain('本次发送思考等级：low');
    clickStart();
    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({ effort: 'low', effortMode: 'explicit' });
  });
});
