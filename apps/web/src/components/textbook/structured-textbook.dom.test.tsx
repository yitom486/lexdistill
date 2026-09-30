import { afterEach, expect, it } from 'bun:test';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TextbookASTSchema, type LessonContent } from '@study-studio/document-model';
import { convertAstToTextbookBook } from '../importer/textbook-converter.js';
import { useImportTextbookMutation, useTextbooksQuery } from '../../queries/textbooks-annotations.js';
import { StructuredLessonPanel } from './StructuredLessonPanel.js';
import { StructuredExerciseList } from './StructuredExerciseList.js';
import { VocabularyExplanation } from './VocabularyExplanation.js';
import { act, setupDom, type DomHandle } from '../toc/__tests__/dom-setup.js';

let dom: DomHandle | undefined, client: QueryClient | undefined;
const originalFetch = globalThis.fetch;
afterEach(() => { dom?.teardown(); client?.clear(); globalThis.fetch = originalFetch; });
it('规范 AST 导入和教材查询沿用同一契约；段落/对话、原书/AI 讲解与七种习题正确渲染', async () => {
  dom = await setupDom();
  const content: LessonContent = {
    coverage: [{ tocId: 'lesson', status: 'EXTRACTED' }],
    blocks: [{ id: 'p', kind: 'PARAGRAPH', text: '正文段落', tocId: 'lesson', source: 'TEXTBOOK' }, { id: 'd', kind: 'DIALOGUE', speaker: '角色甲', text: '规范对白', source: 'TEXTBOOK', tocId: 'lesson', translation: '补充译文', fieldSources: { translation: 'AI' } }],
    vocabularies: [{ id: 'v', surface: '学ぶ', source: 'TEXTBOOK', tocId: 'lesson', aiExplanation: '生词独立补充讲解', examples: [] }], knowledgePoints: [{ id: 'g', title: '知识标题', source: 'TEXTBOOK', tocId: 'lesson', textbookExplanation: '原书讲解内容', aiExplanation: '新增讲解内容', examples: [] }],
    exercises: [
      ...(['CHOICE', 'MULTI_CHOICE', 'ORDERING'] as const).map(type => ({ id: type, type, prompt: `${type} 题干`, source: 'AI' as const, knowledgePointIds: ['g'], options: [{ id: 'a', text: '选项甲' }, { id: 'b', text: '选项乙' }], answer: { optionIds: type === 'CHOICE' ? ['a'] : ['b', 'a'] }, fieldSources: { answer: 'AI' as const } })),
      ...(['FILL_BLANK', 'TRANSLATION', 'SHORT_ANSWER'] as const).map(type => ({ id: type, type, prompt: `${type} 题干`, source: 'AI' as const, knowledgePointIds: ['g'], answer: { text: `${type} 参考答案` }, fieldSources: { answer: 'AI' as const } })),
      { id: 'match', type: 'MATCHING', prompt: '匹配题干', source: 'TEXTBOOK', tocId: 'lesson', knowledgePointIds: ['g'], left: [{ id: 'left', text: '左侧甲' }], right: [{ id: 'right', text: '右侧甲' }], answer: { pairs: [{ leftId: 'left', rightId: 'right' }] }, fieldSources: { answer: 'AI' } },
    ],
  };
  const ast = TextbookASTSchema.parse({ id: 'book', language: 'JA', title: '结构化教材', shortTitle: '教材', level: '', lessons: [
    { id: 'lesson', lessonNumber: 1, title: '第一课', kind: 'lesson', content, vocabularies: [], grammarPoints: [], dialogues: [], exercises: [] },
    { id: 'section', lessonNumber: 2, title: '小节不能当成课', kind: 'section', vocabularies: [], grammarPoints: [], dialogues: [], exercises: [] },
  ] });
  let saved: { id: string; astJson: string } | undefined;
  expect(convertAstToTextbookBook(ast).lessons[0]?.vocabularies[0]?.pitchType).toBe('');
  globalThis.fetch = Object.assign(async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'POST') { saved = JSON.parse(String(init.body)) as { id: string; astJson: string }; return Response.json(saved); }
    return Response.json(saved ? [saved] : []);
  }, { preconnect: originalFetch.preconnect });
  function Harness() {
    const mutation = useImportTextbookMutation('render-user'), books = useTextbooksQuery('render-user');
    const book = books.data?.[0], lesson = book?.lessons[0];
    return <><button onClick={() => mutation.mutate(convertAstToTextbookBook(ast))}>导入规范底稿</button>{book && <h2>{book.title} / {book.totalLessons} 课</h2>}{lesson?.content && <><StructuredLessonPanel content={lesson.content} tab="READER" /><StructuredLessonPanel content={lesson.content} tab="GRAMMAR" /><VocabularyExplanation word={lesson.content.vocabularies[0]!} /><StructuredExerciseList exercises={lesson.content.exercises} /></>}</>;
  }
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  act(() => dom!.root.render(<QueryClientProvider client={client!}><Harness /></QueryClientProvider>));
  await act(async () => { document.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 25)); });
  for (let count = 0; !document.querySelector('[data-content-kind="DIALOGUE"]') && count < 40; count++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  expect(saved).toBeDefined(); expect(TextbookASTSchema.parse(JSON.parse(saved!.astJson)).lessons[0]?.content).toEqual(content);
  expect(document.querySelector('h2')?.textContent).toContain('/ 1 课');
  expect(document.querySelector('[data-content-kind="PARAGRAPH"]')?.textContent).toContain('正文段落');
  expect(document.querySelector('[data-content-kind="DIALOGUE"]')?.textContent).toContain('角色甲');
  expect(document.body.textContent).toContain('译文：AI 补充'); expect(document.body.textContent).toContain('讲解：原书整理'); expect(document.body.textContent).toContain('讲解：AI 补充');
  expect(document.body.textContent).toContain('生词讲解：AI 补充'); expect(document.body.textContent).toContain('生词独立补充讲解');
  const buttons = [...document.querySelectorAll('button')].filter(button => button.textContent === '查看参考答案');
  expect(buttons).toHaveLength(7);
  await act(async () => { for (const button of buttons) button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  expect(document.body.textContent).toContain('选项乙 → 选项甲'); expect(document.body.textContent).toContain('左侧甲 ↔ 右侧甲'); expect(document.body.textContent).toContain('SHORT_ANSWER 参考答案');
  expect(document.body.textContent).not.toContain('optionIds'); expect(document.body.textContent).not.toContain('小节不能当成课');
});
