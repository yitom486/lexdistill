import { afterEach, expect, it } from 'bun:test';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Hono } from 'hono';
import { DrizzleLearnerRepository } from '../../../gateway/src/infrastructure/drizzle-learner-repository.js';
import { GatewayServer } from '../../../gateway/src/runtime/gateway-runtime.js';
import { createDictionaryRoutes } from '../../../gateway/src/modules/dictionary/http/dictionary-routes.js';
import { createReviewRoutes } from '../../../gateway/src/modules/review/http/review-routes.js';
import { previewLesson } from '../fixtures/textbook-learning-preview.js';
import { act, setupDom, type DomHandle } from './toc/__tests__/dom-setup.js';

let dom: DomHandle | undefined;
let repo: DrizzleLearnerRepository | undefined;
let client: QueryClient | undefined;
const originalFetch = globalThis.fetch;
afterEach(() => { dom?.teardown(); dom = undefined; client?.clear(); repo?.getRawDb().close(); repo = undefined; globalThis.fetch = originalFetch; });

it('真实教材词汇可加入复习、重开仍已收藏；词汇库可按教材章节筛选，失败不假标成功', async () => {
  if (process.env['LINGUA_VOCABULARY_DOM_CHILD'] !== '1') {
    const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_VOCABULARY_DOM_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    const [exit, output] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect({ exit, output: exit ? output : '' }).toEqual({ exit: 0, output: '' });
    return;
  }
  dom = await setupDom(true);
  const { PreviewVocabulary } = await import('./textbook/preview/PreviewContentSections.js');
  const { VocabularyLibraryPanel } = await import('./VocabularyLibraryPanel.js');
  const { useCardsQuery } = await import('../queries/cards-mistakes-questions.js');
  const { useUserProfileStore } = await import('../stores/useUserProfileStore.js');
  const originalProfile = useUserProfileStore.getState().profile;
  const userId = 'vocabulary-dom-owner', scope = { documentId: 'dom-book', chapterId: 'dom-chapter' };
  useUserProfileStore.setState({ profile: { ...originalProfile, userId, targetLanguage: 'ja' } });
  repo = new DrizzleLearnerRepository(':memory:');
  const deps = { repo, server: new GatewayServer(repo), port: 0 };
  const app = new Hono().route('/', createDictionaryRoutes(deps)).route('/', createReviewRoutes(deps));
  expect((await repo.seedTextbookTocSkeleton({ userId, documentId: scope.documentId, title: '已导入的日语教材', language: 'ja', sourceFingerprint: 'dom',
    entries: [{ id: scope.chapterId, title: '真实第一课', level: 'lesson', startPage: 1 }] })).ok).toBe(true);
  expect((await repo.writeTextbookContent({ userId, ...scope }, 'vocabulary', { items: [{ word: '本', reading: 'ほん', meaning: '书', level: 'N5', partOfSpeech: '名词', examples: [{ text: '本を読みます。', translation: '读书。' }] }, { word: '猫', reading: 'ねこ', meaning: '猫', level: 'N5' }] })).ok).toBe(true);
  const words = await repo.listVocabulary(userId, 'ja');
  expect(words.ok).toBe(true);
  if (!words.ok) return;
  const bookWord = words.value.find(word => word.word === '本')!, catWord = words.value.find(word => word.word === '猫')!;
  let failCollect = false;
  const posts: string[] = [];
  globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.method === 'POST') {
      posts.push(new URL(request.url).pathname);
      if (failCollect) return Response.json({ success: false, error: { userMessage: '模拟数据库写入失败' } }, { status: 500 });
    }
    return app.request(request);
  }, { preconnect: originalFetch.preconnect });
  const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  client = newClient();
  const content = { ...previewLesson.content, vocabulary: [
    { ...previewLesson.content.vocabulary[0]!, id: 'local-book-word', vocabularyId: bookWord.id, word: '本', reading: 'ほん', meaning: '书' },
    { ...previewLesson.content.vocabulary[0]!, id: 'local-cat-word', vocabularyId: catWord.id, word: '猫', reading: 'ねこ', meaning: '猫' },
  ] };
  const preview = () => <QueryClientProvider client={client!}><PreviewVocabulary content={content} showTranslation language="ja" explain={() => null} scope={scope} temporary={false} /></QueryClientProvider>;
  const doc = dom.dom.window.document;
  const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  const waitFor = async (ready: () => boolean) => { for (let i = 0; i < 150 && !ready(); i++) await settle(); expect(ready()).toBe(true); };
  const click = async (element: HTMLElement | null | undefined) => { expect(element).toBeTruthy(); await act(async () => element!.click()); await settle(); };
  try {
    await act(async () => dom!.root.render(preview()));
    await waitFor(() => doc.querySelector<HTMLButtonElement>('[aria-label="加入复习：本"]')?.disabled === false);
    await click(doc.querySelector<HTMLElement>('[aria-label="加入复习：本"]'));
    await waitFor(() => !!doc.querySelector('[aria-label="已加入复习：本"]'));
    expect(posts).toEqual([`/api/vocabulary/${userId}/${bookWord.id}/collect`]);
    const cards = await repo.getDueCards(userId, 20, { language: 'ja' });
    expect(cards.ok && cards.value).toHaveLength(1);
    expect(cards.ok && cards.value[0]!.vocabularyId).toBe(bookWord.id);
    expect(cards.ok && cards.value[0]!.examples).toEqual([{ text: '本を読みます。', translation: '读书。' }]);
    await act(async () => dom!.root.render(<div />)); client.clear(); client = newClient();
    await act(async () => dom!.root.render(preview()));
    await waitFor(() => !!doc.querySelector('[aria-label="已加入复习：本"]'));
    expect(doc.querySelector<HTMLButtonElement>('[aria-label="已加入复习：本"]')?.disabled).toBe(true);
    failCollect = true;
    await click(doc.querySelector<HTMLElement>('[aria-label="加入复习：猫"]'));
    await waitFor(() => posts.length === 2 && doc.querySelector<HTMLButtonElement>('[aria-label="加入复习：猫"]')?.disabled === false);
    expect(doc.querySelector('[aria-label="已加入复习：猫"]')).toBeNull();
    expect((await repo.getDueCards(userId, 20, { language: 'ja' })).ok).toBe(true);
    function CardProbe() {
      const cardsQuery = useCardsQuery();
      return <p data-testid="actual-card">{cardsQuery.data?.map(card => `${card.frontWord}|${card.pos}|${card.exampleJp}|${card.vocabularyId}`).join(';')}</p>;
    }
    await act(async () => dom!.root.render(<QueryClientProvider client={client!}><VocabularyLibraryPanel language="ja" /><CardProbe /></QueryClientProvider>));
    await waitFor(() => doc.querySelectorAll('section[aria-label="词汇库"] article').length === 2);
    expect(doc.querySelector('section[aria-label="词汇库"]')!.textContent).toContain('已导入的日语教材 · 真实第一课');
    expect(doc.querySelector('section[aria-label="词汇库"] article')?.textContent).toContain('已加入复习');
    await waitFor(() => doc.querySelector('[data-testid="actual-card"]')?.textContent?.includes(`本|名词|本を読みます。|${bookWord.id}`) === true);
    await click(doc.querySelector<HTMLElement>('[aria-label="筛选词汇教材"]'));
    const bookOption = [...doc.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === '已导入的日语教材');
    await act(async () => bookOption!.focus());
    await click(bookOption);
    await waitFor(() => !!doc.querySelector('[aria-label="筛选词汇章节"]'));
    await click(doc.querySelector<HTMLElement>('[aria-label="筛选词汇章节"]'));
    const chapterOption = [...doc.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === '真实第一课');
    await act(async () => chapterOption!.focus());
    await click(chapterOption);
    expect(doc.querySelector('[aria-label="筛选词汇章节"]')?.textContent).toContain('真实第一课');
    expect(doc.querySelectorAll('section[aria-label="词汇库"] article')).toHaveLength(2);
    expect(repo.getRawDb().query<{ n: number }, [string]>('SELECT count(*) AS n FROM flashcards WHERE user_id=?').get(userId)!.n).toBe(1);
  } finally {
    await act(async () => { dom!.root.render(<div />); useUserProfileStore.setState({ profile: originalProfile }); });
    await settle();
  }
}, 30_000);
