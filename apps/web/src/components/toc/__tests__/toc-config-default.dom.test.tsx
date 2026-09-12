import { afterEach, describe, expect, it } from 'bun:test';
import * as React from 'react';
import {
  TocReviewConfigDialogContent,
  type TocModelConfig,
  type TocModelOption,
} from '../TocReviewDialogs.js';
import type { TocBaselineData, TocReviewModelMode } from '../../../lib/toc-confirm-flow.js';
import { act, setupDom, type DomHandle } from './dom-setup.js';

/**
 * 真列表模型默认 DOM 回归（真实组件）。
 * - 已保存命中 →  preselect 已保存并显式发送（不再有"跟随"暗态）；
 * - 双默认 → 皆空 + remember=false（不动已保存）；
 * - 已保存不在列表 → 取尾巴小模型（不点名）；
 * - 显式 low 透传。
 *
 * 基座限制见 toc-remember.dom.test.tsx 头注：下拉点开不在 jsdom 里驱动，
 * 状态预置走 props（与 panel 传入 session 同一条初始化路）。
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

const MODELS: TocModelOption[] = [
  { id: 'm-big', label: 'Big', supportedEfforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium' },
  { id: 'm-saved', label: 'Saved', supportedEfforts: [], defaultEffort: '' },
  { id: 'm-luna', label: 'Luna', supportedEfforts: ['low', 'medium'], defaultEffort: 'low' },
];

function renderConfig(args: {
  onStart: (config: TocModelConfig) => void;
  models?: TocModelOption[];
  savedModel?: string;
  savedEffort?: string;
  sessionModel?: string;
  sessionModelMode?: TocReviewModelMode;
  sessionEffort?: string;
  sessionEffortMode?: TocReviewModelMode;
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
        savedModel: args.savedModel ?? 'm-saved',
        savedEffort: args.savedEffort ?? 'high',
        sessionModel: args.sessionModel ?? '',
        sessionModelMode: args.sessionModelMode ?? 'inherit',
        sessionEffort: args.sessionEffort ?? '',
        sessionEffortMode: args.sessionEffortMode ?? 'inherit',
        models: args.models ?? MODELS,
        modelsLoading: false,
        modelsError: null,
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

describe('真列表模型默认 DOM 回归', () => {
  it('已保存命中 → preselect 并显式发送（无暗态）', async () => {
    handle = await setupDom();
    const configs: TocModelConfig[] = [];
    renderConfig({ onStart: (config) => configs.push(config) });
    expect(document.body.textContent).toContain('m-saved');
    expect(document.body.textContent).toContain('本次发送思考等级：high');
    clickStart();
    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({
      model: 'm-saved',
      modelMode: 'explicit',
      effort: 'high',
      effortMode: 'explicit',
      remember: true,
    });
  });

  it('双默认 → 皆空 + remember=false（不动已保存）', async () => {
    handle = await setupDom();
    const configs: TocModelConfig[] = [];
    renderConfig({
      onStart: (config) => configs.push(config),
      sessionModelMode: 'default',
      sessionEffortMode: 'default',
    });
    expect(document.body.textContent).toContain('本次不发送模型');
    expect(document.body.textContent).toContain('本次不发送思考等级');
    clickStart();
    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({
      model: '',
      modelMode: 'default',
      effort: '',
      effortMode: 'default',
      remember: false,
    });
  });

  it('已保存不在列表 → 取尾巴（不点名）', async () => {
    handle = await setupDom();
    const configs: TocModelConfig[] = [];
    renderConfig({
      onStart: (config) => configs.push(config),
      savedModel: 'm-gone',
      savedEffort: '',
    });
    expect(document.body.textContent).toContain('m-luna');
    clickStart();
    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({ model: 'm-luna', modelMode: 'explicit' });
  });

  it('思考等级显式 low → 透传 low/explicit', async () => {
    handle = await setupDom();
    const configs: TocModelConfig[] = [];
    renderConfig({
      onStart: (config) => configs.push(config),
      sessionEffort: 'low',
      sessionEffortMode: 'explicit',
    });
    expect(document.body.textContent).toContain('本次发送思考等级：low');
    clickStart();
    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({ effort: 'low', effortMode: 'explicit' });
  });
});
