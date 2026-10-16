import { expect, it, mock } from 'bun:test';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, setupDom, type DomHandle } from '../toc/__tests__/dom-setup.js';
/**
 * UI-R09c 发音/听力/韩语/导入/PDF 一致性：受控 fetch + 真容器行为。
 * 覆盖：韩语底座三态与回写失败战报、单词失败分支、写作父入口标签与生成、
 * 声调词表失败重试与麦克风拒绝诚实态、教材听力失败重试、PDF 行级加卡目标、
 * 假名单词失败分支、导入 JSON 校验。隔离环境，不做真实录音/批改/导入、
 * 付费 TTS 或真实学情写入。
 */

if (process.env['LINGUA_PRON_IMP_CHILD'] !== '1') {
  it('pronunciation import states (child isolation)', async () => {
    const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_PRON_IMP_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
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

const hangulRow = (over: Record<string, unknown> = {}) => ({
  id: 'h1', type: 'CONSONANT', jamo: 'ㄱ', name: '기역', romanization: 'g',
  audioText: '가', mnemonic: '记忆法', sortOrder: 1, ...over,
});

it('韩语：底座加载/失败重试/成功空分离', async () => {
  await freshDom();
  mockInfra([]);
  const { HangulStudioWorkbench } = await import('../HangulStudioWorkbench.js');
  const doc = dom!.dom.window.document;
  const originalFetch = globalThis.fetch;
  try {
    let mode: 'hold' | 'error' | 'empty' | 'ok' = 'hold';
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { fetchFn, calls } = makeFetch(async (url) => {
      if (url.includes('/api/curriculum/hangul')) {
        if (mode === 'hold') await gate;
        if (mode === 'error') return new Response('boom', { status: 500 });
        if (mode === 'empty') return Response.json([]);
        return Response.json([hangulRow()]);
      }
      return Response.json({});
    });
    globalThis.fetch = fetchFn;
    const client = makeClient();
    await act(async () => { dom!.root.render(<QueryClientProvider client={client}><HangulStudioWorkbench /></QueryClientProvider>); });
    await waitFor(() => !!doc.body.textContent?.includes('谚文底座加载中'));
    expect(doc.body.textContent).not.toContain('暂无谚文数据');
    mode = 'error';
    release();
    await waitFor(() => !!doc.body.textContent?.includes('谚文底座读取失败'));
    const before = calls.filter((c) => c.url.includes('/api/curriculum/hangul')).length;
    mode = 'ok';
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent === '重新读取') as HTMLButtonElement).click(); });
    await waitFor(() => calls.filter((c) => c.url.includes('/api/curriculum/hangul')).length > before);
    await waitFor(() => !!doc.body.textContent?.includes('子音 1 · 母音 0 · 进阶 0'));
    // 成功空：明确空态，不再是失败文案
    mode = 'empty';
    await act(async () => { await client.invalidateQueries({ queryKey: ['curriculum', 'hangul'] }); });
    await waitFor(() => !!doc.body.textContent?.includes('暂无谚文数据'));
    expect(doc.body.textContent).not.toContain('读取失败');
    client.clear();
  } finally {
    globalThis.fetch = originalFetch;
  }
}, 60000);

