import { expect, it, mock } from 'bun:test';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, setupDom, type DomHandle } from '../toc/__tests__/dom-setup.js';
/**
 * UI-R09b 练习/出题/错题一致性：受控 fetch + 真容器行为（非样式断言）。
 * 覆盖：阅读列表加载/失败重试/成功空/作答计分与成绩回写、错题冲刺快照与
 * 提交期守卫、主观批改失败保答案与迟到回执隔离、自适应空/失败/离线出题、
 * 出题任务失败重试与取消期守卫。隔离环境，不做真实批改/学情写入、
 * 付费 TTS/录音或真实出题运行。
 */

if (process.env['LINGUA_PRACTICE_GEN_CHILD'] !== '1') {
  it('practice generation states (child isolation)', async () => {
    const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_PRACTICE_GEN_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
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
    sound: { playClick() {}, playCorrect() {}, playMistake() {}, playSuccess() {}, playError() {} },
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
      loading: (m: string) => toasts.push(String(m)),
    },
  }));
  mock.module('../magicui/index.js', () => ({
    fireSuccessConfetti: () => {},
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

const noop = () => undefined;

const readingSet = (over: Record<string, unknown> = {}) => ({
  id: 'set1',
  origin: 'ai',
  title: 'テスト記事',
  topic: '総合',
  difficulty: 2,
  language: 'JA',
  sourceLabel: 'AI 生成',
  sourceKind: 'ai',
  body: 'これはテスト本文です。',
  questions: [
    { id: 'q1', prompt: '第一問', options: [{ key: 'A', text: '正解' }, { key: 'B', text: '誤答' }], correctAnswer: 'A', explanation: '解説1' },
    { id: 'q2', prompt: '第二問', options: [{ key: 'A', text: '誤答' }, { key: 'B', text: '正解' }], correctAnswer: 'B', explanation: '解説2' },
  ],
  ...over,
});

const mistakeRow = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  question: { category: '助詞', prompt: '選べ', content: 'わたし__学生', correctAnswer: 'は', explanation: '助詞は', testedSkillId: 'ja.grammar.particle' },
  lastUserSubmission: 'が',
  lastGrading: { correctAnswer: 'は', explanation: '助詞は' },
  consecutiveCorrect: 0,
  isResolved: false,
  ...over,
});

it('阅读：加载/失败重试/成功空分离，作答计分与成绩回写诚实', async () => {
  await freshDom();
  const toasts: string[] = [];
  mockInfra(toasts);
  const { ReadingComprehensionWorkbench } = await import('../ReadingComprehensionWorkbench.js');
  const doc = dom!.dom.window.document;
  const originalFetch = globalThis.fetch;
  try {
    let mode: 'hold' | 'error' | 'empty' | 'ok' = 'hold';
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let saveRelease!: () => void;
    const saveGate = new Promise<void>((r) => { saveRelease = r; });
    let saveFailed = true;
    const { fetchFn, calls } = makeFetch(async (url, init) => {
      if (url.includes('/api/reading/sets')) {
        if (mode === 'hold') await gate;
        if (mode === 'error') return new Response('boom', { status: 500 });
        if (mode === 'empty') return Response.json([]);
        return Response.json([readingSet()]);
      }
      if (url.includes('news-topics')) return Response.json([{ id: 'world', label: '国際' }]);
      if (url.includes('/api/reading/practice/') && init?.method === 'POST') {
        await saveGate;
        return saveFailed ? new Response('save failed', { status: 500 }) : Response.json({});
      }
      return Response.json({});
    });
    globalThis.fetch = fetchFn;
    const client = makeClient();
    await act(async () => { dom!.root.render(<QueryClientProvider client={client}><ReadingComprehensionWorkbench /></QueryClientProvider>); });
    await waitFor(() => !!doc.body.textContent?.includes('正在读取篇目'));
    expect(doc.body.textContent).not.toContain('暂无篇目');
    mode = 'error';
    release();
    await waitFor(() => !!doc.body.textContent?.includes('阅读篇目读取失败'));
    let refetchCalls = calls.filter((c) => c.url.includes('/api/reading/sets')).length;
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent === '重新读取') as HTMLButtonElement).click(); });
    await waitFor(() => calls.filter((c) => c.url.includes('/api/reading/sets')).length > refetchCalls);
    mode = 'empty';
    await act(async () => { await client.invalidateQueries({ queryKey: ['learner', 'reading'] }); });
    await waitFor(() => !!doc.body.textContent?.includes('暂无篇目') || !!doc.body.textContent?.includes('暂无配题'));
    mode = 'ok';
    await act(async () => { await client.invalidateQueries({ queryKey: ['learner', 'reading'] }); });
    await waitFor(() => !!doc.body.textContent?.includes('第一問'));
    mode = 'error';
    await act(async () => { await client.invalidateQueries({ queryKey: ['learner', 'reading'] }); });
    await waitFor(() => !!doc.body.textContent?.includes('以下是已读取内容'));
    expect(doc.body.textContent).toContain('第一問');
    mode = 'ok';
    await act(async () => { await client.invalidateQueries({ queryKey: ['learner', 'reading'] }); });
    // 第一题选错提交：错误回执 + 解析可见，答案未计分
    const panel = doc.body;
    const wrongOpt = [...panel.querySelectorAll('button')].find((b) => b.textContent?.includes('誤答')) as HTMLButtonElement;
    await act(async () => { wrongOpt.click(); });
    await act(async () => { ([...panel.querySelectorAll('button')].find((b) => b.textContent === '提交本题') as HTMLButtonElement).click(); });
    await waitFor(() => toasts.some((t) => t.includes('回答有误')));
    expect(doc.body.textContent).toContain('解説1');
    expect(doc.body.textContent).toContain('本篇已答对 0 题');
    // 下一题选对提交后完成整篇：成绩回写入参 score=1/total=2
    await act(async () => { ([...panel.querySelectorAll('button')].find((b) => b.textContent === '下一题') as HTMLButtonElement).click(); });
    await waitFor(() => !!doc.body.textContent?.includes('第二問'));
    const rightOpt = [...panel.querySelectorAll('button')].find((b) => b.textContent?.includes('正解')) as HTMLButtonElement;
    await act(async () => { rightOpt.click(); });
    await act(async () => { ([...panel.querySelectorAll('button')].find((b) => b.textContent === '提交本题') as HTMLButtonElement).click(); });
    await waitFor(() => toasts.some((t) => t.includes('回答正确')));
    const clickText = async (text: string) => act(async () => { ([...panel.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement).click(); });
    await clickText('上一题');
    await act(async () => { ([...panel.querySelectorAll('button')].find((b) => b.textContent?.includes('誤答')) as HTMLButtonElement).click(); });
    await clickText('提交本题');
    await clickText('下一题');
    await act(async () => { ([...panel.querySelectorAll('button')].find((b) => b.textContent?.includes('正解')) as HTMLButtonElement).click(); });
    await clickText('提交本题');
    expect(doc.body.textContent).toContain('本篇已答对 1 题');
    await act(async () => { ([...panel.querySelectorAll('button')].find((b) => b.textContent === '完成本篇') as HTMLButtonElement).click(); });
    await waitFor(() => calls.some((c) => c.url.includes('/api/reading/practice/') && c.method === 'POST'));
    expect(doc.body.textContent).toContain('第二問');
    expect(doc.body.textContent).toContain('保存成绩中');
    expect(toasts.some((t) => t.includes('本篇成绩已保存'))).toBe(false);
    saveRelease();
    await waitFor(() => [...doc.querySelectorAll('[role="alert"]')].some((node) => node.textContent?.includes('答案已保留')));
    expect(doc.body.textContent).toContain('本篇已答对 1 题');
    saveFailed = false;
    const complete = [...panel.querySelectorAll('button')].find((b) => b.textContent?.includes('完成本篇')) as HTMLButtonElement;
    await act(async () => { complete.click(); complete.click(); });
    await waitFor(() => toasts.some((t) => t.includes('本篇成绩已保存')));
    expect(calls.filter((c) => c.url.includes('/api/reading/practice/') && c.method === 'POST')).toHaveLength(2);
    const practiceCall = calls.find((c) => c.url.includes('/api/reading/practice/') && c.method === 'POST')!;
    const body = JSON.parse(practiceCall.body ?? '{}') as { score: number; totalQuestions: number };
    expect(body.score).toBe(1);
    expect(body.totalQuestions).toBe(2);
    expect(toasts.some((t) => t.includes('本篇成绩已保存：1/2'))).toBe(true);
    client.clear();
  } finally {
    globalThis.fetch = originalFetch;
  }
}, 60000);

