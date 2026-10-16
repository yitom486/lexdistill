import { expect, it, mock } from 'bun:test';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, setupDom, type DomHandle } from '../toc/__tests__/dom-setup.js';
/**
 * UI-R11 综合回归矩阵（隔离 harness）：全局未知统计留白、Worker 卡键盘可达、
 * 长内容 JA/KO/EN 混排阅读与完成、教材位置恢复与读失败稳定。
 * 全部受控 fixture + 独立 QueryClient，不碰用户数据库与真实网关；
 * 不做真实录音/付费/导入/安装。单测包装 ≤60000ms。
 */

if (process.env['LINGUA_R11_CHILD'] !== '1') {
  it('r11 acceptance matrix (child isolation)', async () => {
    const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_R11_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
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

function mockInfra() {
  mock.module('../../utils/audio.js', () => ({
    sound: { playClick() {}, playCorrect() {}, playMistake() {}, playSuccess() {}, playError() {}, playFanfare() {} },
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
      info: () => {}, error: () => {}, success: () => {}, warning: () => {}, loading: () => {},
    },
  }));
  mock.module('../magicui/index.js', () => ({
    fireSuccessConfetti: () => {},
    NumberTicker: ({ value }: { value: number }) => <span>{value}</span>,
    ShimmerButton: ({ children, onClick, disabled, className }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; className?: string }) => (
      <button type="button" onClick={onClick} disabled={disabled} className={className}>{children}</button>
    ),
  }));
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
  const calls: Array<{ method: string; url: string; body?: string | undefined }> = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ method: init?.method || 'GET', url, body: typeof init?.body === 'string' ? init.body : undefined });
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

/** 导航角标文本（rounded-full 角标，不含“即将”与等级徽标）。 */
function navBadgeTexts(doc: Document): string[] {
  return [...doc.querySelectorAll('aside button span.font-mono.rounded-full')]
    .map((s) => (s.textContent ?? '').trim())
    .filter((t) => t.length > 0);
}

it('全局未知统计：加载/失败时留白不断言 0，有数后显示真实计数', async () => {
  await freshDom();
  mockInfra();
  const { AppSidebar } = await import('../AppSidebar.js');
  const doc = dom!.dom.window.document;
  const originalFetch = globalThis.fetch;
  try {
    let mode: 'hold' | 'error' | 'ok' | 'empty' = 'hold';
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { fetchFn } = makeFetch(async (url) => {
      if (url.includes('/api/questions/') || url.includes('/api/cards/') || url.includes('/api/mistakes/')) {
        if (mode === 'hold') await gate;
        if (mode === 'error') return new Response('boom', { status: 500 });
        if (mode === 'empty') return Response.json([]);
        if (url.includes('/api/questions/')) {
          return Response.json([
            { id: 'q1', type: 'MULTIPLE_CHOICE' },
            { id: 'q2', type: 'MULTIPLE_CHOICE' },
          ]);
        }
        if (url.includes('/api/cards/')) {
          return Response.json([
            { id: 'c1', front: '水', back: '水', fsrs: { dueAt: '2000-01-01T00:00:00.000Z' } },
            { id: 'c2', front: '火', back: '火', fsrs: { dueAt: '2000-01-01T00:00:00.000Z' } },
          ]);
        }
        return Response.json([
          { id: 'm1', isResolved: false, question: {}, lastUserSubmission: '', lastGrading: {}, consecutiveCorrect: 0 },
        ]);
      }
      if (url.includes('/api/learning/plan/')) return Response.json({ completedCount: 0, totalCount: 0 });
      return Response.json({});
    });
    globalThis.fetch = fetchFn;
    const client = makeClient();
    await act(async () => { dom!.root.render(<QueryClientProvider client={client}><AppSidebar /></QueryClientProvider>); });
    await waitFor(() => !!doc.querySelector('aside'));
    // 读取中：角标留白，不出现 0 或 1/1
    expect(navBadgeTexts(doc).some((t) => t === '0' || t === '1/1')).toBe(false);
    mode = 'error';
    release();
    await waitFor(() => {
      const states = client.getQueryCache().getAll().filter(q => ['questions', 'cards', 'mistakes'].includes(String(q.queryKey[1])));
      return states.length === 3 && states.every(q => q.state.status === 'error');
    });
    // 读取失败：同样留白
    expect(navBadgeTexts(doc).some((t) => t === '0' || t === '1/1')).toBe(false);
    mode = 'ok';
    await act(async () => { await client.invalidateQueries({ queryKey: ['learner'] }); });
    await waitFor(() => navBadgeTexts(doc).includes('2'));
    // 真实计数：2 张到期卡、1 未解决错题、1/2 题库进度
    expect(navBadgeTexts(doc)).toContain('1');
    expect(navBadgeTexts(doc)).toContain('1/2');
    mode = 'empty';
    await act(async () => { await client.invalidateQueries({ queryKey: ['learner'] }); });
    await waitFor(() => navBadgeTexts(doc).includes('0') && !navBadgeTexts(doc).includes('1/2') && !navBadgeTexts(doc).includes('2'));
    expect(navBadgeTexts(doc)).toContain('0/0');
    expect(navBadgeTexts(doc)).not.toContain('0/1');
    expect(navBadgeTexts(doc)).toContain('0');
    client.clear();
  } finally {
    globalThis.fetch = originalFetch;
  }
}, 60000);