it('韩语：回写失败保答案不推进，重试成功后才完成战报', async () => {
  await freshDom();
  const toasts: string[] = [];
  mockInfra(toasts);
  const { HangulStudioWorkbench } = await import('../HangulStudioWorkbench.js');
  const doc = dom!.dom.window.document;
  const originalFetch = globalThis.fetch;
  try {
    let practiceFail = true;
    const { fetchFn } = makeFetch(async (url, init) => {
      if (url.includes('/api/curriculum/hangul') && (!init?.method || init.method === 'GET')) {
        return Response.json([hangulRow(), hangulRow({ id: 'h2', jamo: 'ㄴ', name: '니은', romanization: 'n', sortOrder: 2 })]);
      }
      if (url.includes('/practice') && init?.method === 'POST') return practiceFail ? new Response('boom', { status: 500 }) : Response.json({ success: true });
      return Response.json({});
    });
    globalThis.fetch = fetchFn;
    const client = makeClient();
    await act(async () => { dom!.root.render(<QueryClientProvider client={client}><HangulStudioWorkbench /></QueryClientProvider>); });
    await waitFor(() => !!doc.body.textContent?.includes('开始自测'));
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent?.includes('开始自测')) as HTMLButtonElement).click(); });
    await waitFor(() => !!doc.body.textContent?.includes('第 1 / 2 题'));
    // 正确作答：本地判定正确，但回写失败必须可见
    const correctBtn = [...doc.querySelectorAll('button')].find((b) => b.textContent === 'ㄱ') as HTMLButtonElement;
    await act(async () => { correctBtn.click(); });
    await waitFor(() => toasts.some((t) => t.includes('回写失败')));
    expect(([...doc.querySelectorAll('button')].find(b => b.textContent === '下一题') as HTMLButtonElement).disabled).toBe(true);
    expect(doc.body.textContent).toContain('第 1 / 2 题');
    practiceFail = false;
    await act(async () => { ([...doc.querySelectorAll('button')].find(b => b.textContent === '重试保存') as HTMLButtonElement).click(); });
    await waitFor(() => !doc.body.textContent?.includes('重试保存') && !doc.body.textContent?.includes('正在保存本题'));
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent === '下一题') as HTMLButtonElement).click(); });
    await waitFor(() => !!doc.body.textContent?.includes('第 2 / 2 题'));
    // 同 tick 连击第二题选项只记一次
    const optBtns = [...doc.querySelectorAll('button')].filter((b) => b.textContent === 'ㄴ');
    await act(async () => { optBtns[0]!.click(); });
    await act(async () => { optBtns[0]!.click(); });
    await settle();
    await waitFor(() => !doc.body.textContent?.includes('正在保存本题'));
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent === '查看战报') as HTMLButtonElement).click(); });
    await waitFor(() => !!doc.body.textContent?.includes('本轮战报'));
    expect(doc.body.textContent).not.toContain('回写失败');
    expect(doc.body.textContent).toContain('已回写学情画像');
    client.clear();
  } finally {
    globalThis.fetch = originalFetch;
  }
}, 60000);

it('韩语单词：词典缺失给显式引导，加载失败可重试', async () => {
  await freshDom();
  mockInfra([]);
  const { HangulStudioWorkbench } = await import('../HangulStudioWorkbench.js');
  const doc = dom!.dom.window.document;
  const originalFetch = globalThis.fetch;
  try {
    let wordsMode: 'fail' | 'ok' = 'fail';
    const { fetchFn } = makeFetch(async (url, init) => {
      if (url.includes('/api/curriculum/hangul') && (!init?.method || init.method === 'GET')) return Response.json([hangulRow()]);
      if (url.includes('/api/learning/content/') && init?.method === 'POST') {
        if (wordsMode === 'fail') return new Response('boom', { status: 500 });
        return Response.json({ hangulWords: [{ id: 'w1', korean: '물', meanings: ['水'], entryId: 'e1', sourceLabel: 'Kengdic', audioText: '물' }] });
      }
      if (url.includes('/practice') && init?.method === 'POST') return Response.json({ success: true });
      return Response.json({});
    });
    globalThis.fetch = fetchFn;
    const client = makeClient();
    await act(async () => { dom!.root.render(<QueryClientProvider client={client}><HangulStudioWorkbench /></QueryClientProvider>); });
    await waitFor(() => !!doc.body.textContent?.includes('开始自测'));
    // 切到听写选词模式（成熟 Select 键盘操作：聚焦后下键高亮、回车选中）
    const modeTrigger = doc.querySelector('[aria-label="自测模式"]') as HTMLElement;
    modeTrigger.focus();
    const modeKey = async (k: string) => act(async () => {
      (doc.activeElement ?? modeTrigger).dispatchEvent(new dom!.dom.window.KeyboardEvent('keydown', { key: k, bubbles: true }));
    });
    for (let i = 0; i < 4; i++) {
      await modeKey('ArrowDown');
      await settle();
    }
    await waitFor(() => (doc.querySelector('[role="option"][data-highlighted]') as HTMLElement | null)?.textContent === '听写选词');
    await modeKey('Enter');
    await waitFor(() => (doc.querySelector('[aria-label="自测模式"]') as HTMLElement)?.textContent === '听写选词');
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent?.includes('开始自测')) as HTMLButtonElement).click(); });
    await waitFor(() => !!doc.body.textContent?.includes('韩语单词读取失败'));
    expect(doc.body.textContent).toContain('设置 → 词典');
    // 重试拉取成功后进入单词作答
    wordsMode = 'ok';
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent === '重试') as HTMLButtonElement).click(); });
    await waitFor(() => !!doc.body.textContent?.includes('听发音选单词'));
    client.clear();
  } finally {
    globalThis.fetch = originalFetch;
  }
}, 60000);