it('错题：加载/失败/空分离，冲刺快照隔离与提交期守卫', async () => {
  await freshDom();
  const toasts: string[] = [];
  mockInfra(toasts);
  const { MistakeSprintWorkbench } = await import('../MistakeSprintWorkbench.js');
  const doc = dom!.dom.window.document;
  const originalFetch = globalThis.fetch;
  try {
    let mode: 'hold' | 'error' | 'empty' | 'ok' = 'hold';
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let resolvedM1 = false;
    let retryRelease!: () => void;
    let retryGate: Promise<void> | null = null;
    let retryFailed = true;
    const retryPosts: number[] = [];
    const { fetchFn, calls } = makeFetch(async (url, init) => {
      if (url.includes('/api/mistakes/') && !url.includes('/retry/')) {
        if (mode === 'hold') await gate;
        if (mode === 'error') return new Response('boom', { status: 500 });
        if (mode === 'empty') return Response.json([]);
        return Response.json([
          mistakeRow({ id: 'm1', question: { category: '助詞', prompt: '選べ1', content: 'わたし__学生', correctAnswer: 'は', explanation: 'e1', testedSkillId: 's1' }, consecutiveCorrect: resolvedM1 ? 2 : 0, isResolved: resolvedM1 }),
          mistakeRow({ id: 'm2', question: { category: '動詞', prompt: '選べ2', content: '本__読む', correctAnswer: 'を', explanation: 'e2', testedSkillId: 's2' } }),
        ]);
      }
      if (url.includes('/retry/') && init?.method === 'POST') {
        retryPosts.push(1);
        if (retryGate) await retryGate;
        if (retryFailed) return new Response('retry failed', { status: 500 });
        if (url.includes('/m1')) resolvedM1 = true;
        return Response.json({ success: true, consecutiveCorrect: 2, isResolved: url.includes('/m1') });
      }
      return Response.json({});
    });
    globalThis.fetch = fetchFn;
    const client = makeClient();
    await act(async () => { dom!.root.render(<QueryClientProvider client={client}><MistakeSprintWorkbench onOpenTutor={noop} /></QueryClientProvider>); });
    await waitFor(() => !!doc.body.textContent?.includes('正在读取错题本'));
    mode = 'error';
    release();
    await waitFor(() => !!doc.body.textContent?.includes('错题本读取失败'));
    mode = 'ok';
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent === '重新读取') as HTMLButtonElement).click(); });
    await waitFor(() => !!doc.body.textContent?.includes('待攻克: 2 题'));
    // 发起冲刺并验证提交期守卫：hold 住 POST，连击只发一次
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent?.includes('发起错题定向冲刺')) as HTMLButtonElement).click(); });
    await waitFor(() => !!doc.body.textContent?.includes('错题冲刺中'));
    retryGate = new Promise<void>((r) => { retryRelease = r; });
    const input = doc.querySelector('#sprint-answer') as HTMLInputElement;
    await act(async () => {
      const native = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
      native?.call(input, 'は');
      input.dispatchEvent(new dom!.dom.window.Event('input', { bubbles: true }));
    });
    const submitBtn = () => [...doc.querySelectorAll('button')].find((b) => b.textContent === '验证答案' || b.textContent === '提交中…') as HTMLButtonElement;
    const btn = submitBtn();
    await act(async () => { btn.click(); });
    // 提交期：按钮变为禁用态的“提交中…”，复点与回车都不应再发请求
    await act(async () => { btn.click(); });
    await act(async () => { input.dispatchEvent(new dom!.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    await settle();
    expect(retryPosts.length).toBe(1);
    mode = 'error';
    await act(async () => { await client.invalidateQueries({ queryKey: ['learner', 'mistakes'] }); });
    await waitFor(() => !!doc.body.textContent?.includes('当前练习和已读取内容仍保留'));
    expect(doc.querySelector('#sprint-answer')).not.toBeNull();
    expect(doc.body.textContent).toContain('退出冲刺模式');
    mode = 'ok';
    retryGate = null;
    retryRelease();
    await waitFor(() => [...doc.querySelectorAll('[role="alert"]')].some((node) => node.textContent?.includes('答案已保留')));
    expect(input.value).toBe('は');
    expect(input.disabled).toBe(false);
    expect([...doc.querySelectorAll('button')].some((b) => b.textContent === '下一题')).toBe(false);
    retryFailed = false;
    await act(async () => { submitBtn().click(); submitBtn().click(); });
    await waitFor(() => toasts.some((t) => t.includes('彻底攻克出库')));
    expect(retryPosts.length).toBe(2);
    // 快照隔离：m1 已出库但当前反馈仍是 m1（不被列表刷新漂移）
    await act(async () => { await client.invalidateQueries({ queryKey: ['learner', 'mistakes'] }); });
    await settle();
    expect(doc.body.textContent).toContain('わたし__学生');
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent === '下一题') as HTMLButtonElement).click(); });
    await waitFor(() => !!doc.body.textContent?.includes('本__読む'));
    expect(calls.some((c) => c.url.includes('/retry/') && c.method === 'POST')).toBe(true);
    client.clear();
  } finally {
    globalThis.fetch = originalFetch;
  }
}, 60000);

