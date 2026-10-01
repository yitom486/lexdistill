import { afterEach, expect, it } from 'bun:test';
import * as React from 'react';
import { TextbookLearningContentSchema, TextbookASTSchema } from '@study-studio/document-model';
import { previewLesson, previewBooks } from '../../../fixtures/textbook-learning-preview.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, setupDom, type DomHandle } from '../../toc/__tests__/dom-setup.js';

let dom: DomHandle | undefined;
let client: QueryClient | undefined;
const originalFetch = globalThis.fetch;
afterEach(() => { dom?.teardown(); dom = undefined; client?.clear(); globalThis.fetch = originalFetch; });

it('教材主页：Query已保存教材与演示列表 → 选书选章 → 学习试答 → 返回；Zustand恢复导航且不保存作答', async () => {
  // Base UI chooses its DOM effects at import time. Match the existing desktop DOM test isolation.
  if (process.env['LINGUA_LEARNING_PREVIEW_DOM_CHILD'] !== '1') {
    const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_LEARNING_PREVIEW_DOM_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    const [exit, output] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect({ exit, output: exit ? output : '' }).toEqual({ exit: 0, output: '' });
    return;
  }
  expect(TextbookLearningContentSchema.safeParse(previewLesson.content).success).toBe(true);
  dom = await setupDom(true);
  const { LearningPreviewPage } = await import('./LearningPreviewPage.js');
  const { TextbookLearningPreview } = await import('./TextbookLearningPreview.js');
  const { useTextbookNavigationStore: navigation } = await import('../../../stores/useTextbookNavigationStore.js');
  navigation.setState({ view: 'LIBRARY', selectedBookId: null, chaptersByBook: {}, sectionsByChapter: {}, showTranslation: false });
  const savedAst = TextbookASTSchema.parse({ id: 'saved-book', language: 'JA', title: '已保存的教材', shortTitle: '已保存教材', level: '', lessons: [
    { id: 'saved-chapter', lessonNumber: 1, title: '待提取章节', vocabularies: [], grammarPoints: [], dialogues: [], exercises: [] },
  ] });
  const methods: string[] = [];
  globalThis.fetch = Object.assign(async (_input: string | URL | Request, init?: RequestInit) => {
    methods.push(init?.method ?? 'GET');
    return Response.json([{ id: 'saved-book', astJson: JSON.stringify(savedAst) }]);
  }, { preconnect: originalFetch.preconnect });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const renderLibrary = () => <QueryClientProvider client={client!}><TextbookLearningPreview onAddCardFromTextbook={() => { throw new Error('Preview must not create real cards'); }} /></QueryClientProvider>;
  const doc = dom.dom.window.document;
  const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  const click = async (element: HTMLElement | null | undefined) => { expect(element).toBeTruthy(); await act(async () => { element!.click(); }); await settle(); };
  const tab = (name: string) => [...doc.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => button.textContent?.startsWith(name));
  const activePanel = () => doc.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;
  const button = (element: ParentNode, name: string) => [...element.querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent?.includes(name));

  await act(async () => { dom!.root.render(renderLibrary()); });
  for (let attempt = 0; !doc.body.textContent?.includes('已保存的教材') && attempt < 80; attempt++) await settle();
  expect(doc.querySelector('[data-testid="textbook-library-home"]')).not.toBeNull();
  expect(doc.querySelector('[role="dialog"]')).toBeNull();
  expect(doc.querySelectorAll('article')).toHaveLength(previewBooks.length + 1);
  expect(doc.body.textContent).toContain('已保存的教材');
  await click(button(doc.querySelector(`article[aria-label="教材：${previewBooks[0]!.title}"]`)!, '打开教材'));
  expect(doc.querySelector('[data-testid="learning-preview-page"]')).not.toBeNull();
  await click(doc.querySelector<HTMLElement>('[aria-label="选择章节"]'));
  const chapterOption = [...doc.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === previewLesson.chapterTitle);
  expect(chapterOption).toBeTruthy();
  await act(async () => { chapterOption!.focus(); });
  await click(chapterOption);
  expect(doc.querySelector('[aria-label="选择章节"]')?.textContent).toContain(previewLesson.chapterTitle);
  expect(doc.querySelectorAll('[role="tab"]')).toHaveLength(5);
  expect(activePanel().textContent).toContain(previewLesson.content.articles[0]!.text);
  expect(activePanel().textContent).not.toContain('那是一本日语书。');
  await click(doc.querySelector<HTMLElement>('[role="switch"]'));
  expect(activePanel().textContent).toContain('那是一本日语书。');
  await click(tab('词汇'));
  expect(activePanel().querySelectorAll('article')).toHaveLength(previewLesson.content.vocabulary.length);
  expect(activePanel().textContent).toContain('词典');
  await click(activePanel().querySelector<HTMLElement>('[aria-label="加入复习：本"]'));
  expect(activePanel().querySelector('[aria-label="取消复习：本"]')?.getAttribute('aria-pressed')).toBe('true');
  await click(tab('知识点'));
  expect(activePanel().textContent).toContain('用法');
  expect(activePanel().textContent).not.toContain('先判断物品靠近谁');
  await click(button(activePanel(), '换个角度理解'));
  expect(activePanel().textContent).toContain('先判断物品靠近谁');

  await click(tab('练习'));
  const single = doc.querySelector<HTMLElement>('article[aria-label="练习 1：单选"]')!;
  expect(single.textContent).not.toContain('参考答案：');
  expect(button(single, '检查答案')?.disabled).toBe(true);
  await click(button(single, 'それは本です。'));
  await click(button(single, '检查答案'));
  expect(single.textContent).toContain('再核对一下');
  await click(button(single, '重新作答'));
  await click(button(single, 'これは本です。'));
  await click(button(single, '检查答案'));
  expect(single.textContent).toContain('回答正确');
  // Matching must expose both sides before any answer is shown.
  const matching = doc.querySelector<HTMLElement>('article[aria-label="练习 3：配对"]')!;
  expect(matching.querySelectorAll('[role="combobox"]')).toHaveLength(3);
  expect(matching.textContent).toContain('辞書');
  expect(matching.textContent).not.toContain('参考答案：');

  const translation = doc.querySelector<HTMLElement>('article[aria-label="练习 4：翻译"]')!;
  const input = translation.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom!.dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'これはだれの本ですか。');
    input.dispatchEvent(new dom!.dom.window.Event('input', { bubbles: true }));
  });
  await click(button(translation, '对照参考答案'));
  expect(translation.textContent).toContain('尚未评分');
  expect(translation.textContent).not.toContain('回答正确');
  await click(tab('词汇'));
  expect(activePanel().querySelector('[aria-label="取消复习：本"]')).not.toBeNull();
  await click(tab('练习'));
  expect(single.textContent).toContain('回答正确');

  await click(button(doc, '返回教材首页'));
  expect(doc.querySelector('[data-testid="textbook-library-home"]')).not.toBeNull();
  expect(doc.querySelector('[data-testid="learning-preview-page"]')).toBeNull();
  await click(button(doc.querySelector(`article[aria-label="教材：${previewBooks[1]!.title}"]`)!, '打开教材'));
  expect(doc.querySelectorAll('[role="tab"]')).toHaveLength(4);
  expect(tab('句子')).toBeUndefined();
  await click(button(doc, '返回教材首页'));
  await click(button(doc.querySelector(`article[aria-label="教材：${previewBooks[0]!.title}"]`)!, '继续学习'));
  expect(doc.querySelector('[aria-label="选择章节"]')?.textContent).toContain(previewLesson.chapterTitle);
  expect(tab('练习')?.getAttribute('aria-selected')).toBe('true');
  expect(doc.querySelector('article[aria-label="练习 1：单选"]')?.textContent).not.toContain('回答正确');

  // Reload navigation from persisted preferences; preserve location, not learner records.
  const preferences = dom.dom.window.localStorage.getItem('lingua-textbook-navigation');
  expect(preferences).toContain(previewLesson.chapterId);
  await act(async () => { dom!.root.render(null); });
  navigation.setState({ view: 'LIBRARY', selectedBookId: null, chaptersByBook: {}, sectionsByChapter: {} });
  dom.dom.window.localStorage.setItem('lingua-textbook-navigation', preferences!);
  await navigation.persist.rehydrate();
  await act(async () => { dom!.root.render(renderLibrary()); });
  await settle();
  expect(tab('练习')?.getAttribute('aria-selected')).toBe('true');
  expect(doc.querySelector('[aria-label="选择章节"]')?.textContent).toContain(previewLesson.chapterTitle);
  expect(doc.querySelector('article[aria-label="练习 1：单选"]')?.textContent).not.toContain('回答正确');
  expect(methods.every(method => method === 'GET')).toBe(true);
  await act(async () => { dom!.root.render(<LearningPreviewPage key="empty-categories" {...previewLesson} content={{ ...previewLesson.content, grammar: [], articles: [], sentences: [], exercises: [] }} />); });
  await settle();
  expect(doc.querySelectorAll('[role="tab"]')).toHaveLength(1);
  expect(tab('词汇')?.getAttribute('aria-selected')).toBe('true');
});