it('写作父入口：体裁/难度显示可读名与明确标签，生成走通', async () => {
  await freshDom();
  const toasts: string[] = [];
  mockInfra(toasts);
  const { WritingStudioWorkbench } = await import('../WritingStudioWorkbench.js');
  const doc = dom!.dom.window.document;
  const originalFetch = globalThis.fetch;
  try {
    const { fetchFn } = makeFetch(async (url, init) => {
      if (url.includes('/api/learning/content/') && init?.method === 'POST') {
        return Response.json({ writingPrompts: [
          { id: 'w1', category: '翻译', chinesePrompt: '我是学生。', contextHint: '判断句', testedSkillId: 's1', standardAnswer: '私は学生です。', grammarFocus: 'です' },
        ] });
      }
      return Response.json({});
    });
    globalThis.fetch = fetchFn;
    const client = makeClient();
    await act(async () => { dom!.root.render(<QueryClientProvider client={client}><WritingStudioWorkbench /></QueryClientProvider>); });
    await waitFor(() => !!doc.body.textContent?.includes('写作与翻译工作室'));
    // 体裁/难度显示可读名，不再是 raw value；触发器有明确标签
    expect(doc.querySelector('[aria-label="体裁"]')?.textContent).toContain('翻译');
    expect(doc.querySelector('[aria-label="体裁"]')?.textContent).not.toContain('translation');
    expect(doc.body.textContent).not.toContain('learning.content');
    expect(doc.querySelector('[aria-label="体裁"]')).toBeTruthy();
    expect(doc.querySelector('[aria-label="难度"]')).toBeTruthy();
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent === '生成题干') as HTMLButtonElement).click(); });
    await waitFor(() => !!doc.body.textContent?.includes('我是学生'));
    expect(toasts.some((t) => t.includes('题干已生成并写入练习队列'))).toBe(true);
    client.clear();
  } finally {
    globalThis.fetch = originalFetch;
  }
}, 60000);