it('主观：空态/生成失败/批改失败保答案/迟到回执隔离', async () => {
  await freshDom();
  const toasts: string[] = [];
  mockInfra(toasts);
  mock.module('../../lib/gateway-client.js', () => {
    let releaseGrade!: (v: unknown) => void;
    const state = { held: false as boolean, calls: 0, fail: false };
    return {
      gatewayClient: {
        isConnected: true,
        generateAdaptiveQuiz: async () => { throw new Error('Gateway 未连接，请稍后重试。'); },
        gradeSubjectiveQuiz: (payload: unknown) => {
          state.calls += 1;
          if (state.fail) return Promise.reject(new Error('受控批改失败'));
          if (!state.held) return Promise.resolve({ isCorrect: true, score: 90, explanation: '很好', errorDiagnosis: null, refinementSuggestion: null });
          return new Promise((resolve) => { releaseGrade = resolve as (v: unknown) => void; });
        },
        __test: state,
        __release: (v: unknown) => releaseGrade(v),
        __hold: () => { state.held = true; },
      },
    };
  });
  const { SubjectiveWritingWorkbench } = await import('../SubjectiveWritingWorkbench.js');
  const gw = await import('../../lib/gateway-client.js') as unknown as { gatewayClient: { __test: { calls: number; held: boolean; fail: boolean }; __hold: () => void; __release: (v: unknown) => void } };
  const doc = dom!.dom.window.document;
  const originalFetch = globalThis.fetch;
  try {
    let genMode: 'fail' | 'ok' = 'fail';
    const { fetchFn } = makeFetch(async (url, init) => {
      if (url.includes('/api/learning/content/') && init?.method === 'POST') {
        if (genMode === 'fail') return new Response('boom', { status: 500 });
        return Response.json({ writingPrompts: [
          { id: 'w1', category: '翻译', chinesePrompt: '我是学生。', contextHint: '判断句', testedSkillId: 's1', standardAnswer: '私は学生です。', grammarFocus: 'です' },
          { id: 'w2', category: '翻译', chinesePrompt: '他吃饭。', contextHint: '动词', testedSkillId: 's2', standardAnswer: '彼はご飯を食べます。', grammarFocus: 'を' },
        ] });
      }
      return Response.json({});
    });
    globalThis.fetch = fetchFn;
    const client = makeClient();
    await act(async () => { dom!.root.render(<QueryClientProvider client={client}><SubjectiveWritingWorkbench /></QueryClientProvider>); });
    await waitFor(() => !!doc.body.textContent?.includes('暂无写作题干'));
    // 生成失败：toast 错误，无题干
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent === '生成新题干') as HTMLButtonElement).click(); });
    await waitFor(() => toasts.some((t) => t.includes('生成写作题干失败') || t.includes('暂时无法生成')));
    expect(doc.body.textContent).toContain('暂无写作题干');
    // 生成成功后作答并批改：迟到回执隔离（切题后释放旧回执，不覆盖新题）
    genMode = 'ok';
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent === '生成新题干') as HTMLButtonElement).click(); });
    await waitFor(() => !!doc.body.textContent?.includes('我是学生'));
    gw.gatewayClient.__hold();
    const area = doc.querySelector('#subjective-answer') as HTMLTextAreaElement;
    await act(async () => {
      const native = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(area), 'value')?.set;
      native?.call(area, '私は学生です。');
      area.dispatchEvent(new dom!.dom.window.Event('input', { bubbles: true }));
    });
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent === '提交批改') as HTMLButtonElement).click(); });
    await waitFor(() => !!doc.body.textContent?.includes('批改中'));
    // 切到第二题再释放旧回执：旧回执必须被丢弃
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent === '题目 2') as HTMLButtonElement).click(); });
    expect((doc.querySelector('#subjective-answer') as HTMLTextAreaElement).value).toBe('');
    gw.gatewayClient.__release({ isCorrect: true, score: 90, explanation: '很好', errorDiagnosis: null, refinementSuggestion: null });
    await settle();
    await settle();
    expect(doc.body.textContent).not.toContain('综合评分');
    expect(gw.gatewayClient.__test.calls).toBe(1);
    await waitFor(() => !doc.body.textContent?.includes('批改中'));
    gw.gatewayClient.__test.held = false;
    gw.gatewayClient.__test.fail = true;
    const nextArea = doc.querySelector('#subjective-answer') as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(nextArea), 'value')?.set?.call(nextArea, '彼はご飯を食べます。');
      nextArea.dispatchEvent(new dom!.dom.window.Event('input', { bubbles: true }));
    });
    const grade = [...doc.querySelectorAll('button')].find((b) => b.textContent === '提交批改') as HTMLButtonElement;
    await act(async () => { grade.click(); grade.click(); });
    await waitFor(() => toasts.includes('受控批改失败'));
    expect(gw.gatewayClient.__test.calls).toBe(2);
    expect(nextArea.value).toBe('彼はご飯を食べます。');
    gw.gatewayClient.__test.fail = false;
    await act(async () => { grade.click(); });
    await waitFor(() => !!doc.body.textContent?.includes('综合评分'));
    expect(gw.gatewayClient.__test.calls).toBe(3);
    client.clear();
  } finally {
    globalThis.fetch = originalFetch;
  }
}, 60000);

