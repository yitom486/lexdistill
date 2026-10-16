import { expect, it, mock } from 'bun:test';
import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, setupDom, type DomHandle } from '../toc/__tests__/dom-setup.js';
/**
 * UI-R09a 复习/词汇/词典一致性：受控 fetch + 真容器行为（非样式断言）。
 * 覆盖：复习列表读取中/失败/空/分类空、翻卡与连续评级键盘、隐藏面不可聚焦、
 * 评级示例间隔说明、词典查询四态与词表状态、收藏/草稿接受与失败重试、
 * 模板读取失败与名称显示、切轨道占位。隔离环境，不做真实评级写入、
 * 付费 TTS、录音、词典上传或 Anki 推送。
 */

if (process.env['LINGUA_REVIEW_VOCAB_CHILD'] !== '1') {
  it('review vocabulary states (child isolation)', async () => {
    const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_REVIEW_VOCAB_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ exit, output: exit ? stdout + stderr : '' }).toEqual({ exit: 0, output: '' });
  }, 60000);
} else {

let dom: DomHandle | undefined;

async function freshDom() {
  dom?.teardown();
  dom = await setupDom(true);
  const el = (globalThis as Record<string, unknown>)['Element'] as { prototype: { scrollIntoView?: unknown } } | undefined;
  if (el && typeof el.prototype.scrollIntoView !== 'function') {
    el.prototype.scrollIntoView = function () {};
  }
  return dom;
}

function mockInfra(toasts: string[]) {
  mock.module('../../utils/audio.js', () => ({
    sound: { playClick() {}, playCorrect() {}, playMistake() {}, playSuccess() {} },
    speechStudio: {
      speak: async () => {}, stop: () => {}, replayLast: async () => {}, canReplay: () => false,
      subscribe: () => () => {}, configure: () => {}, getConfig: () => ({}),
      getIsSpeaking: () => false, getIsStreaming: () => false, getStreamedSeconds: () => 0,
      getStreamedChunks: () => 0, getCurrentText: () => '', getStopEpoch: () => 0,
      getLastAudio: () => null, getLastRequest: () => null,
    },
  }));
  mock.module('sonner', () => ({
    toast: {
      info: (m: string) => toasts.push(String(m)),
      error: (m: string) => toasts.push(String(m)),
      success: (m: string) => toasts.push(String(m)),
      warning: (m: string) => toasts.push(String(m)),
    },
  }));
  mock.module('../UnifiedTtsPlayer.js', () => ({ UnifiedTtsPlayer: () => null }));
  mock.module('../magicui/index.js', () => ({ fireSuccessConfetti: () => {} }));
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
}

const settle = async () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
async function waitFor(ready: () => boolean) {
  for (let i = 0; i < 200 && !ready(); i++) await settle();
  expect(ready()).toBe(true);
}

function makeFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const calls: string[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method || 'GET'} ${url}`);
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

const noop = () => undefined;

it('复习列表：读取中/失败重试/真实空/分类空四态分离', async () => {
  await freshDom();
  mockInfra([]);
  const { CardReviewTabContent } = await import('../CardReviewTabContent.js');
  const doc = dom!.dom.window.document;
  const client = makeClient();
  const base = {
    practiceCollectionsCount: 0, onGoToQueue: noop, currentCardIndex: 0,
    cardFilter: 'ALL', onFilterChange: noop, cardFlipped: false, onFlip: noop,
    onReview: noop, onAskAi: noop, onOpenDict: noop, cardSpeechLang: 'JA' as const,
    reviewFormat: undefined, deepStudyOpen: false, onToggleDeepStudy: noop,
    matchingVocab: undefined, totalCards: 0, onResetFilter: noop,
    onGoToStudy: noop, onGoToLibrary: noop, onGoToDictionary: noop, onOpenAnkiImport: noop,
    filteredCards: [] as import('../../models/learning.js').StudyCardItem[],
    cardsLoading: false, cardsError: false, onRetryCards: noop,
  };
  let retried = 0;
  const render = async (props: Record<string, unknown>) => act(async () => {
    dom!.root.render(<QueryClientProvider client={client}><CardReviewTabContent {...base} {...props} /></QueryClientProvider>);
  });
  await render({ filteredCards: [], cardsLoading: true, cardsError: false, onRetryCards: noop });
  expect(doc.body.textContent).toContain('正在读取复习卡片');
  expect(doc.body.textContent).not.toContain('全部复习完毕');
  await render({ filteredCards: [], cardsLoading: false, cardsError: true, onRetryCards: () => { retried += 1; } });
  expect(doc.body.textContent).toContain('复习卡片读取失败');
  await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent === '重新读取') as HTMLButtonElement).click(); });
  expect(retried).toBe(1);
  await render({ filteredCards: [], cardsLoading: false, cardsError: false, onRetryCards: noop });
  expect(doc.body.textContent).toContain('生词本暂无卡片');
  expect(doc.body.textContent).not.toContain('🎉');
  await render({ filteredCards: [], cardsLoading: false, cardsError: false, onRetryCards: noop, cardFilter: 'VOCAB', totalCards: 3 });
  expect(doc.body.textContent).toContain('当前分类下暂无待复习闪卡');
  client.clear();
}, 30000);

it('翻卡键盘：空格/回车翻卡、数字连续评级、隐藏面不可聚焦', async () => {
  await freshDom();
  mockInfra([]);
  const { FsrsCardStage } = await import('../FsrsCardStage.js');
  const doc = dom!.dom.window.document;
  const flips: number[] = [];
  const ratings: string[] = [];
  const card = {
    id: 'c1', frontWord: '食べる', reading: 'たべる', pos: '動詞', backMeaning: '吃',
    tag: 'N5', stability: 2.5, reps: 3, exampleJp: 'ご飯を食べる。', exampleZh: '吃饭。',
    note: '', exampleHighlight: '',
  } as unknown as import('../../models/learning.js').StudyCardItem;
  function Harness() {
    const [flipped, setFlipped] = useState(false);
    return (
      <FsrsCardStage
        card={card}
        cardSpeechLang="JA"
        reviewFormat={undefined}
        cardFlipped={flipped}
        onFlip={() => { flips.push(1); setFlipped((v) => !v); }}
        onReview={(r) => { ratings.push(r); }}
      />
    );
  }
  await act(async () => { dom!.root.render(<Harness />); });
  const key = async (code: string, k: string, target?: Element) => act(async () => {
    (target ?? doc.body).dispatchEvent(new dom!.dom.window.KeyboardEvent('keydown', { code, key: k, bubbles: true }));
  });
  // 未翻卡时数字键不评级
  await key('', '3');
  expect(ratings).toEqual([]);
  // 全局空格翻卡
  await key('Space', ' ');
  expect(flips.length).toBe(1);
  // 已翻卡：数字连续评级
  await key('', '3');
  expect(ratings).toEqual(['GOOD']);
  await key('', '1');
  expect(ratings).toEqual(['GOOD', 'AGAIN']);
  // 隐藏面不可聚焦：正面已 inert
  const front = doc.querySelector('.fsrs-card-face:not(.fsrs-card-back)') as HTMLElement | null;
  const back = doc.querySelector('.fsrs-card-back') as HTMLElement | null;
  expect(front?.hasAttribute('inert')).toBe(true);
  expect(back?.hasAttribute('inert')).toBe(false);
  // 聚焦卡片回车翻回
  const stage = doc.querySelector('.fsrs-card-stage') as HTMLElement | null;
  expect(stage?.getAttribute('tabindex')).toBe('0');
  stage!.focus();
  await key('', 'Enter', stage!);
  expect(flips.length).toBe(2);
}, 30000);

it('评级按钮：示例间隔有说明、点击与快捷键语义一致', async () => {
  await freshDom();
  mockInfra([]);
  const { FsrsRatingButtons } = await import('../FsrsRatingButtons.js');
  const doc = dom!.dom.window.document;
  const seen: string[] = [];
  await act(async () => { dom!.root.render(<FsrsRatingButtons onReview={(r) => seen.push(r)} />); });
  const goods = [...doc.querySelectorAll('button')].find((b) => b.textContent?.includes('良好')) as HTMLButtonElement;
  expect(goods?.title).toContain('快捷键 3');
  const intervals = [...doc.querySelectorAll('button span[title]')];
  expect(intervals.length).toBe(4);
  for (const s of intervals) expect(s.getAttribute('title')).toContain('示例');
  await act(async () => { goods.click(); });
  expect(seen).toEqual(['GOOD']);
}, 30000);

it('词典查询：加载/失败/空/外链/结果分离，词表状态独立', async () => {
  await freshDom();
  const toasts: string[] = [];
  mockInfra(toasts);
  const { DictionaryLookupPanel } = await import('../DictionaryLookupPanel.js');
  const doc = dom!.dom.window.document;
  const originalFetch = globalThis.fetch;
  try {
    let lookupMode: 'hold' | 'error' | 'empty' | 'external' | 'ok' = 'hold';
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const entry = { id: 'e1', headword: '水', reading: 'みず', partOfSpeech: '名詞', meanings: ['水'], sourceLabel: 'JMdict' };
    const { fetchFn } = makeFetch(async (url, init) => {
      if (url.includes('/api/dictionary/history')) return Response.json([{ query: '火', hitCount: 2, createdAt: 't' }]);
      if (url.includes('/api/dictionary/ja?') || url.includes('/api/dictionary/ja&') || /\/api\/dictionary\/ja(\?|$)/.test(url)) {
        if (lookupMode === 'hold') await gate;
        if (lookupMode === 'error') return new Response('boom', { status: 500 });
        if (lookupMode === 'empty') return Response.json({ entries: [] });
        if (lookupMode === 'external') return Response.json({ entries: [], externalLookup: { url: 'https://example.test/x' } });
        return Response.json({ entries: [entry] });
      }
      if (url.includes('/api/wordlists/')) return Response.json([]);
      if (url.includes('/api/cards/')) return Response.json([]);
      if (url.includes('/api/flashcards/anki/status')) return Response.json({ enabled: false, connected: false });
      if (url.includes('/api/level')) return Response.json({ level: 'BEGINNER' });
      if (url.includes('/collect') && init?.method === 'POST') return Response.json({ created: true, card: { id: 'c9' } });
      return Response.json({});
    });
    globalThis.fetch = fetchFn;
    const client = makeClient();
    await act(async () => {
      dom!.root.render(
        <QueryClientProvider client={client}>
          <DictionaryLookupPanel language="ja" title="日语生词本" helper="h" initialQuery="水" />
        </QueryClientProvider>
      );
    });
    await waitFor(() => !!doc.body.textContent?.includes('正在查询本地词典'));
    expect(doc.body.textContent).not.toContain('暫');
    lookupMode = 'error';
    release();
    await waitFor(() => !!doc.body.textContent?.includes('暂时无法查询本地词典'));
    expect(doc.body.textContent).not.toContain('暂未收录');
    lookupMode = 'empty';
    await act(async () => { await client.invalidateQueries({ queryKey: ['learner', 'dictionary'] }); });
    await waitFor(() => !!doc.body.textContent?.includes('暂未收录'));
    lookupMode = 'external';
    await act(async () => { await client.invalidateQueries({ queryKey: ['learner', 'dictionary'] }); });
    await waitFor(() => !!doc.querySelector('a[href="https://example.test/x"]'));
    lookupMode = 'ok';
    await act(async () => { await client.invalidateQueries({ queryKey: ['learner', 'dictionary'] }); });
    await waitFor(() => !!doc.body.textContent?.includes('来源：JMdict'));
    // 展开讲透卡并收藏：成功回执为准
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent === '学透它') as HTMLButtonElement).click(); });
    await waitFor(() => !!doc.body.textContent?.includes('加入生词本'));
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent === '加入生词本') as HTMLButtonElement).click(); });
    await waitFor(() => toasts.some((t) => t.includes('已加入生词本')));
    // 历史 chips 可达且可点
    expect(doc.body.textContent).toContain('火');
    client.clear();
  } finally {
    globalThis.fetch = originalFetch;
  }
}, 60000);

it('词表与轨道：加载中/不可用分离，英语占位按轨道变化', async () => {
  await freshDom();
  mockInfra([]);
  const { DictionaryLookupPanel } = await import('../DictionaryLookupPanel.js');
  const doc = dom!.dom.window.document;
  const originalFetch = globalThis.fetch;
  try {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { fetchFn } = makeFetch(async (url) => {
      if (url.includes('/api/wordlists/')) { await gate; return Response.json([]); }
      if (url.includes('/api/cards/')) return Response.json([]);
      if (url.includes('/api/flashcards/anki/status')) return Response.json({ enabled: false, connected: false });
      if (url.includes('/api/level')) return Response.json({ level: 'BEGINNER' });
      if (url.includes('/api/dictionary/history')) return Response.json([]);
      return Response.json({});
    });
    globalThis.fetch = fetchFn;
    const client = makeClient();
    await act(async () => {
      dom!.root.render(
        <QueryClientProvider client={client}>
          <DictionaryLookupPanel language="ja" title="t" helper="h" />
        </QueryClientProvider>
      );
    });
    await waitFor(() => !!doc.body.textContent?.includes('单词表加载中'));
    release();
    await waitFor(() => !!doc.body.textContent?.includes('单词表暂不可用'));
    client.clear();
    const client2 = makeClient();
    await act(async () => {
      dom!.root.render(
        <QueryClientProvider client={client2}>
          <DictionaryLookupPanel language="en" title="t" helper="h" />
        </QueryClientProvider>
      );
    });
    await waitFor(() => !!doc.querySelector('input[placeholder="例如：resilient"]'));
    client2.clear();
  } finally {
    globalThis.fetch = originalFetch;
  }
}, 30000);

it('草稿箱：加载/空不占位、失败可见可重试、接受与失败回执诚实', async () => {
  await freshDom();
  const toasts: string[] = [];
  mockInfra(toasts);
  const { CardDraftWorkbench } = await import('../CardDraftWorkbench.js');
  const doc = dom!.dom.window.document;
  const originalFetch = globalThis.fetch;
  try {
    let mode: 'hold' | 'empty' | 'error' | 'ok' | 'accept-fail' = 'hold';
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { fetchFn, calls } = makeFetch(async (url, init) => {
      if (url.includes('/api/flashcards/drafts/') && !url.includes('/accept') && !url.includes('/dismiss')) {
        if (mode === 'hold') await gate;
        if (mode === 'empty') return Response.json({ drafts: [] });
        if (mode === 'error') return new Response('boom', { status: 500 });
        return Response.json({ drafts: [
          { id: 'd1', headword: 'w1', reading: 'r1', meanings: ['m1'], source: 'ai-enrich', kind: 'word', editedFields: [] },
          { id: 'd2', headword: 's1', reading: '', meanings: ['译文'], source: 'mystery-source', kind: 'sentence', editedFields: [] },
        ] });
      }
      if (url.includes('/accept') && init?.method === 'POST') {
        if (mode === 'accept-fail') return Response.json({ userMessage: '入库忙，请重试' }, { status: 500 });
        return Response.json({ cardId: 'c1' });
      }
      return Response.json({});
    });
    globalThis.fetch = fetchFn;
    const client = makeClient();
    await act(async () => {
      dom!.root.render(<QueryClientProvider client={client}><CardDraftWorkbench /></QueryClientProvider>);
    });
    await settle();
    // 加载中不占位（保持复习页干净）
    expect(doc.querySelector('section')).toBeNull();
    mode = 'error';
    release();
    await waitFor(() => !!doc.body.textContent?.includes('生词草稿读取失败'));
    mode = 'ok';
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent === '重新读取') as HTMLButtonElement).click(); });
    await waitFor(() => !!doc.body.textContent?.includes('待确认生词'));
    // 未知来源不泄露 raw 值
    expect(doc.body.textContent).toContain('其他来源');
    expect(doc.body.textContent).not.toContain('mystery-source');
    expect(calls.some((c) => c.includes('/accept'))).toBe(false);
    // 接受走真实 POST，回执为准
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '接受草稿并入库：w1') as HTMLButtonElement).click(); });
    await waitFor(() => toasts.some((t) => t.includes('已入库：w1')));
    expect(calls.some((c) => c.includes('/accept') && c.startsWith('POST'))).toBe(true);
    // 接受失败：错误回执，不伪造成功
    mode = 'accept-fail';
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '接受草稿并入库：s1') as HTMLButtonElement).click(); });
    await waitFor(() => toasts.some((t) => t.includes('入库忙')));
    expect(toasts.some((t) => t.includes('已入库：s1'))).toBe(false);
    client.clear();
  } finally {
    globalThis.fetch = originalFetch;
  }
}, 60000);

it('模板工作台：读取失败可重试、显示名称非 raw id、输入有标签', async () => {
  await freshDom();
  mockInfra([]);
  const { useGatewayStore } = await import('../../stores/useGatewayStore.js');
  useGatewayStore.setState({ isConnected: true });
  const { AnkiTemplateWorkbench } = await import('../AnkiTemplateWorkbench.js');
  const doc = dom!.dom.window.document;
  const originalFetch = globalThis.fetch;
  try {
    let mode: 'error' | 'ok' = 'error';
    const { fetchFn } = makeFetch(async (url) => {
      if (url.includes('/api/flashcards/formats')) {
        if (mode === 'error') return new Response('boom', { status: 500 });
        return Response.json({ formats: [{ id: 'study-basic', name: '基础模板', templateVersion: 1, fields: {}, frontTemplate: 'f', backTemplate: 'b', css: '' }] });
      }
      if (url.includes('/preview')) return Response.json({ format: { css: '' }, rendered: { fields: {}, frontHtml: 'F', backHtml: 'B' }, issues: [] });
      return Response.json({});
    });
    globalThis.fetch = fetchFn;
    const client = makeClient();
    await act(async () => {
      dom!.root.render(<QueryClientProvider client={client}><AnkiTemplateWorkbench open onOpenChange={noop} /></QueryClientProvider>);
    });
    await waitFor(() => !!doc.body.textContent?.includes('模板列表读取失败'));
    expect(doc.body.textContent).not.toContain('暂无可用模板');
    mode = 'ok';
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent === '重新读取') as HTMLButtonElement).click(); });
    await waitFor(() => !!doc.body.textContent?.includes('基础模板'));
    expect(doc.body.textContent).not.toContain('study-basic');
    expect(doc.querySelector('input[aria-label="模板名称"]')).toBeTruthy();
    expect(doc.querySelector('[aria-label="选择卡片模板"]')).toBeTruthy();
    client.clear();
  } finally {
    globalThis.fetch = originalFetch;
    useGatewayStore.setState({ isConnected: false });
  }
}, 30000);


it('review shortcuts respect native controls, hidden tabs, modifiers and pending saves', async () => {
  await freshDom(); mockInfra([]);
  const { FsrsCardStage } = await import('../FsrsCardStage.js');
  const doc = dom!.dom.window.document;
  let flips = 0; let dict = 0; const ratings: string[] = [];
  const card = { id: 'key-card', frontWord: 'word', pos: '', backMeaning: 'meaning', tag: '', stability: 1, reps: 0 } as unknown as import('../../models/learning.js').StudyCardItem;
  const render = async (active: boolean, pending = false) => act(async () => {
    dom!.root.render(<FsrsCardStage card={card} cardSpeechLang="EN" cardFlipped onFlip={() => flips++}
      onReview={(r) => ratings.push(r)} onOpenDict={() => dict++} active={active} reviewPending={pending} />);
  });
  const press = async (target: Element, key: string, options: KeyboardEventInit = {}) => {
    const event = new dom!.dom.window.KeyboardEvent('keydown', { key, code: key === ' ' ? 'Space' : '', bubbles: true, cancelable: true, ...options });
    await act(async () => { target.dispatchEvent(event); }); return event;
  };
  await render(true);
  const buttons = [...doc.querySelectorAll('button')];
  const dictionary = buttons.find((b) => b.textContent?.includes('词典') && !b.closest('[inert]'))!;
  expect((await press(dictionary, 'Enter')).defaultPrevented).toBe(false);
  expect((await press(dictionary, ' ')).defaultPrevented).toBe(false);
  await act(async () => { dictionary.click(); });
  expect(dict).toBe(1); expect(flips).toBe(0);
  const stage = doc.querySelector('.fsrs-card-stage')!;
  await press(stage, '3', { ctrlKey: true }); await press(stage, '3', { repeat: true });
  expect(ratings).toEqual([]);
  await press(stage, '3'); expect(ratings).toEqual(['GOOD']);
  await render(false); await press(doc.body, '3'); await press(doc.body, ' ');
  expect(ratings).toEqual(['GOOD']); expect(flips).toBe(0);
  await render(true, true); await press(stage, '3');
  const good = [...doc.querySelectorAll('button')].find((b) => b.textContent?.includes('良好'))!;
  expect(good.disabled).toBe(true); expect(ratings).toEqual(['GOOD']);
});

it('actual word-list HTTP errors reach the view; retry and stale data stay distinct', async () => {
  await freshDom(); mockInfra([]);
  const { DictionaryLookupPanel } = await import('../DictionaryLookupPanel.js');
  const originalFetch = globalThis.fetch; let mode = 'error';
  globalThis.fetch = (async (input: string | URL | Request) => {
    if (String(input).includes('/api/wordlists/')) {
      if (mode === 'error') return new Response('broken', { status: 500 });
      return Response.json(mode === 'empty' ? [] : [{ id: 'actual', title: '真实词包', subtitle: '', words: [] }]);
    }
    return Response.json({});
  }) as unknown as typeof fetch;
  const client = makeClient(); const doc = dom!.dom.window.document;
  try {
    await act(async () => { dom!.root.render(<QueryClientProvider client={client}><DictionaryLookupPanel language="en" title="词典" helper="查词" /></QueryClientProvider>); });
    await waitFor(() => !!doc.body.textContent?.includes('单词表读取失败'));
    expect(doc.body.textContent).not.toContain('单词表暂不可用');
    mode = 'empty';
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent === '重新读取词表') as HTMLButtonElement).click(); });
    await waitFor(() => !!doc.body.textContent?.includes('单词表暂不可用'));
    mode = 'success'; await act(async () => { await client.invalidateQueries({ queryKey: ['wordlists'] }); });
    // Query key uses the shared constant; invalidate every read if the specific prefix differs.
    await act(async () => { await client.invalidateQueries(); });
    await waitFor(() => !!doc.body.textContent?.includes('真实词包'));
    mode = 'error'; await act(async () => { await client.invalidateQueries(); });
    await waitFor(() => !!doc.body.textContent?.includes('显示上次读取的词表'));
    expect(doc.body.textContent).toContain('真实词包');
  } finally { globalThis.fetch = originalFetch; client.clear(); }
}, 30000);

it('template reset hydrates actual returned fields, not only a success toast', async () => {
  await freshDom(); mockInfra([]);
  const { AnkiTemplateWorkbench } = await import('../AnkiTemplateWorkbench.js');
  const { useGatewayStore } = await import('../../stores/useGatewayStore.js');
  const before = useGatewayStore.getState().isConnected;
  useGatewayStore.setState({ isConnected: true });
  const originalFetch = globalThis.fetch; let resets = 0;
  let format = { id: 'study-basic', name: '已修改模板', templateVersion: 1, fields: {}, frontTemplate: 'old-front', backTemplate: 'old-back', css: 'old-css' };
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/reset')) { resets++; format = { ...format, name: '内置模板', templateVersion: 2, frontTemplate: 'restored-front', backTemplate: 'restored-back', css: 'restored-css' }; return Response.json({ format }); }
    if (url.endsWith('/formats')) return Response.json({ formats: [format] });
    return Response.json({});
  }) as unknown as typeof fetch;
  const client = makeClient(); const doc = dom!.dom.window.document;
  try {
    await act(async () => { dom!.root.render(<QueryClientProvider client={client}><AnkiTemplateWorkbench open onOpenChange={noop} /></QueryClientProvider>); });
    await waitFor(() => (doc.querySelector('textarea[data-field="front"]') as HTMLTextAreaElement)?.value === 'old-front');
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent?.includes('恢复内置')) as HTMLButtonElement).click(); });
    await waitFor(() => (doc.querySelector('textarea[data-field="front"]') as HTMLTextAreaElement)?.value === 'restored-front');
    expect((doc.querySelector('input[aria-label="模板名称"]') as HTMLInputElement).value).toBe('内置模板');
    expect((doc.querySelector('textarea[data-field="back"]') as HTMLTextAreaElement).value).toBe('restored-back');
    expect(resets).toBe(1);
    await act(async () => { dom!.root.render(null); });
  } finally { globalThis.fetch = originalFetch; client.clear(); useGatewayStore.setState({ isConnected: before }); }
}, 30000);

it('rapid rating submits once and old completion does not advance a different card', async () => {
  await freshDom(); mockInfra([]);
  const { useReviewActions } = await import('../review/useReviewActions.js');
  let actions!: ReturnType<typeof useReviewActions>; let submissions = 0; let moved = 0;
  let callbacks: { onSuccess: (data: unknown) => void; onSettled: () => void };
  const mutation = { isPending: false, mutate: (_body: unknown, options: typeof callbacks) => { submissions++; callbacks = options; } };
  function Probe({ id }: { id: string }) {
    const card = { id } as import('../../models/learning.js').StudyCardItem;
    actions = useReviewActions({ track: 'en', activeCard: card, filteredCards: [card], currentCardIndex: 0,
      setCurrentCardIndex: () => moved++, setCardFlipped: () => moved++, setDeepStudyOpen: () => moved++, planIsCards: false,
      updateCard: mutation as unknown as ReturnType<typeof import('../../queries/useLearnerQueries.js').useUpdateCardMutation>,
      exportApkg: {} as ReturnType<typeof import('../../queries/useLearnerQueries.js').useExportApkgMutation> });
    return null;
  }
  await act(async () => { dom!.root.render(<Probe id="one" />); });
  await act(async () => { actions.handleCardReview('GOOD'); actions.handleCardReview('GOOD'); });
  expect(submissions).toBe(1);
  await act(async () => { dom!.root.render(<Probe id="two" />); });
  await act(async () => { callbacks.onSuccess({ nextReviewDays: 3, nextFsrs: { stability: 3 } }); callbacks.onSettled(); });
  expect(moved).toBe(0);
  await act(async () => { actions.handleCardReview('GOOD'); });
  expect(submissions).toBe(2);
  await act(async () => { dom!.root.render(null); });
  await act(async () => { callbacks.onSuccess({ nextReviewDays: 3, nextFsrs: { stability: 3 } }); callbacks.onSettled(); });
  expect(moved).toBe(0);
});

it('vocabulary count stays unknown after actual HTTP failure and real empty is zero', async () => {
  await freshDom(); mockInfra([]);
  const { VocabularyLibraryPanel } = await import('../VocabularyLibraryPanel.js');
  const originalFetch = globalThis.fetch; let empty = false;
  globalThis.fetch = (async () => empty ? Response.json([]) : Response.json({ error: { userMessage: '暂时无法读取词汇' } }, { status: 500 })) as unknown as typeof fetch;
  const client = makeClient(); const doc = dom!.dom.window.document;
  try {
    await act(async () => { dom!.root.render(<QueryClientProvider client={client}><VocabularyLibraryPanel language="en" /></QueryClientProvider>); });
    await waitFor(() => !!doc.querySelector('[role="alert"]'));
    expect(doc.querySelector('h2')?.textContent).toContain('—');
    expect(doc.querySelector('h2')?.textContent).not.toContain('0 个词');
    empty = true;
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent === '重试加载') as HTMLButtonElement).click(); });
    await waitFor(() => !!doc.querySelector('h2')?.textContent?.includes('0 个词'));
  } finally { globalThis.fetch = originalFetch; client.clear(); }
});
}