it('发音：词表失败可重试；麦克风拒绝诚实说明且不卡录音态', async () => {
  await freshDom();
  const toasts: string[] = [];
  mockInfra(toasts);
  const { PitchAccentCoach } = await import('../PitchAccentCoach.js');
  const doc = dom!.dom.window.document;
  const originalFetch = globalThis.fetch;
  try {
    let mode: 'error' | 'ok' = 'error';
    const { fetchFn, calls } = makeFetch(async (url) => {
      if (url.includes('/api/curriculum/pitch')) {
        if (mode === 'error') return new Response('boom', { status: 500 });
        return Response.json({ pitchEntries: [{
          id: 'p1', kanji: '水', kana: 'みず', meaning: '水', pitchType: '平板型',
          pitchPattern: ['L', 'H'], moraList: ['み', 'ず'], tip: '要领',
        }] });
      }
      if (url.includes('/api/dictionary/')) return Response.json([]);
      return Response.json({});
    });
    globalThis.fetch = fetchFn;
    const client = makeClient();
    await act(async () => { dom!.root.render(<QueryClientProvider client={client}><PitchAccentCoach /></QueryClientProvider>); });
    await waitFor(() => !!doc.body.textContent?.includes('声调基准词表加载失败'));
    const before = calls.filter((c) => c.url.includes('/api/curriculum/pitch')).length;
    mode = 'ok';
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent === '重新加载') as HTMLButtonElement).click(); });
    await waitFor(() => calls.filter((c) => c.url.includes('/api/curriculum/pitch')).length > before);
    await waitFor(() => !!doc.body.textContent?.includes('开始跟读录音'));
    // jsdom 无麦克风：拒绝给出明确说明，不进入假录音
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent?.includes('开始跟读录音')) as HTMLButtonElement).click(); });
    await waitFor(() => toasts.some((t) => t.includes('麦克风')));
    expect(doc.body.textContent).toContain('开始跟读录音');
    expect(doc.body.textContent).not.toContain('正在录音分析中');
    client.clear();
  } finally {
    globalThis.fetch = originalFetch;
  }
}, 60000);

it('教材听力：教材库失败可重试；课次选择显示真实标题', async () => {
  await freshDom();
  mockInfra([]);
  const { TextbookListening } = await import('../listening/TextbookListening.js');
  const doc = dom!.dom.window.document;
  const originalFetch = globalThis.fetch;
  try {
    let mode: 'error' | 'ok' = 'error';
    const { fetchFn, calls } = makeFetch(async (url) => {
      if (url.includes('/api/documents/')) {
        if (mode === 'error') return new Response('boom', { status: 500 });
        return Response.json([]);
      }
      return Response.json({});
    });
    globalThis.fetch = fetchFn;
    const client = makeClient();
    await act(async () => { dom!.root.render(<QueryClientProvider client={client}><TextbookListening language="ja" /></QueryClientProvider>); });
    await waitFor(() => !!doc.body.textContent?.includes('重新加载教材'));
    const before = calls.filter((c) => c.url.includes('/api/documents/')).length;
    mode = 'ok';
    await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent === '重新加载教材') as HTMLButtonElement).click(); });
    await waitFor(() => calls.filter((c) => c.url.includes('/api/documents/')).length > before);
    await waitFor(() => !!doc.body.textContent?.includes('暂无含对话的教材'));
    expect(doc.querySelector('[aria-label="教材课次"]')).toBeNull();
    client.clear();
  } finally {
    globalThis.fetch = originalFetch;
  }
}, 60000);

it('PDF 行级加卡：用行内词条数据，不误用当前划选', async () => {
  await freshDom();
  mockInfra([]);
  const { PdfPageView } = await import('../pdf-reader/PdfPageView.js');
  const doc = dom!.dom.window.document;
  const seen: Array<{ kanji: string; kana: string; chinese: string }> = [];
  const book = { shortTitle: '标日', title: '标准日本语', language: 'JA' };
  const lesson = {
    id: 'l1', title: '第一课', dialogues: [], grammarPoints: [],
    vocabularies: [{ id: 'v1', kanji: '水', kana: 'みず', chinese: '水', pos: '名詞' }],
  };
  await act(async () => {
    dom!.root.render(
      <PdfPageView
        book={book as never}
        lesson={lesson as never}
        currentPage={1}
        totalPages={1}
        showTranslation
        collectPending={false}
        onCollectSentence={noop}
        onAskAiTutor={noop}
        onAddVocabWord={(v) => { seen.push(v); }}
      />
    );
  });
  await waitFor(() => !!doc.body.textContent?.includes('课文内容'));
  expect(doc.body.textContent).not.toContain('PAGE 01 / 01');
  await act(async () => { (doc.querySelector('button[aria-label="将 水 加入闪卡"]') as HTMLButtonElement).click(); });
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatchObject({ kanji: '水', kana: 'みず', chinese: '水' });
}, 30000);