it('自适应：空/失败重试分离，离线出题诚实失败', async () => {
  await freshDom();
  const toasts: string[] = [];
  mockInfra(toasts);
  const { AdaptiveQuizWorkbench } = await import('../AdaptiveQuizWorkbench.js');
  const doc = dom!.dom.window.document;
  const originalFetch = globalThis.fetch;
  try {
    let mode: 'hold' | 'error' | 'empty' = 'hold';
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { fetchFn, calls } = makeFetch(async (url) => {
      if (url.includes('/api/questions/')) {
        if (mode === 'hold') await gate;
        if (mode === 'error') return new Response('boom', { status: 500 });
        return Response.json([]);
      }
      return Response.json({});
    });
    globalThis.fetch = fetchFn;
    const client = makeClient();
    await act(async () => { dom!.root.render(<QueryClientProvider client={client}><AdaptiveQuizWorkbench onOpenTutor={noop} /></QueryClientProvider>); });
    await waitFor(() => !!doc.body.textContent?.includes('正在读取题库'));
    mode = 'error';
    release();
    await waitFor(() => !!doc.body.textContent?.includes('题库读取失败'));
    const before = calls.filter((c) => c.url.includes('/api/questions/')).length;
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent === '重试') as HTMLButtonElement).click(); });
    await waitFor(() => calls.filter((c) => c.url.includes('/api/questions/')).length > before);
    mode = 'empty';
    await act(async () => { await client.invalidateQueries({ queryKey: ['learner', 'questions'] }); });
    await waitFor(() => !!doc.body.textContent && !doc.body.textContent.includes('正在读取题库'));
    // 网关未连接时出题：诚实失败，不伪造题目（精确匹配出题按钮，不误点 Tab）
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent === '针对弱项练习') as HTMLButtonElement).click(); });
    await waitFor(() => toasts.some((t) => t.includes('Gateway') || t.includes('准备题目失败') || t.includes('尚未连上')));
    expect(doc.body.textContent).not.toContain('已准备');
    client.clear();
  } finally {
    globalThis.fetch = originalFetch;
  }
}, 60000);

