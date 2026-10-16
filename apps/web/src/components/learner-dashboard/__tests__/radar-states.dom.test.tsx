import { expect, it, mock } from 'bun:test';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, setupDom } from '../../toc/__tests__/dom-setup.js';
/**
 * UI-R06 学情可信展示：真实 Query→快照→展示链路（QueryClient + 受控 fetch，
 * 非手传 isError fixture）。未知/零/非零/空/失败/一好一坏/陈旧缓存/多语种过滤。
 */
const METRICS = [
  { id: 'en.grammar.tense', dimension: 'GRAMMAR', name: '时态', proficiency: 0.5, totalAttempts: 10, correctAttempts: 5, consecutiveErrors: 2, status: 'WEAKNESS' },
  { id: 'en.vocab.basic', dimension: 'VOCABULARY', name: '基础词汇', proficiency: 0.9, totalAttempts: 20, correctAttempts: 18, consecutiveErrors: 0, status: 'STRENGTH' },
  { id: 'jp.particle.ni', dimension: 'GRAMMAR', name: '助词に', proficiency: 0.1, totalAttempts: 5, correctAttempts: 1, consecutiveErrors: 3, status: 'WEAKNESS' },
  { id: 'en.grammar.unseen', dimension: 'GRAMMAR', name: '尚未练习的技能', proficiency: 0.1, totalAttempts: 0, correctAttempts: 0, consecutiveErrors: 0, status: 'WEAKNESS' },
];
const CARDS = [
  { id: 'c1', front: 'w1', fsrs: { dueAt: '2000-01-01T00:00:00.000Z' } },
  { id: 'c2', front: 'w2', fsrs: { dueAt: '2999-01-01T00:00:00.000Z' } },
];
const MISTAKES = [
  { id: 'm1', isResolved: false },
  { id: 'm2', isResolved: true },
];

