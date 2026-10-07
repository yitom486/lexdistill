import { afterEach, expect, it } from 'bun:test';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StructuredVocabularyList } from '../StructuredVocabularyList.js';
import { act, setupDom, type DomHandle } from '../../toc/__tests__/dom-setup.js';

let dom: DomHandle | undefined;
let client: QueryClient | undefined;
afterEach(() => { dom?.teardown(); dom = undefined; client?.clear(); client = undefined; });

const ROW = {
  id: 'w-row-1',
  surface: '学校',
  reading: 'がっこう',
  pos: '名詞',
  gloss: '学校',
  source: '原书整理',
  examples: [{ text: '学校へ行きます。', translation: '去学校。' }],
} as const;

const renderList = async (enableAi?: boolean) => {
  dom = await setupDom(true);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  await act(async () => dom!.root.render(
    <QueryClientProvider client={client!}>
      <StructuredVocabularyList words={[ROW as unknown as Parameters<typeof StructuredVocabularyList>[0]['words'][number]]} {...(enableAi ? { enableAi } : {})} />
    </QueryClientProvider>,
  ));
  return dom.dom.window.document;
};

it('教材行默认无 AI 入口；enableAi 开启后可展开讲透面板', async () => {
  const plain = await renderList();
  expect(plain.querySelector('article h4')?.textContent).toBe('学校');
  expect([...plain.querySelectorAll('button')].some(b => b.textContent === 'AI 讲透')).toBe(false);
  dom?.teardown(); dom = undefined; client?.clear(); client = undefined;

  const doc = await renderList(true);
  const toggle = [...doc.querySelectorAll('article button')].find((b): b is HTMLButtonElement => b.textContent === 'AI 讲透');
  expect(toggle).toBeTruthy();
  expect(doc.querySelector('[aria-label="AI 讲透：学校"]')).toBeNull();
  await act(async () => toggle!.click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(doc.querySelector('[aria-label="AI 讲透：学校"]')).toBeTruthy();
  expect([...doc.querySelectorAll('button')].some(b => b.textContent === '生成讲解')).toBe(true);
  await act(async () => toggle!.click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(doc.querySelector('[aria-label="AI 讲透：学校"]')).toBeNull();
});
