import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DailyWordStudyHub } from '../DailyWordStudyHub.js';
import { act, setupDom, type DomHandle } from '../../toc/__tests__/dom-setup.js';

let handle: DomHandle | null = null;
let queryClient: QueryClient | null = null;
const originalFetch = globalThis.fetch;
let interceptedRequests: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];

const MOCK_GROUPS = [
  {
    id: 'ja-n5-core',
    title: 'JLPT N5 核心词库',
    subtitle: '零基础筑基',
    words: [
      {
        entryId: 'w1',
        headword: '食べる',
        reading: 'たべる',
        meanings: ['吃'],
        sourceLabel: 'N5',
        collected: false,
        studied: false,
        jlpt: 'N5',
      },
    ],
  },
  {
    id: 'ja-n4-core',
    title: 'JLPT N4 进阶词库',
    subtitle: '进阶突破',
    words: [
      {
        entryId: 'w2',
        headword: '案内',
        reading: 'あん难い',
        meanings: ['向导', '带路'],
        sourceLabel: 'N4',
        collected: false,
        studied: false,
        jlpt: 'N4',
      },
    ],
  },
];

async function tickUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('界面未在预期时间内更新');
    }
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
}

async function clickByText(text: string): Promise<void> {
  await tickUntil(() =>
    [...document.querySelectorAll('button')].some((b) => b.textContent?.includes(text))
  );
  const btn = [...document.querySelectorAll('button')].find((b) =>
    b.textContent?.includes(text)
  );
  if (!btn) throw new Error(`未找到按钮: ${text}`);
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

beforeEach(async () => {
  handle = await setupDom(true);
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  interceptedRequests = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';

    if (url.includes('/api/wordlists/')) {
      return Response.json(MOCK_GROUPS);
    }

    if (url.includes('/daily-pick')) {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      interceptedRequests.push({ url, method, body });

      if (body.bankId === 'ja-n4-core') {
        return new Response(
          JSON.stringify({
            error: {
              code: 'E_BANK_LOCKED',
              userMessage: '该词库需 N4 掌握率 80% 解锁，当前 35%',
            },
            data: {
              requiredMastery: 0.8,
              currentMastery: 0.35,
            },
          }),
          {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      return Response.json({
        words: [
          {
            entryId: 'w1',
            headword: '食べる',
            reading: 'たべる',
            meanings: ['吃'],
            sourceLabel: 'N5',
            collected: false,
            studied: false,
            jlpt: 'N5',
          },
        ],
        pick: {
          bankId: 'ja-n5-core',
          requested: body.count ?? 10,
          returned: 1,
          unlockedJlptMax: 'N5',
          skippedLocked: 0,
        },
      });
    }

    if (url.includes('/api/vocabulary/')) {
      return Response.json([]);
    }

    if (url.includes('/api/cards/')) {
      return Response.json([]);
    }

    return Response.json({});
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  handle?.teardown();
  handle = null;
  queryClient?.clear();
  queryClient = null;
});

describe('DailyWordStudyHub 后端门控抽取与锁库回归', () => {
  it('成功调用后端 daily-pick 抽取并渲染单词及 JLPT 等级', async () => {
    if (!handle || !queryClient) throw new Error('DOM or QueryClient not initialized');

    act(() => {
      handle!.root.render(
        <QueryClientProvider client={queryClient!}>
          <DailyWordStudyHub language="ja" onGoToReview={() => {}} />
        </QueryClientProvider>
      );
    });

    // 等待词库数据加载完成
    await tickUntil(() => document.body.textContent?.includes('JLPT N5 核心词库') ?? false);

    // 点击开启学习按钮
    await clickByText('开启今日 10 词精学之旅');

    // 验证发出 POST daily-pick 请求
    await tickUntil(() => interceptedRequests.length > 0);
    const pickReq = interceptedRequests[0];
    expect(pickReq).toBeDefined();
    expect(pickReq?.method).toBe('POST');
    expect(pickReq?.url).toContain('/daily-pick');
    expect(pickReq?.body).toEqual({
      lang: 'ja',
      count: 10,
      order: 'random',
      bankId: 'ja-n5-core',
    });

    // 验证进入学习阶段并展示词汇
    await tickUntil(() => document.body.textContent?.includes('食べる') ?? false);
    expect(document.body.textContent).toContain('たべる');
    expect(document.body.textContent).toContain('吃');
    expect(document.body.textContent).toContain('N5');
    // 验证真实词库名展示，无虚构的 documentId 或 AI 兜底标记
    expect(document.body.textContent).toContain('JLPT N5 核心词库');
    expect(document.body.textContent).not.toContain('n5-lexicon');
  });

  it('409 锁库响应正确展示横幅并置灰 CTA，切库后解除', async () => {
    if (!handle || !queryClient) throw new Error('DOM or QueryClient not initialized');

    act(() => {
      handle!.root.render(
        <QueryClientProvider client={queryClient!}>
          <DailyWordStudyHub language="ja" onGoToReview={() => {}} />
        </QueryClientProvider>
      );
    });

    // 等待加载
    await tickUntil(() => document.body.textContent?.includes('JLPT N4 进阶词库') ?? false);

    // 切换到 N4 词库
    await clickByText('JLPT N4 进阶词库');

    // 点击启动学习
    await clickByText('开启今日 10 词精学之旅');

    // 等待 409 响应和锁定横幅渲染
    await tickUntil(() => document.body.textContent?.includes('该词库需 N4 掌握率 80% 解锁，当前 35%') ?? false);

    // 验证横幅展示
    const alertEl = document.querySelector('[role="alert"]');
    expect(alertEl).not.toBeNull();
    expect(alertEl?.textContent).toContain('词库已锁定');
    expect(alertEl?.textContent).toContain('该词库需 N4 掌握率 80% 解锁，当前 35%');

    // 验证 CTA 按钮被置灰禁用
    const ctaBtn = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('开启今日 10 词精学之旅')
    );
    expect(ctaBtn).toBeDefined();
    expect(ctaBtn?.disabled).toBe(true);

    // 验证没有进入学习阶段
    expect(document.body.textContent).not.toContain('第 1 / 10 词');

    // 切换回可用的 N5 词库
    await clickByText('JLPT N5 核心词库');

    // 验证锁定横幅消失，CTA 恢复可用状态
    await tickUntil(() => document.querySelector('[role="alert"]') === null);
    expect(ctaBtn?.disabled).toBe(false);
  });
});