it('假名单词与导入 JSON：失败分支诚实，校验错误可见', async () => {
  await freshDom();
  const toasts: string[] = [];
  mockInfra(toasts);
  const { KanaWordExercise } = await import('../kana-studio/KanaWordExercise.js');
  const { TextbookJsonImporterTab } = await import('../importer/TextbookJsonImporterTab.js');
  const doc = dom!.dom.window.document;
  const noopState = {
    allKana: [], scriptMode: 'HIRAGANA', drillMode: 'WORD_DICTATION', selectedOption: null,
    isAnswered: false, generateWords: { isPending: false }, collectEntry: { isPending: false },
    wordInput: '', setWordInput: noop, wordStudyDone: false, setWordStudyDone: noop,
    currentWord: undefined, meaningOptions: [], handleSubmitWordInput: noop,
    handleSelectMeaningOption: noop, handleCollectWord: noop, handleNextWord: noop,
    handleRefreshWords: () => { toasts.push('retry-words'); }, wordFailed: true,
  };
  await act(async () => { dom!.root.render(<KanaWordExercise state={noopState as never} />); });
  await waitFor(() => !!doc.body.textContent?.includes('假名单词加载失败'));
  await act(async () => { ([...doc.querySelectorAll('button')].find((b) => b.textContent === '重新加载') as HTMLButtonElement).click(); });
  expect(toasts).toContain('retry-words');

  const { useState } = await import('react');
  function JsonHarness() {
    const [text, setText] = useState('');
    const [error, setError] = useState<string | null>(null);
    return (
      <div>
        <TextbookJsonImporterTab
          inputText={text}
          setInputText={setText}
          parsedAST={null}
          setParsedAST={noop}
          setParseError={setError}
        />
        {error && <p role="alert">{error}</p>}
      </div>
    );
  }
  const client = makeClient();
  await act(async () => { dom!.root.render(<QueryClientProvider client={client}><JsonHarness /></QueryClientProvider>); });
  const area = doc.querySelector('textarea') as HTMLTextAreaElement;
  await act(async () => {
    const native = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(area), 'value')?.set;
    native?.call(area, '{ bad json');
    area.dispatchEvent(new dom!.dom.window.Event('input', { bubbles: true }));
  });
  await settle();
  // 非法 JSON 给出校验错误，不伪装成功
  await waitFor(() => !!doc.body.textContent?.includes('JSON 语法错误'));
  expect(doc.querySelector('input[aria-label="上传教材 JSON 文件"]')).toBeTruthy();
  client.clear();
}, 60000);