it('出题任务：列表失败可重试；取消期禁用重复提交', async () => {
  await freshDom();
  const toasts: string[] = [];
  mockInfra(toasts);
  const { GenerationWorkbench } = await import('../generation/GenerationWorkbench.js');
  const doc = dom!.dom.window.document;
  const originalFetch = globalThis.fetch;
  try {
    let listMode: 'hold' | 'error' | 'ok' = 'hold';
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let cancelRelease!: () => void;
    let cancelGate: Promise<void> | null = null;
    const cancelPosts: number[] = [];
    let cancelled = false;
    const { fetchFn, calls } = makeFetch(async (url, init) => {
      if (url.includes('/api/agent/')) return Response.json({ runtimes: [], models: [] });
      if (url.endsWith('/cancel') && init?.method === 'POST') {
        cancelPosts.push(1);
        if (cancelGate) await cancelGate;
        cancelled = true;
        return Response.json({ taskId: 't1', status: 'CANCELLED', papers: [], config: { language: 'ja', targetLevel: 'N5' }, usage: { usedQuestions: 0 } });
      }
      if (url.includes('/run-state')) return Response.json({ running: !cancelled, last: null });
      if (url.includes('/api/generation/tasks/') && url.includes('/t1') && (!init?.method || init.method === 'GET')) {
        return Response.json({ taskId: 't1', status: cancelled ? 'CANCELLED' : 'ACTIVE', papers: [], config: { language: 'ja', targetLevel: 'N5' }, usage: { usedQuestions: 0 } });
      }
      if (url.includes('/api/generation/tasks/')) {
        if (listMode === 'hold') await gate;
        if (listMode === 'error') return Response.json({ error: { userMessage: '任务列表读取失败' } }, { status: 500 });
        return Response.json([{ taskId: 't1', targetLevel: 'N5', status: 'ACTIVE', paperCount: 0 }]);
      }
      if (url.includes('/api/generation/presets')) return Response.json([]);
      if (url.includes('/api/generation/suggest/')) return Response.json(null);
      return Response.json({});
    });
    globalThis.fetch = fetchFn;
    const client = makeClient();
    await act(async () => { dom!.root.render(<QueryClientProvider client={client}><GenerationWorkbench userId="u1" track="ja" /></QueryClientProvider>); });
    await waitFor(() => !!doc.body.textContent?.includes('任务列表加载中'));
    listMode = 'error';
    release();
    await waitFor(() => !!doc.body.textContent?.includes('任务列表读取失败'));
    const before = calls.filter((c) => c.url.includes('/api/generation/tasks/') && c.method === 'GET').length;
    listMode = 'ok';
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent === '重试') as HTMLButtonElement).click(); });
    await waitFor(() => calls.filter((c) => c.url.includes('/api/generation/tasks/') && c.method === 'GET').length > before);
    await waitFor(() => !!doc.body.textContent?.includes('N5 · ACTIVE'));
    // 打开任务进入状态卡（按 ACTIVE 精确定位任务按钮，不误点等级下拉），取消期连击只发一次
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent?.includes('ACTIVE')) as HTMLButtonElement).click(); });
    await waitFor(() => !!doc.body.textContent?.includes('取消任务'));
    cancelGate = new Promise<void>((r) => { cancelRelease = r; });
    const cancelEl = [...doc.querySelectorAll('button')].find((b) => b.textContent === '取消任务') as HTMLButtonElement;
    await act(async () => { cancelEl.click(); });
    // 取消期按钮变为禁用态“取消中…”：复点不再发请求
    await act(async () => { cancelEl.click(); });
    await settle();
    expect(cancelPosts.length).toBe(1);
    expect(([...doc.querySelectorAll('button')].find((b) => b.textContent === '取消中…') as HTMLButtonElement).disabled).toBe(true);
    cancelGate = null;
    cancelRelease();
    await waitFor(() => !!doc.body.textContent?.includes('已取消'));
    expect(toasts).toBeDefined();
    client.clear();
  } finally {
    globalThis.fetch = originalFetch;
  }
}, 60000);

