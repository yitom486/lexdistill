import { afterEach, describe, expect, it } from 'bun:test';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, setupDom, type DomHandle } from './dom-setup.js';
import { TocLiveProgress } from '../TocLiveProgress.js';

let handle: DomHandle | null = null;
let client: QueryClient | null = null;

afterEach(() => {
  handle?.teardown();
  handle = null;
  client?.clear();
  client = null;
});

async function renderProgress(props: React.ComponentProps<typeof TocLiveProgress>): Promise<void> {
  handle = await setupDom();
  client = new QueryClient();
  const root = handle.root;
  act(() => {
    root.render(
      <QueryClientProvider client={client!}>
        <TocLiveProgress {...props} />
      </QueryClientProvider>
    );
  });
}

describe('TocLiveProgress (Magic UI 目录提取实时进度与事件流)', () => {
  it('未在提取且无结果时静默不渲染', async () => {
    await renderProgress({ isExtracting: false, traceId: 't-1' });
    expect(handle?.container.querySelector('section')).toBeNull();
  });

  it('正在提取时渲染 Magic UI 动态卡片、4 阶段步进与耗时计时器', async () => {
    await renderProgress({
      isExtracting: true,
      traceId: 'trace-live-1',
      startedAt: Date.now() - 5000,
      modelName: 'gemini-2.5-pro',
    });

    const section = handle?.container.querySelector('section');
    expect(section).not.toBeNull();
    expect(section?.getAttribute('aria-label')).toBe('大模型目录提炼实时进度');

    const text = handle?.container.textContent ?? '';
    expect(text).toContain('切片目录');
    expect(text).toContain('会话建立');
    expect(text).toContain('流式推理');
    expect(text).toContain('大纲组装');

    const progress = handle?.container.querySelector('[role="progressbar"]');
    expect(progress).not.toBeNull();
    expect(text).toContain('实时事件流');
  });

  it('提取完成后渲染成功摘要徽标', async () => {
    await renderProgress({
      isExtracting: false,
      traceId: 'trace-live-2',
      lastExtractedCount: 18,
      startedAt: Date.now() - 8000,
    });

    const text = handle?.container.textContent ?? '';
    expect(text).toContain('目录提炼完成！成功识别 18 条章节与课次大纲');
  });
});