it('录音：最终音频块、分析锁、切词隔离、取消后迟到授权与启动失败回收', async () => {
  await freshDom();
  const toasts: string[] = [];
  mockInfra(toasts);
  const { usePitchRecorder } = await import('../pitch-coach/usePitchRecorder.js');
  let hook!: ReturnType<typeof usePitchRecorder>;
  const frames: FrameRequestCallback[] = [];
  const globals = globalThis as unknown as Record<string, unknown>;
  const previous = { context: globals.AudioContext, recorder: globals.MediaRecorder, raf: globals.requestAnimationFrame, caf: globals.cancelAnimationFrame };
  const mediaDescriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  let mediaCalls = 0, stopped = 0, closed = 0, contexts = 0;
  let heldMedia: Promise<MediaStream> | null = null;
  let failContext = false;
  let releaseDecode!: (value: unknown) => void;
  let decodedBytes: number[] = [];
  const stream = { getTracks: () => [{ stop: () => { stopped++; } }] } as unknown as MediaStream;
  class Context {
    constructor() { contexts++; if (failContext) throw new Error('context failed'); }
    createAnalyser() { return { fftSize: 0 }; }
    createMediaStreamSource() { return { connect() {} }; }
    close() { closed++; return Promise.resolve(); }
    decodeAudioData(raw: ArrayBuffer) { decodedBytes = [...new Uint8Array(raw)]; return new Promise(resolve => { releaseDecode = resolve; }); }
  }
  class Recorder {
    state = 'inactive'; mimeType = 'audio/webm';
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])]) }); this.onstop?.(); }
  }
  globals.AudioContext = Context;
  globals.MediaRecorder = Recorder;
  globals.requestAnimationFrame = (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; };
  globals.cancelAnimationFrame = () => {};
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => { mediaCalls++; return heldMedia ?? Promise.resolve(stream); } } });
  function Harness({ word }: { word: string }) {
    hook = usePitchRecorder({ canvasRef: { current: null }, pitchPattern: ['L', 'H'], pitchType: '平板', contextKey: word, durationMs: 0 });
    return <p>{hook.phase}</p>;
  }
  try {
    await act(async () => { dom!.root.render(<Harness word="first" />); });
    await act(async () => { await hook.startRecording(); });
    await act(async () => { frames.shift()!(0); });
    await waitFor(() => decodedBytes.length > 0);
    expect(decodedBytes).toEqual([1, 2, 3]);
    expect(hook.phase).toBe('analyzing');
    await act(async () => { await hook.startRecording(); });
    expect(mediaCalls).toBe(1);
    await act(async () => { dom!.root.render(<Harness word="second" />); });
    await act(async () => { releaseDecode({ sampleRate: 24000, getChannelData: () => new Float32Array(4096) }); });
    await settle();
    expect(hook.evalResult).toBeNull();
    expect(hook.phase).toBe('idle');
    expect(toasts.some(message => message.includes('评测完成'))).toBe(false);
    expect(stopped).toBe(1);
    expect(closed).toBe(1);
    let releaseMedia!: (value: MediaStream) => void;
    heldMedia = new Promise(resolve => { releaseMedia = resolve; });
    let pending!: Promise<void>;
    await act(async () => { pending = hook.startRecording(); });
    expect(hook.phase).toBe('requesting');
    await act(async () => { hook.cancelRecording(); });
    await act(async () => { releaseMedia(stream); await pending; });
    expect(stopped).toBe(2);
    expect(contexts).toBe(1);
    heldMedia = null; failContext = true;
    await act(async () => { await hook.startRecording(); });
    expect(stopped).toBe(3);
    expect(hook.phase).toBe('idle');
    expect(toasts).toContain('context failed');
  } finally {
    await act(async () => { dom!.root.unmount(); });
    globals.AudioContext = previous.context; globals.MediaRecorder = previous.recorder;
    globals.requestAnimationFrame = previous.raf; globals.cancelAnimationFrame = previous.caf;
    if (mediaDescriptor) Object.defineProperty(navigator, 'mediaDevices', mediaDescriptor);
    else delete (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
  }
}, 60000);

