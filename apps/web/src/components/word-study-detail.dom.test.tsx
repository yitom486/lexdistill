import { afterEach, expect, it } from 'bun:test';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Hono } from 'hono';
import { DrizzleLearnerRepository } from '../../../gateway/src/infrastructure/drizzle-learner-repository.js';
import { GatewayServer } from '../../../gateway/src/runtime/gateway-runtime.js';
import { createDictionaryRoutes } from '../../../gateway/src/modules/dictionary/http/dictionary-routes.js';
import { act, setupDom, type DomHandle } from './toc/__tests__/dom-setup.js';

let dom: DomHandle | undefined;
let repo: DrizzleLearnerRepository | undefined;
let client: QueryClient | undefined;
const originalFetch = globalThis.fetch;
afterEach(() => { dom?.teardown(); dom = undefined; client?.clear(); repo?.getRawDb().close(); repo = undefined; globalThis.fetch = originalFetch; });

it('单词卡片可展开学习详情：意思/用法/例句；无用法的旧词不显示用法区', async () => {
  if (process.env['LINGUA_WORD_DETAIL_DOM_CHILD'] !== '1') {
    const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_WORD_DETAIL_DOM_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    const [exit, output] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect({ exit, output: exit ? output : '' }).toEqual({ exit: 0, output: '' });
    return;
  }
  dom = await setupDom(true);
  const { VocabularyLibraryPanel } = await import('./VocabularyLibraryPanel.js');
  const { useUserProfileStore } = await import('../stores/useUserProfileStore.js');
  const originalProfile = useUserProfileStore.getState().profile;
  const userId = 'word-detail-owner', scope = { documentId: 'detail-book', chapterId: 'detail-chapter' };
  useUserProfileStore.setState({ profile: { ...originalProfile, userId, targetLanguage: 'ja' } });
  repo = new DrizzleLearnerRepository(':memory:');
  const deps = { repo, server: new GatewayServer(repo), port: 0 };
  const app = new Hono().route('/', createDictionaryRoutes(deps));
  expect((await repo.seedTextbookTocSkeleton({ userId, documentId: scope.documentId, title: '详情教材', language: 'ja', sourceFingerprint: 'detail',
    entries: [{ id: scope.chapterId, title: '第一课', level: 'lesson', startPage: 1 }] })).ok).toBe(true);
  expect((await repo.writeTextbookContent({ userId, ...scope }, 'vocabulary', { items: [
    { word: '学校', reading: 'がっこう', meaning: '学校', level: 'N5', usage: '学校へ行く；常见搭配', contextNote: '本课指上学的场所', examples: [{ text: '学校へ行きます。', translation: '去学校。' }] },
    { word: '猫', reading: 'ねこ', meaning: '猫', level: 'N5' },
  ] })).ok).toBe(true);
  repo.getRawDb().query("UPDATE global_vocabulary SET learning_json=?, learning_version=1 WHERE word='学校'").run(
    JSON.stringify({ explanation: '学校是上学的地方。', scenarios: [{ title: '问路', dialogue: [{ speaker: 'A', text: '学校はどこですか。', translation: '学校在哪里？' }], note: '问路时用。' }], pitfalls: ['学校≠学院'], quiz: { prompt: '用学校造一个问路的句子', answer: '学校はどこですか。' }, source: 'AI' }));
  globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => app.request(new Request(input, init)),
    { preconnect: originalFetch.preconnect });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  const doc = dom.dom.window.document;
  const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  const waitFor = async (ready: () => boolean) => { for (let i = 0; i < 150 && !ready(); i++) await settle(); expect(ready()).toBe(true); };
  const click = async (element: HTMLElement | null | undefined) => { expect(element).toBeTruthy(); await act(async () => element!.click()); await settle(); };
  try {
    await act(async () => dom!.root.render(<QueryClientProvider client={client!}><VocabularyLibraryPanel language="ja" /></QueryClientProvider>));
    await waitFor(() => doc.querySelectorAll('section[aria-label="词汇库"] article').length === 2);
    expect(doc.querySelector('[aria-label="单词学习：学校"]')).toBeNull();
    await click(doc.querySelector<HTMLElement>('[aria-label="学习单词：学校"]'));
    await waitFor(() => !!doc.querySelector('[aria-label="单词学习：学校"]'));
    const detail = doc.querySelector('[aria-label="单词学习：学校"]')!;
    expect(detail.textContent).toContain('学校');
    expect(detail.textContent).toContain('本课指上学的场所');
    expect(detail.textContent).toContain('学校へ行く');
    expect(detail.textContent).toContain('学校へ行きます。');
    expect(detail.textContent).toContain('学校是上学的地方。');
    expect(detail.textContent).toContain('问路');
    expect(detail.textContent).toContain('学校≠学院');
    expect(detail.textContent).toContain('用学校造一个问路的句子');
    expect(detail.querySelector('button:not([disabled])')?.textContent).toContain('问 AI');
    await click(detail.querySelector<HTMLElement>('button:not([disabled])'));
    await waitFor(() => !!doc.querySelector('[aria-label="AI 追问：学校"]'));
    expect(doc.querySelector('[aria-label="AI 追问：学校"]')?.textContent).toContain('在这里直接追问');
    await click(doc.querySelector<HTMLElement>('[aria-label="学习单词：猫"]'));
    await waitFor(() => !!doc.querySelector('[aria-label="单词学习：猫"]'));
    const plain = doc.querySelector('[aria-label="单词学习：猫"]')!;
    expect(plain.textContent).not.toContain('本课指上学的场所');
    expect(plain.textContent).not.toContain('学校へ行きます。');
    expect(plain.textContent).toContain('暂无用法与例句');
  } finally {
    await act(async () => { dom!.root.render(<div />); useUserProfileStore.setState({ profile: originalProfile }); });
    await settle();
  }
}, 30_000);
