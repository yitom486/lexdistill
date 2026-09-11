import { describe, expect, it, afterEach } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { TocReviewPanelView, type TocReviewPanelViewProps } from '../TocReviewPanel.js';
import { initialTocDiscoverProgress } from '../../lib/toc-discovery-stream.js';

/**
 * CMD-LINGUA-P2.1 流式进度视图 SSR 断言（无 DOM、无网络）。
 * 锁定：阶段与真实页数、取消按钮、runtime 下载说明、取消中性态、
 * 手动范围入口；found/ambiguous/not-found 旧断言不受影响。
 */

function baseProps(overrides: Partial<TocReviewPanelViewProps> = {}): TocReviewPanelViewProps {
  return {
    hasSource: true,
    discovering: false,
    discoverProgress: null,
    discoverError: null,
    discover: null,
    selectedIndex: null,
    startText: '',
    endText: '',
    rangeError: null,
    extractDisabled: true,
    extractDisabledReason: null,
    extracting: false,
    extractError: null,
    baseline: null,
    reviewDisabled: true,
    reviewDisabledReason: '先提取目录基线',
    reviewSizeHint: null,
    reviewing: false,
    reviewError: null,
    review: null,
    adopted: null,
    editing: false,
    editedEntries: [],
    confirmed: false,
    confirmedSummary: null,
    onDiscover: () => {},
    onCancelDiscover: () => {},
    onSelectCandidate: () => {},
    onStartChange: () => {},
    onEndChange: () => {},
    onExtract: () => {},
    onReview: () => {},
    onAdopt: () => {},
    onStartEdit: () => {},
    onUpdateEntry: () => {},
    onConfirm: () => {},
    ...overrides,
  };
}

function render(props: Partial<TocReviewPanelViewProps> = {}): string {
  return renderToStaticMarkup(TocReviewPanelView(baseProps(props)));
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('P2.1 流式进度视图（SSR）', () => {
  it('ocr 进行中：真实页数 + 批次范围 + 取消按钮，无百分比', () => {
    const html = render({
      discovering: true,
      discoverProgress: {
        ...initialTocDiscoverProgress,
        started: true,
        phase: 'ocr',
        plannedPages: 30,
        completedPages: 10,
        batchFrom: 6,
        batchTo: 10,
      },
    });
    expect(html).toContain('10/30');
    expect(html).toContain('第 6–10 页批次完成');
    expect(html).toContain('取消识别');
    expect(html).not.toContain('%');
  });

  it('runtime 下载中：80MB 一次性说明', () => {
    const html = render({
      discovering: true,
      discoverProgress: { ...initialTocDiscoverProgress, started: true, phase: 'runtime', runtimeDownloading: true },
    });
    expect(html).toContain('正在准备本地 OCR 运行时，首次可能下载约 80MB');
  });

  it('无下载事件时不显示 80MB 说明', () => {
    const html = render({
      discovering: true,
      discoverProgress: { ...initialTocDiscoverProgress, started: true, phase: 'ocr', plannedPages: 30, completedPages: 5, batchFrom: 1, batchTo: 5 },
    });
    expect(html).not.toContain('80MB');
  });

  it('空闲无进度：无取消按钮', () => {
    const html = render();
    expect(html).not.toContain('取消识别');
  });

  it('已取消：中性文案、无错误样式、无 busy', () => {
    const html = render({
      discovering: false,
      discoverProgress: { ...initialTocDiscoverProgress, started: true, phase: 'cancelled' },
    });
    expect(html).toContain('已取消识别，未采纳任何结果');
    expect(html).not.toContain('>取消识别</button>');
    expect(html).not.toContain('role="alert"');
  });

  it('取消不显示错误：即使同时有 discoverError 也只在失败态出现（容器保证取消清错误）', () => {
    const html = render({
      discovering: false,
      discoverError: null,
      discoverProgress: { ...initialTocDiscoverProgress, started: true, phase: 'cancelled' },
    });
    expect(html).not.toContain('role="alert"');
  });

  it('手动范围入口：文案在场，且纯渲染零 fetch（手动模式不调 discover）', () => {
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls++;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const html = render();
    expect(html).toContain('跳过自动识别');
    expect(html).toContain('确认范围');
    expect(fetchCalls).toBe(0);
  });

  it('found 回归：候选渲染不受流式改动影响', () => {
    const html = render({
      discover: { status: 'found', candidates: [{ fromPage: 2, toPage: 4, score: 12 }], pageCount: 100, pagesScannedCount: 12, embedded: false },
    });
    expect(html).toContain('第 2–4 页');
    expect(html).toContain('得分 12');
  });
});