it('Worker 卡：键盘可进入并激活，等价于点击', async () => {
  await freshDom();
  mockInfra();
  const { AgentWorkerCard } = await import('../importer/monitor/AgentWorkerCard.js');
  const doc = dom!.dom.window.document;
  const opened: string[] = [];
  const worker = {
    workerIndex: 1,
    sessionId: 'session-abcdef123456',
    stage: 'extracting',
    stageText: '模型深度提炼',
    attemptCount: 1,
    lessonTitle: '第一課',
  };
  await act(async () => { dom!.root.render(<AgentWorkerCard worker={worker as never} onClickDetails={() => { opened.push('x'); }} />); });
  const card = doc.querySelector('[role="button"]') as HTMLElement;
  expect(card).toBeTruthy();
  expect(card.getAttribute('tabindex')).toBe('0');
  expect(card.getAttribute('aria-label')).toContain('第一課');
  card.focus();
  expect(doc.activeElement).toBe(card);
  await act(async () => {
    card.dispatchEvent(new dom!.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await act(async () => {
    card.dispatchEvent(new dom!.dom.window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  });
  expect(opened.length).toBe(2);
  await act(async () => { card.dispatchEvent(new dom!.dom.window.KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true })); });
  expect(opened.length).toBe(2);
}, 30000);

it('长内容混排阅读：JA 长文 + KO/EN 选项可作答计分并完成', async () => {
  await freshDom();
  mockInfra();
  const { ReadingComprehensionWorkbench } = await import('../ReadingComprehensionWorkbench.js');
  const doc = dom!.dom.window.document;
  const originalFetch = globalThis.fetch;
  try {
    const longBody = 'これはテスト本文です。'.repeat(150);
    const { fetchFn, calls } = makeFetch(async (url, init) => {
      if (url.includes('/api/reading/sets')) {
        return Response.json([{
          id: 'set-long', origin: 'ai', title: '長文テスト Long Title 混合 한국어 and English',
          topic: '総合', difficulty: 5, language: 'JA', sourceLabel: 'AI 生成', sourceKind: 'ai',
          body: longBody,
          questions: [
            { id: 'q1', prompt: '第一問', options: [{ key: 'A', text: '正解です' }, { key: 'B', text: '오답입니다 wrong' }], correctAnswer: 'A', explanation: '解説1' },
            { id: 'q2', prompt: '第二問', options: [{ key: 'A', text: '틀렸습니다' }, { key: 'B', text: 'correct正解' }], correctAnswer: 'B', explanation: '解説2' },
          ],
        }]);
      }
      if (url.includes('news-topics')) return Response.json([{ id: 'world', label: '国際' }]);
      if (url.includes('/api/reading/practice/') && init?.method === 'POST') return Response.json({});
      return Response.json({});
    });
    globalThis.fetch = fetchFn;
    const client = makeClient();
    await act(async () => { dom!.root.render(<QueryClientProvider client={client}><ReadingComprehensionWorkbench /></QueryClientProvider>); });
    await waitFor(() => !!doc.body.textContent?.includes('第一問'));
    expect(doc.body.textContent).toContain('長文テスト Long Title 混合 한국어 and English');
    expect(doc.body.textContent).toContain('오답입니다 wrong');
    const panel = doc.body;
    await act(async () => { ([...panel.querySelectorAll('button')].find((b) => b.textContent?.includes('正解です')) as HTMLButtonElement).click(); });
    await act(async () => { ([...panel.querySelectorAll('button')].find((b) => b.textContent === '提交本题') as HTMLButtonElement).click(); });
    await waitFor(() => !!doc.body.textContent?.includes('本篇已答对 1 题'));
    await act(async () => { ([...panel.querySelectorAll('button')].find((b) => b.textContent === '下一题') as HTMLButtonElement).click(); });
    await waitFor(() => !!doc.body.textContent?.includes('第二問'));
    await act(async () => { ([...panel.querySelectorAll('button')].find((b) => b.textContent?.includes('correct正解')) as HTMLButtonElement).click(); });
    await act(async () => { ([...panel.querySelectorAll('button')].find((b) => b.textContent === '提交本题') as HTMLButtonElement).click(); });
    await act(async () => { ([...panel.querySelectorAll('button')].find((b) => b.textContent === '完成本篇') as HTMLButtonElement).click(); });
    await waitFor(() => calls.some((c) => c.url.includes('/api/reading/practice/') && c.method === 'POST'));
    const practiceCall = calls.find((c) => c.url.includes('/api/reading/practice/') && c.method === 'POST')!;
    expect((JSON.parse(practiceCall.body ?? '{}') as { score: number }).score).toBe(2);
    client.clear();
  } finally {
    globalThis.fetch = originalFetch;
  }
}, 60000);

it('教材位置：恢复选中已存课次；读取失败不清空当前选择', async () => {
  await freshDom();
  mockInfra();
  const { TextbookCurriculum } = await import('../TextbookCurriculum.js');
  const { useUserProfileStore } = await import('../../stores/useUserProfileStore.js');
  const prevTrack = useUserProfileStore.getState().profile.targetLanguage;
  await act(async () => { useUserProfileStore.setState((s) => ({ profile: { ...s.profile, targetLanguage: 'ja' } })); });
  const sample = await import('../../fixtures/textbook-sample-ast.js');
  const ast = sample.SAMPLE_TEXTBOOK_JSON as unknown as Record<string, unknown>;
  const doc = dom!.dom.window.document;
  const originalFetch = globalThis.fetch;
  try {
    let positionMode: 'saved' | 'fail' = 'saved';
    const secondLesson = {
      ...((ast.lessons as unknown[])[0] as Record<string, unknown>),
      id: 'shinpen-l2', title: '第2課 second lesson 第二课',
    };
    const astJson = JSON.stringify({ ...ast, lessons: [...(ast.lessons as unknown[]), secondLesson] });
    const { fetchFn, calls } = makeFetch(async (url, init) => {
      if (url.includes('/api/documents/') && !url.includes('/position') && !url.includes('/reading-exposures') && !url.includes('/structure') && (!init?.method || init.method === 'GET')) {
        return Response.json([{ id: 'doc1', astJson }]);
      }
      if (url.includes('/structure')) {
        return Response.json({ documentId: 'doc1', headings: [], classes: [], model: '', effort: '', dropped: 0, createdAt: '' });
      }
      if (url.includes('/position') && (!init?.method || init.method === 'GET')) {
        if (positionMode === 'fail') return new Response('boom', { status: 500 });
        return Response.json({ position: { locator: { lessonId: 'shinpen-l2' } } });
      }
      if (url.includes('/api/vocabulary/')) return Response.json([]);
      return Response.json({});
    });
    globalThis.fetch = fetchFn;
    const noop2 = () => undefined;
    const asyncNoop = () => Promise.resolve();
    const client = makeClient();
    await act(async () => {
      dom!.root.render(
        <QueryClientProvider client={client}>
          <TextbookCurriculum onStartLessonQuiz={noop2} onAddCardFromTextbook={asyncNoop} />
        </QueryClientProvider>
      );
    });
    // 已存 shinpen-l2：断点续读恢复选中，不停留在默认第一课
    await waitFor(() => !!doc.querySelector('button[aria-current="true"]')?.textContent?.includes('第2課 second lesson 第二课'));
    await waitFor(() => calls.some(c => c.method === 'PUT' && c.url.includes('/position')));
    const writes = calls.filter(c => c.method === 'PUT' && c.url.includes('/position'));
    expect(writes.every(c => JSON.parse(c.body ?? '{}').locator.lessonId === 'shinpen-l2')).toBe(true);
    // 读取失败：保持当前选择，不清空、不崩溃
    positionMode = 'fail';
    await act(async () => { await client.refetchQueries({ predicate: q => q.queryKey.includes('position') }); });
    await waitFor(() => client.getQueryCache().getAll().some(q => q.queryKey.includes('position') && q.state.status === 'error'));
    expect(doc.querySelector('button[aria-current="true"]')?.textContent).toContain('第2課 second lesson 第二课');
    expect(calls.filter(c => c.method === 'PUT' && c.url.includes('/position')).length).toBe(writes.length);
    client.clear();
  } finally {
    await act(async () => { useUserProfileStore.setState((s) => ({ profile: { ...s.profile, targetLanguage: prevTrack } })); });
    globalThis.fetch = originalFetch;
  }
}, 60000);

it('结构存档：畸形/跨书回执显示失败，缓存保留，真实null静默隐藏', async () => {
  await freshDom();
  mockInfra();
  const { BookStructureRow } = await import('../BookStructureRow.js');
  const doc = dom!.dom.window.document;
  const originalFetch = globalThis.fetch;
  try {
    let payload: unknown = { unexpected: true };
    let status = 200;
    const { fetchFn } = makeFetch(async (url) => {
      if (url.includes('/structure')) return Response.json(payload, { status });
      return Response.json({});
    });
    globalThis.fetch = fetchFn;
    const client = makeClient();
    await act(async () => {
      dom!.root.render(
        <QueryClientProvider client={client}>
          <BookStructureRow documentId="doc1" bookTitle="标日" />
        </QueryClientProvider>
      );
    });
    await waitFor(() => !!doc.body.textContent?.includes('结构存档读取失败'));
    expect(doc.body.textContent).not.toContain('AI 结构存档');
    const valid = { documentId: 'doc1', headings: [], classes: [{ text: '第一课', page: 1, kind: 'lesson', lessonNo: '1', skillId: null }], model: 'model-one', effort: '', dropped: 0, createdAt: '' };
    for (const bad of [{ ...valid, classes: [null] }, { ...valid, model: {} }, { ...valid, documentId: 'other-book' }]) {
      payload = bad;
      await act(async () => { await client.refetchQueries(); });
      expect(doc.body.textContent).toContain('结构存档读取失败');
      expect(doc.body.textContent).not.toContain('AI 结构存档');
    }
    payload = valid;
    await act(async () => { await client.refetchQueries(); });
    await waitFor(() => !!doc.body.textContent?.includes('AI 结构存档'));
    status = 500;
    await act(async () => { await client.refetchQueries(); });
    await waitFor(() => !!doc.body.textContent?.includes('上次读取结果'));
    expect(doc.body.textContent).toContain('model-one');
    status = 200; payload = null;
    await act(async () => { (doc.querySelector('button') as HTMLButtonElement).click(); });
    await waitFor(() => !doc.body.textContent?.includes('结构存档读取失败'));
    expect(doc.body.textContent).not.toContain('AI 结构存档');
    client.clear();
  } finally {
    globalThis.fetch = originalFetch;
  }
}, 30000);

}