it('JSON导入：等待真实回执，部分失败保输入，重试不重存教材且卡片身份稳定', async () => {
  await freshDom();
  const toasts: string[] = [];
  mockInfra(toasts);
  const { useJsonImportAction } = await import('../importer/useJsonImportAction.js');
  const { SAMPLE_TEXTBOOK_JSON } = await import('../../fixtures/textbook-sample-ast.js');
  const { vocabToStudyCard } = await import('../../queries/cards-mistakes-questions.js');
  let hook!: ReturnType<typeof useJsonImportAction>;
  let releaseBook!: () => void;
  const gate = new Promise<void>(resolve => { releaseBook = resolve; });
  let bookCalls = 0, cardFail = true, closes = 0;
  const cardBatches: Array<Array<{ id?: string; front: string; back: string; category: string; prompt: string }>> = [];
  function Harness() {
    hook = useJsonImportAction({ parsedAST: SAMPLE_TEXTBOOK_JSON, autoGenerateCards: true,
      onImportBook: async () => { bookCalls++; await gate; },
      onAddCardsBatch: async cards => { cardBatches.push(cards); if (cardFail) throw new Error('card failure'); },
      onClose: () => { closes++; } });
    return <p>{hook.error}</p>;
  }
  await act(async () => { dom!.root.render(<Harness />); });
  let pending!: Promise<void>;
  await act(async () => { pending = hook.confirm(); void hook.confirm(); });
  expect(bookCalls).toBe(1); expect(cardBatches).toHaveLength(0); expect(closes).toBe(0);
  await act(async () => { releaseBook(); await pending; });
  expect(hook.error).toContain('教材已保存'); expect(closes).toBe(0);
  cardFail = false;
  await act(async () => { await hook.confirm(); });
  expect(bookCalls).toBe(1); expect(cardBatches).toHaveLength(2); expect(closes).toBe(1);
  expect(cardBatches[0]!.map(card => card.id)).toEqual(cardBatches[1]!.map(card => card.id));
  expect(vocabToStudyCard(cardBatches[0]![0]!).id).toBe(cardBatches[0]![0]!.id!);
  expect(toasts.some(message => message.includes('教材已导入'))).toBe(true);
}, 60000);

