import { expect, it, mock } from 'bun:test';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, setupDom, type DomHandle } from '../toc/__tests__/dom-setup.js';
/**
 * UI-R10 动效收敛与用户偏好生效：受控 matchMedia + 真行为（非样式断言）。
 * 覆盖：纸屑在减少动态效果下跳过、音效开关门禁（开有关闭 antifragile）、
 * 设置卡片切换偏好、全部视觉时长 token 的 reduce 覆盖、matchMedia 助手与订阅、
 * 级联列表在两种动效设置下同一终态。隔离环境，不做真实录音/付费 TTS、
 * 真实写入或录屏；受控 matchMedia 不冒充 OS 级设置。
 */

if (process.env['LINGUA_MOTION_CHILD'] !== '1') {
  it('motion preferences states (child isolation)', async () => {
    const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_MOTION_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
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

/** 受控 matchMedia：matches 可调，change 可派发，卸载可恢复。 */
function stubMatchMedia() {
  const original = (window as unknown as { matchMedia?: unknown }).matchMedia;
  let matches = false;
  const listeners = new Set<(e: { matches: boolean }) => void>();
  const stub = () => ({
    matches,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: (_type: string, fn: (e: { matches: boolean }) => void) => { listeners.add(fn); },
    removeEventListener: (_type: string, fn: (e: { matches: boolean }) => void) => { listeners.delete(fn); },
    addListener: (fn: (e: { matches: boolean }) => void) => { listeners.add(fn); },
    removeListener: (fn: (e: { matches: boolean }) => void) => { listeners.delete(fn); },
    dispatchEvent: () => false,
  });
  (window as unknown as { matchMedia: unknown }).matchMedia = stub;
  return {
    setMatches: (v: boolean) => {
      matches = v;
      for (const fn of [...listeners]) fn({ matches: v });
    },
    listenerCount: () => listeners.size,
    restore: () => {
      if (original === undefined) delete (window as unknown as { matchMedia?: unknown }).matchMedia;
      else (window as unknown as { matchMedia: unknown }).matchMedia = original;
    },
  };
}

function mockInfra() {
  mock.module('../../utils/audio.js', () => ({
    sound: {
      playClick() {}, playCorrect() {}, playMistake() {}, playSuccess() {}, playError() {}, playFanfare() {},
    },
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
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
}

const settle = async () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
async function waitFor(ready: () => boolean) {
  for (let i = 0; i < 200 && !ready(); i++) await settle();
  expect(ready()).toBe(true);
}

/** 伪 AudioContext：只计数构造，证明门禁是否放行到引擎。 */
function stubAudioContext(counter: { count: number; closed?: number; immediateStops?: number }) {
  (window as unknown as { AudioContext: unknown }).AudioContext = class {
    state = 'running';
    currentTime = 0;
    destination = {};
    constructor() { counter.count += 1; }
    resume() { return Promise.resolve(); }
    close() { counter.closed = (counter.closed ?? 0) + 1; return Promise.resolve(); }
    createOscillator() {
      return {
        type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {}, disconnect() {}, start() {}, stop(at?: number) {
          if (at === undefined) counter.immediateStops = (counter.immediateStops ?? 0) + 1;
        },
      };
    }
    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} };
    }
  };
}

it('纸屑：减少动态效果下跳过，正常时触发', async () => {
  await freshDom();
  const media = stubMatchMedia();
  try {
    const fired: unknown[][] = [];
    let finish!: (value: undefined) => void;
    const flight = new Promise<undefined>((resolve) => { finish = resolve; });
    let resets = 0;
    const launch = Object.assign((...args: unknown[]) => { fired.push(args); return flight; }, {
      reset: () => { resets++; finish(undefined); },
    });
    mock.module('canvas-confetti', () => ({ default: launch }));
    const { fireSuccessConfetti } = await import('../magicui/Confetti.js');
    media.setMatches(false);
    fireSuccessConfetti();
    expect(fired.length).toBeGreaterThan(0);
    fired.length = 0;
    media.setMatches(true);
    expect(resets).toBe(1);
    await settle();
    expect(media.listenerCount()).toBe(0);
    fireSuccessConfetti();
    expect(fired.length).toBe(0);
  } finally {
    media.restore();
  }
}, 30000);

it('音效门禁：关闭偏好后 click/success/mistake/fanfare 一律静默', async () => {
  await freshDom();
  const counter = { count: 0, closed: 0, immediateStops: 0 };
  stubAudioContext(counter);
  const { sound } = await import('../../utils/audio.js');
  const { usePreferencesStore } = await import('../../stores/usePreferencesStore.js');
  usePreferencesStore.setState({ soundEffectsEnabled: false });
  try {
    sound.playClick();
    sound.playSuccess();
    sound.playMistake();
    sound.playFanfare();
    await settle();
    // 门禁在取 AudioContext 之前返回：零构造
    expect(counter.count).toBe(0);
    usePreferencesStore.setState({ soundEffectsEnabled: true });
    sound.playClick();
    await settle();
    expect(counter.count).toBeGreaterThan(0);
    sound.playFanfare();
    usePreferencesStore.setState({ soundEffectsEnabled: false });
    expect(counter.immediateStops).toBe(5);
    expect(counter.closed).toBe(1);
    sound.playClick();
    expect(counter.count).toBe(1);
    usePreferencesStore.setState({ soundEffectsEnabled: true });
    sound.playClick();
    expect(counter.count).toBe(2);
    usePreferencesStore.setState({ soundEffectsEnabled: false });
    expect(counter.closed).toBe(2);
  } finally {
    usePreferencesStore.setState({ soundEffectsEnabled: true });
  }
}, 30000);

it('设置卡片：开关切换偏好并即时说明，静音不影响朗读入口', async () => {
  await freshDom();
  mockInfra();
  const { SettingsSoundEffectsCard } = await import('../settings/SettingsSoundEffectsCard.js');
  const { usePreferencesStore } = await import('../../stores/usePreferencesStore.js');
  usePreferencesStore.setState({ soundEffectsEnabled: true });
  const doc = dom!.dom.window.document;
  const client = makeClient();
  await act(async () => { dom!.root.render(<QueryClientProvider client={client}><SettingsSoundEffectsCard /></QueryClientProvider>); });
  await waitFor(() => !!doc.querySelector('[aria-label="界面音效开关"]'));
  expect(doc.body.textContent).toContain('按键、答对与答错有轻柔提示音');
  await act(async () => { (doc.querySelector('[aria-label="界面音效开关"]') as HTMLElement).click(); });
  await waitFor(() => usePreferencesStore.getState().soundEffectsEnabled === false);
  expect(doc.body.textContent).toContain('已静音');
  expect(doc.body.textContent).toContain('学习朗读不受影响');
  await act(async () => { (doc.querySelector('[aria-label="界面音效开关"]') as HTMLElement).click(); });
  await waitFor(() => usePreferencesStore.getState().soundEffectsEnabled === true);
  client.clear();
}, 30000);

it('CSS 收敛：全部视觉时长 token 在 reduce 下被覆盖', async () => {
  const css = await Bun.file('apps/web/src/index.css').text();
  const rootBlock = css.slice(0, css.indexOf('@media (prefers-reduced-motion: reduce)'));
  const defined = [...rootBlock.matchAll(/--motion-([a-z-]+):\s*[^;]+;/g)]
    .map((m) => `--motion-${m[1]}`)
    // 收敛目标本身不需覆盖；delay/interval 不是位移时长，不在 duration 集内
    .filter((name) => name.endsWith('-duration') && name !== '--motion-reduced-duration');
  expect(defined.length).toBeGreaterThan(10);
  const reduceBlock = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  const reduceSection = reduceBlock.slice(0, reduceBlock.indexOf('::view-transition'));
  const missing = defined.filter((name) => !reduceSection.includes(`${name}:`));
  expect({ missing }).toEqual({ missing: [] });
}, 30000);

it('matchMedia 助手：缺环境回落、无泄漏订阅', async () => {
  const media = stubMatchMedia();
  try {
    const { isReducedMotion, watchReducedMotion } = await import('../../lib/css-tokens.js');
    media.setMatches(false);
    expect(isReducedMotion()).toBe(false);
    await act(async () => { media.setMatches(true); });
    expect(isReducedMotion()).toBe(true);
    const seen: boolean[] = [];
    const stop = watchReducedMotion((v) => seen.push(v));
    media.setMatches(false);
    media.setMatches(true);
    expect(seen).toEqual([false, true]);
    const before = media.listenerCount();
    stop();
    expect(media.listenerCount()).toBe(before - 1);
    media.setMatches(false);
    expect(seen).toEqual([false, true]);
  } finally {
    media.restore();
  }
  // 无 matchMedia 环境回落为 false，不抛
  const { isReducedMotion: check } = await import('../../lib/css-tokens.js');
  expect(check()).toBe(false);
}, 30000);

it('级联列表：减少动态效果开/关到达同一真实终态', async () => {
  await freshDom();
  mockInfra();
  const media = stubMatchMedia();
  const { LearningAnalysisPanel } = await import('../LearningAnalysisPanel.js');
  const doc = dom!.dom.window.document;
  const originalFetch = globalThis.fetch;
  const report = {
    userId: 'u1', language: 'ja', source: 'local-rules',
    summary: '保持节奏',
    suggestions: [
      { kind: 'WEAKNESS', title: '助词', detail: '多练' },
      { kind: 'PLAN', title: '计划', detail: '每日' },
    ],
  };
  const fetchFn = (async () => Response.json(report)) as unknown as typeof fetch;
  globalThis.fetch = fetchFn;
  try {
    media.setMatches(false);
    const client = makeClient();
    await act(async () => { dom!.root.render(<QueryClientProvider client={client}><LearningAnalysisPanel userId="u1" /></QueryClientProvider>); });
    await waitFor(() => !!doc.body.textContent?.includes('助词'));
    const textMotion = doc.body.textContent;
    // 减少动态效果下重挂载：终态文本必须一致（动效设置不改变业务内容）
    await act(async () => { media.setMatches(true); });
    const client2 = makeClient();
    await act(async () => { dom!.root.render(<QueryClientProvider client={client2}><LearningAnalysisPanel userId="u1" /></QueryClientProvider>); });
    await waitFor(() => !!doc.body.textContent?.includes('助词'));
    const textReduced = doc.body.textContent;
    expect(textReduced).toBe(textMotion);
    client.clear();
    client2.clear();
  } finally {
    globalThis.fetch = originalFetch;
    media.restore();
  }
}, 60000);

it('实时偏好：数字立即显示终值，变更不重挂组件，卸载移除订阅', async () => {
  await freshDom();
  const media = stubMatchMedia();
  const { useMotionPreference } = await import('../../hooks/useMotionPreference.js');
  const { NumberTicker } = await import('../magicui/NumberTicker.js');
  const { UpdateAvailableDot } = await import('../app-header/UpdateAvailableDot.js');
  const originalObserver = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = class {
    constructor(private callback: IntersectionObserverCallback) {}
    observe(target: Element) {
      queueMicrotask(() => this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver));
    }
    unobserve() {} disconnect() {}
  } as unknown as typeof IntersectionObserver;
  let mounts = 0;
  function Probe({ value }: { value: number }) {
    const reduced = useMotionPreference();
    React.useEffect(() => { mounts++; }, []);
    return <div data-reduced={String(reduced)}><NumberTicker value={value} delay={20} decimalPlaces={1} /><UpdateAvailableDot /></div>;
  }
  const doc = dom!.dom.window.document;
  try {
    await act(async () => { dom!.root.render(<Probe value={37.5} />); });
    const animatedDot = doc.querySelector('[aria-hidden="true"]');
    await act(async () => { media.setMatches(true); });
    expect(doc.querySelector('[aria-hidden="true"]')).not.toBe(animatedDot);
    expect(doc.querySelector('[data-reduced]')?.getAttribute('data-reduced')).toBe('true');
    expect(doc.querySelector('span')?.textContent).toBe('37.5');
    await act(async () => { dom!.root.render(<Probe value={0} />); });
    expect(doc.querySelector('span')?.textContent).toBe('0.0');
    await act(async () => { media.setMatches(false); });
    expect(doc.querySelector('[data-reduced]')?.getAttribute('data-reduced')).toBe('false');
    expect(mounts).toBe(1);
    await act(async () => { dom!.root.render(null); });
    expect(media.listenerCount()).toBe(0);
  } finally {
    globalThis.IntersectionObserver = originalObserver;
    media.restore();
  }
}, 30000);
}