it('试卷作答：客观题连击只提交一次，空答案给内联错误', async () => {
  await freshDom();
  const toasts: string[] = [];
  mockInfra(toasts);
  const { BankPaperView } = await import('../generation/BankPaperView.js');
  const doc = dom!.dom.window.document;
  const originalFetch = globalThis.fetch;
  try {
    let answerRelease!: () => void;
    let answerGate: Promise<void> | null = null;
    const answerPosts: number[] = [];
    const { fetchFn } = makeFetch(async (url, init) => {
      if (url.includes('/papers/p1') && !url.includes('/answers/') && !url.includes('/submissions')) {
        return Response.json({ paperId: 'p1', title: '模拟卷', items: [{
          id: 'qi1', language: 'en', category: 'GRAMMAR', targetLevel: 'A1', difficultyTier: 1,
          prompt: 'She ___ a student.', skillIds: [], materialId: null,
          answer: { type: 'MULTIPLE_CHOICE', options: [{ key: 'A', text: 'is' }, { key: 'B', text: 'are' }] },
          material: null,
        }] });
      }
      if (url.includes('/submissions') && (!init?.method || init.method === 'GET')) return Response.json([]);
      if (url.includes('/answers/objective') && init?.method === 'POST') {
        answerPosts.push(1);
        if (answerGate) await answerGate;
        return Response.json({ isCorrect: true, score: 1, correctAnswer: 'A', explanation: 'ok' });
      }
      return Response.json({});
    });
    globalThis.fetch = fetchFn;
    const client = makeClient();
    await act(async () => { dom!.root.render(<QueryClientProvider client={client}><BankPaperView userId="u1" taskId="t1" paperId="p1" /></QueryClientProvider>); });
    await waitFor(() => !!doc.body.textContent?.includes('She ___ a student.'));
    // 空答案提交：内联错误，不发请求
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent === '提交') as HTMLButtonElement).click(); });
    await waitFor(() => !!doc.body.textContent?.includes('请先作答再提交'));
    expect(answerPosts.length).toBe(0);
    // 选题后连击提交：同 tick 两次点击只发一次（ref 与 disabled 双重保护）
    await act(async () => { (doc.querySelector('button[aria-label="选项 A"]') as HTMLButtonElement).click(); });
    answerGate = new Promise<void>((r) => { answerRelease = r; });
    const submitEl = [...doc.querySelectorAll('button')].find((b) => b.textContent === '提交') as HTMLButtonElement;
    await act(async () => { submitEl.click(); });
    await act(async () => { submitEl.click(); });
    await settle();
    expect(answerPosts.length).toBe(1);
    answerGate = null;
    answerRelease();
    await waitFor(() => !!doc.body.textContent?.includes('回答正确'));
    client.clear();
  } finally {
    globalThis.fetch = originalFetch;
  }
}, 60000);

