import { afterEach, expect, it } from 'bun:test';
import * as React from 'react';
import { TextbookLearningContentSchema } from '@study-studio/document-model';
import { previewLesson } from '../../../fixtures/textbook-learning-preview.js';
import { act, setupDom, type DomHandle } from '../../toc/__tests__/dom-setup.js';

let dom: DomHandle | undefined;
afterEach(() => { dom?.teardown(); dom = undefined; });

it('临时学习预览：同一内容契约 → 分类与译文 → 试答反馈；切换保留、退出重置、空分类不显示', async () => {
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
  const doc = dom.dom.window.document;
  const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  const click = async (element: HTMLElement | null | undefined) => { expect(element).toBeTruthy(); await act(async () => { element!.click(); }); await settle(); };
  const tab = (name: string) => [...doc.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => button.textContent?.startsWith(name));
  const activePanel = () => doc.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;
  const button = (element: ParentNode, name: string) => [...element.querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent?.includes(name));

  await act(async () => { dom!.root.render(<LearningPreviewPage {...previewLesson} />); });
  await settle();
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

  // Closing/reopening creates a new preview, so temporary selections cannot become learner records.
  await act(async () => { dom!.root.render(null); });
  await act(async () => { dom!.root.render(<LearningPreviewPage {...previewLesson} />); });
  await settle(); await click(tab('练习'));
  expect(doc.querySelector('article[aria-label="练习 1：单选"]')?.textContent).not.toContain('回答正确');
  await act(async () => { dom!.root.render(<LearningPreviewPage key="empty-categories" {...previewLesson} content={{ ...previewLesson.content, grammar: [], articles: [], sentences: [], exercises: [] }} />); });
  await settle();
  expect(doc.querySelectorAll('[role="tab"]')).toHaveLength(1);
  expect(tab('词汇')?.getAttribute('aria-selected')).toBe('true');
});