it('radar states come from real queries: fail, empty, mixed, ready, stale', async () => {
  if (process.env['LINGUA_RADAR_STATES_CHILD'] !== '1') {
    const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_RADAR_STATES_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ exit, output: exit ? stdout + stderr : '' }).toEqual({ exit: 0, output: '' });
    return;
  }
  const dom = await setupDom(true);
  const originalFetch = globalThis.fetch;
  mock.module('../../../utils/audio.js', () => ({
    sound: { playClick() {}, playCorrect() {}, playMistake() {} },
    speechStudio: {
      speak: async () => {},
      stop: () => {},
      subscribe: () => () => {},
      configure: () => {},
      getConfig: () => ({}),
      getIsSpeaking: () => false,
      getIsStreaming: () => false,
      getStreamedSeconds: () => 0,
      getStreamedChunks: () => 0,
      getCurrentText: () => '',
      getStopEpoch: () => 0,
      getLastAudio: () => null,
      getLastRequest: () => null,
    },
  }));
  mock.module('../../magicui/index.js', () => ({
    NumberTicker: ({ value }: { value: number }) => <span>{value}</span>,
    BentoGrid: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    BentoCard: ({ children, name }: { children: React.ReactNode; name: string }) => <div><p>{name}</p>{children}</div>,
    fireSuccessConfetti: () => {},
    fireGoldenBurstConfetti: () => {},
  }));
  const { LearnerRadarDashboard } = await import('../../LearnerRadarDashboard.js');
  const { useCardsQuery } = await import('../../../queries/cards-mistakes-questions.js');
  const { useMistakesQuery } = await import('../../../queries/cards-mistakes-questions.js');
  const { useLearnerProfileQuery } = await import('../../../queries/profile-plan-analysis.js');
  const doc = dom.dom.window.document;

  const mode: { profile: 'ok' | 'fail' | 'empty' | 'invalid' | 'network'; cards: 'ok' | 'fail' | 'empty'; mistakes: 'ok' | 'fail' | 'empty' } = {
    profile: 'fail', cards: 'fail', mistakes: 'fail',
  };
  let releaseHistory!: () => void;
  let holdHistory = true;
  const historyWait = new Promise<void>((resolve) => { releaseHistory = resolve; });
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      const url = String(input);
      const hit = (p: string) => url.includes(p);
      const fail = (): Response => {
        return new Response('boom', { status: 500 });
      };
      if (hit('/api/profile/')) {
        if (mode.profile === 'network') throw new TypeError('Network unreachable');
        if (mode.profile === 'fail') return fail();
        if (mode.profile === 'invalid') return Response.json({ unexpected: [] });
        return Response.json(mode.profile === 'empty' ? { allMetrics: [] } : { allMetrics: METRICS });
      }
      if (hit('/api/cards/')) {
        if (mode.cards === 'fail') return fail();
        return Response.json(mode.cards === 'empty' ? [] : CARDS);
      }
      if (hit('/api/mistakes/')) {
        if (mode.mistakes === 'fail') return fail();
        return Response.json(mode.mistakes === 'empty' ? [] : MISTAKES);
      }
      if (hit('/api/task/history')) {
        if (holdHistory) await historyWait;
        return mode.profile === 'fail' ? fail() : Response.json([]);
      }
      if (hit('/api/level/')) return mode.profile === 'fail' ? fail() : Response.json({ level: 'BEGINNER', hint: '已定级' });
      if (hit('/api/encountered-terms')) return mode.cards === 'fail' ? fail() : Response.json([]);
      return new Response('[]');
    },
    { preconnect: originalFetch.preconnect }
  );

  function Host() {
    const cardsQuery = useCardsQuery();
    const mistakesQuery = useMistakesQuery();
    const metricsQuery = useLearnerProfileQuery();
    return <LearnerRadarDashboard cardsQuery={cardsQuery} mistakesQuery={mistakesQuery} metricsQuery={metricsQuery} />;
  }
  const settle = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  };
  const waitFor = async (ready: () => boolean) => {
    for (let i = 0; i < 200 && !ready(); i++) await settle();
    if (!ready()) {
      // eslint-disable-next-line no-console
      console.log('[diag-body]', doc.body.textContent?.slice(0, 500));
    }
    expect(ready()).toBe(true);
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const render = async () => {
    await act(async () => {
      dom.root.render(
        <QueryClientProvider client={client}>
          <Host />
        </QueryClientProvider>
      );
    });
  };
  // 同一 client 下用 resetQueries 切场景（清缓存重拉），避免更换 Provider 导致的订阅残留
  const resetTo = async () => {
    await act(async () => {
      await client.resetQueries();
    });
  };
  try {
    // 1. 三源全失败：三处错误面板 + 重试，无伪造零值
    await render();
    await waitFor(() => doc.body.textContent?.includes('画像读取失败') === true);
    expect(doc.body.textContent).toContain('定级信息读取失败');
    expect(doc.body.textContent).not.toContain('零基础 / 入门');
    expect(doc.body.textContent).toContain('相遇词热力（—）');
    expect(doc.body.textContent).toContain('正在读取学习足迹');
    expect(doc.querySelector('button[aria-label*="：无记录"]')).toBeNull();
    holdHistory = false;
    releaseHistory();
    await waitFor(() => doc.body.textContent?.includes('学习足迹读取失败') === true);
    expect(doc.body.textContent).toContain('闪卡读取失败');
    expect(doc.body.textContent).toContain('错题读取失败');
    expect(doc.body.textContent).not.toContain('张活跃卡片');
    expect(doc.body.textContent).not.toContain('待评测');

    // 2. 三源成功空：待评测 + 诚实零 + 普通入口，无错误面板
    mode.profile = 'empty'; mode.cards = 'empty'; mode.mistakes = 'empty';
    await resetTo();
    await waitFor(() => doc.body.textContent?.includes('待评测') === true);
    expect(doc.body.textContent).toContain('暂无闪卡');
    expect(doc.body.textContent).toContain('暂无错题记录');
    expect(doc.body.textContent).toContain('去做题');
    expect(doc.body.textContent).not.toContain('读取失败');
    const dateButtons = [...doc.querySelectorAll<HTMLButtonElement>('button[aria-label*="："]')];
    expect(dateButtons).toHaveLength(28);
    const pastDay = dateButtons.find((button) => !button.disabled && button.textContent !== '今');
    expect(pastDay?.tabIndex).toBe(0);
    await act(async () => { pastDay?.focus(); pastDay?.click(); });
    expect(doc.querySelector('[role="status"][aria-label$="学习战报"]')?.textContent).toContain('当日暂未记录学习足迹');
    const closeDetail = [...doc.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '关闭');
    await act(async () => { closeDetail?.click(); });
    expect(doc.querySelector('[aria-label$="学习战报"]')).toBeNull();

    // 空缓存也是有效旧结果：刷新失败必须提示陈旧，不能假装刚读取成功。
    mode.profile = 'fail'; mode.cards = 'fail'; mode.mistakes = 'fail';
    await act(async () => { await client.invalidateQueries(); });
    await waitFor(() => doc.body.textContent?.includes('画像可能不是最新') === true);
    expect(doc.body.textContent).toContain('暂无闪卡');
    expect(doc.body.textContent).toContain('暂无错题记录');
    expect(doc.body.textContent).toContain('档位可能不是最新');
    expect(doc.body.textContent).toContain('相遇词可能不是最新');
    expect(doc.body.textContent).toContain('足迹可能不是最新');

    // 3. 一坏两好：错题失败不污染闪卡与画像；下一步跳过失败源
    mode.profile = 'ok'; mode.cards = 'ok'; mode.mistakes = 'fail';
    await resetTo();
    await waitFor(() => doc.body.textContent?.includes('错题读取失败') === true);
    expect(doc.body.textContent).toContain('张活跃卡片');
    expect(doc.body.textContent).toContain('77%');
    expect(doc.body.textContent).toContain('去复习闪卡');
    expect(doc.body.textContent).toContain('1 张闪卡到期待复习');
    expect(doc.body.textContent).not.toContain('去清错题');

    // 4. 全有效：下一步指向错题；计数真实；弱项有据才有加练；跨轨道过滤
    mode.mistakes = 'ok';
    await resetTo();
    await waitFor(() => doc.body.textContent?.includes('去清错题') === true);
    expect(doc.body.textContent).toContain('1 道待攻克');
    expect(doc.body.textContent).toContain('去做题');
    expect(doc.body.textContent).not.toContain('助词に');
    expect(doc.body.textContent).not.toContain('靶向加练');
    const unseen = [...doc.querySelectorAll('span')].find((el) => el.textContent === '尚未练习的技能')?.parentElement?.parentElement;
    expect(unseen?.textContent).toContain('待练习');
    expect(unseen?.querySelector('[role="progressbar"]')).toBeNull();
    expect(unseen?.querySelector('button')).toBeNull();
    // 词汇 Tab 真实匹配 VOCABULARY 维度（此前 key 错位导致空 Tab）
    const vocabTab = [...doc.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.includes('词汇'));
    expect(vocabTab).toBeDefined();
    await act(async () => (vocabTab as HTMLElement).click());
    await settle();
    expect(doc.body.textContent).toContain('基础词汇');

    // 5. 缓存刷新失败：保留旧数据 + 非最新说明（真实 TanStack 缓存行为）
    mode.profile = 'fail'; mode.cards = 'fail'; mode.mistakes = 'fail';
    await act(async () => {
      await client.invalidateQueries();
    });
    await waitFor(() => doc.body.textContent?.includes('可能不是最新') === true);
    expect(doc.body.textContent).toContain('去清错题');
    expect(doc.body.textContent).toContain('张活跃卡片');

    for (const bad of ['invalid', 'network'] as const) {
      mode.profile = bad;
      await resetTo();
      await waitFor(() => doc.body.textContent?.includes('画像读取失败') === true);
      expect(doc.body.textContent).not.toContain('待评测');
    }
  } finally {
    await act(async () => { dom.root.render(null); });
    await client.cancelQueries();
    client.clear();
    await settle();
    globalThis.fetch = originalFetch;
    dom.teardown();
  }
}, 60000);