it('计划面板：AI 建议只预填不自动生效，模板校验诚实', async () => {
  await freshDom();
  const toasts: string[] = [];
  mockInfra(toasts);
  const { PracticePlanPanel } = await import('../practice/PracticePlanPanel.js');
  const doc = dom!.dom.window.document;
  const originalFetch = globalThis.fetch;
  try {
    const { fetchFn, calls } = makeFetch(async (url, init) => {
      if (url.includes('/api/practice/templates') && (!init?.method || init.method === 'GET')) return Response.json([]);
      if (url.includes('/propose') && init?.method === 'POST') {
        return Response.json({ suggestedName: 'AI 建议计划', blocks: [{ id: 'b1', kind: 'QUIZ', count: 5, gradingMode: 'AUTO_IMMEDIATE' }] });
      }
      return Response.json({});
    });
    globalThis.fetch = fetchFn;
    const client = makeClient();
    await act(async () => { dom!.root.render(<QueryClientProvider client={client}><PracticePlanPanel userId="u1" language="ja" /></QueryClientProvider>); });
    await waitFor(() => !!doc.body.textContent?.includes('还没有练习计划'));
    // AI 建议只打开编辑器预填，不直接写入模板列表
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent === 'AI 建议') as HTMLButtonElement).click(); });
    await waitFor(() => !!doc.querySelector('[role="dialog"]'));
    // 建议只预填到名称输入框（input 值不在 textContent 中，断言真实值）
    await waitFor(() => (doc.querySelector('input[aria-label="模板名称"]') as HTMLInputElement)?.value === 'AI 建议计划');
    // 建议请求（/propose）是允许的读取；模板保存（POST /templates 本体）必须没有发生
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/practice/templates'))).toBe(false);
    client.clear();
  } finally {
    globalThis.fetch = originalFetch;
  }
}, 60000);

}