it('PDF回执：行内词条、防连击、失败保选择与切课迟到隔离', async () => {
  await freshDom();
  const toasts: string[] = []; mockInfra(toasts);
  const { usePdfReaderActions } = await import('../pdf-reader/usePdfReaderActions.js');
  const { SAMPLE_TEXTBOOK_JSON } = await import('../../fixtures/textbook-sample-ast.js');
  const { convertAstToTextbookBook } = await import('../importer/textbook-converter.js');
  const book = convertAstToTextbookBook(SAMPLE_TEXTBOOK_JSON);
  let hook!: ReturnType<typeof usePdfReaderActions>;
  let fail = false, dismissed = 0;
  let release!: () => void;
  let gate: Promise<void> | null = new Promise(resolve => { release = resolve; });
  const payloads: Array<{ front: string }> = [];
  const selection = { selectedText: '選句', popupPosition: { x: 0, y: 0 }, wordDetail: null,
    handleMouseUp: noop, dismissSelection: () => { dismissed++; } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeFetch(() => Response.json([])).fetchFn;
  const client = makeClient();
  function Harness({ lessonId }: { lessonId: string }) {
    hook = usePdfReaderActions({ book, lesson: { ...book.lessons[0]!, id: lessonId }, selection, positionKey: book.id,
      onAskAiTutor: noop, onAddCard: async card => { payloads.push(card); if (gate) await gate; if (fail) throw new Error('card failure'); } });
    return <p>{hook.cardsPending ? 'saving' : 'idle'}</p>;
  }
  const render = async (lessonId: string) => act(async () => { dom!.root.render(<QueryClientProvider client={client}><Harness lessonId={lessonId} /></QueryClientProvider>); });
  try {
    await render('first');
    let pending!: Promise<void>;
    await act(async () => { pending = hook.handleAddVocabToCards({ kanji: '行内', kana: 'ぎょうない', chinese: 'row meaning' }); void hook.handleAddSelectedToCards(); });
    expect(payloads).toHaveLength(1); expect(payloads[0]!.front).toContain('行内');
    expect(toasts.some(message => message.includes('记忆卡已保存'))).toBe(false);
    await render('second');
    await act(async () => { release(); await pending; });
    expect(toasts.some(message => message.includes('记忆卡已保存'))).toBe(false);
    expect(dismissed).toBe(0);
    gate = null; fail = true;
    await act(async () => { await hook.handleAddSelectedToCards(); });
    expect(toasts).toContain('card failure'); expect(dismissed).toBe(0);
    fail = false;
    await act(async () => { await hook.handleAddSelectedToCards(); });
    expect(dismissed).toBe(1);
    expect(payloads[2]!.front).toBe('選句');
  } finally {
    await act(async () => { dom!.root.unmount(); }); client.clear(); globalThis.fetch = originalFetch;
  }
}, 60000);

it('声波：无信号不造波形，采样按原点直连而非平滑，读取调用方主题色', async () => {
  const { paintWaveFrame } = await import('../pitch-coach/PitchCanvasVisualizer.js');
  const lines: number[][] = [], labels: string[] = [];
  let curves = 0;
  const context = { strokeStyle: '', fillStyle: '', clearRect() {}, save() {}, restore() {}, setLineDash() {}, beginPath() {},
    moveTo() {}, lineTo: (x: number, y: number) => lines.push([x, y]), stroke() {}, fillText: (text: string) => labels.push(text), quadraticCurveTo: () => { curves++; } };
  const canvas = { width: 360, height: 112, getContext: () => context } as unknown as HTMLCanvasElement;
  paintWaveFrame(canvas, { analyser: null, elapsedSec: 1 }, { trace: 'light-trace', grid: 'light-grid' });
  expect(labels).toContain('无麦克风信号');
  lines.length = 0;
  const analyser = { frequencyBinCount: 4, getByteTimeDomainData: (data: Uint8Array) => data.set([128, 160, 96, 128]) } as unknown as AnalyserNode;
  paintWaveFrame(canvas, { analyser, elapsedSec: 1 }, { trace: 'dark-trace', grid: '' });
  expect(lines.slice(0, 3)).toEqual([[90, 70], [180, 42], [270, 56]]);
  expect(curves).toBe(0); expect(context.strokeStyle).toBe('dark-trace');
});

it('韩语轮次：成功空词表不重复拉取，停止后迟到词表隔离，题目选项不随底座刷新漂移', async () => {
  await freshDom(); mockInfra([]);
  const { useHangulDrill } = await import('../hangul/useHangulDrill.js');
  let hook!: ReturnType<typeof useHangulDrill>;
  let requests = 0, held = false;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeFetch(async url => {
    if (url.includes('/api/learning/content/')) {
      requests++;
      if (held) await gate;
      return Response.json({ hangulWords: held ? [{ id: 'late', korean: '물', meanings: ['水'], entryId: 'e1', sourceLabel: 'fixture', audioText: '물' }] : [] });
    }
    return Response.json({});
  }).fetchFn;
  const client = makeClient();
  const pool = [hangulRow(), hangulRow({ id: 'h2', jamo: 'ㄴ', romanization: 'n', sortOrder: 2 })] as import('@study-studio/protocol').HangulItem[];
  function Harness({ nextPool }: { nextPool: typeof pool }) { hook = useHangulDrill({ pool: nextPool, allHangul: nextPool }); return <p>harness</p>; }
  const render = async (nextPool: typeof pool) => act(async () => { dom!.root.render(<QueryClientProvider client={client}><Harness nextPool={nextPool} /></QueryClientProvider>); });
  try {
    await render(pool);
    await act(async () => { hook.startDrill(); });
    const options = [...hook.options];
    await render([...pool, hangulRow({ id: 'h3', jamo: 'ㄷ', romanization: 'd', sortOrder: 3 })] as typeof pool);
    expect(hook.options).toEqual(options);
    await act(async () => { hook.switchDrillMode('WORD_MEANING'); });
    await act(async () => { hook.startDrill(); });
    await waitFor(() => hook.wordsLoaded);
    expect(hook.wordList).toHaveLength(0);
    await settle(); await settle(); expect(requests).toBe(1);
    held = true;
    await act(async () => { hook.startDrill(); });
    await waitFor(() => requests === 2);
    await act(async () => { hook.stopDrill(); });
    await act(async () => { release(); });
    await settle(); await settle(); expect(hook.wordList).toHaveLength(0); expect(hook.isDrillActive).toBe(false);
  } finally { await act(async () => { dom!.root.unmount(); }); client.clear(); globalThis.fetch = originalFetch; }
}, 60000);

}
