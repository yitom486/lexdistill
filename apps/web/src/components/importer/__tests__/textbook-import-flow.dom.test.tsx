import { afterEach, describe, expect, it } from 'bun:test';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TextbookInspectionResult, TextbookInspectionDocSummary } from '@study-studio/protocol';
import { useTextbookImportFlow } from '../useTextbookImportFlow.js';
import { TextbookImportInspection } from '../TextbookImportInspection.js';
import { TextbookPageMapping } from '../TextbookPageMapping.js';
import { usePipelineJobStore } from '../../../stores/usePipelineJobStore.js';
import { usePreferencesStore } from '../../../stores/usePreferencesStore.js';
import { __resetPlatformForTest } from '../../../platform/capabilities.js';
import { act, setupDom, type DomHandle } from '../../toc/__tests__/dom-setup.js';

let dom: DomHandle | null = null;
let client: QueryClient | null = null;
const originalFetch = globalThis.fetch;
const previousPreferences = usePreferencesStore.getState();
const selectedPath = 'D:\\教材\\测试教材.pdf';
let currentFlow: ReturnType<typeof useTextbookImportFlow> | undefined;
let ready = false;
let failSlots = false;
let picked = 0;
let opened = '';
let submitted: Record<string, unknown> | undefined;

function storedDocument(): TextbookInspectionDocSummary {
  return { documentId: 'stored-book', title: '测试教材', displayTitle: '测试教材', sourceKind: 'user_import',
    lessonCount: 2, readyLessonCount: ready ? 2 : 1, lineCount: ready ? 2 : 1, passageLessonCount: ready ? 2 : 1,
    vocabCount: 7, grammarCount: 2, exerciseCount: 3, updatedAt: '2026-09-30T00:00:00Z', hasShreddedAssets: true,
    matchKind: 'file', outlineConfirmed: true,
    lessonDetails: [
      { lessonId: 'old-l1', title: '第1课', status: 'ready', hasPassage: true, lineCount: 1, vocabCount: 7, grammarCount: 2, exerciseCount: 3, hasPreview: true, hasSummary: true },
      { lessonId: 'old-l2', title: '第2课', status: ready ? 'ready' : 'pending', hasPassage: ready, lineCount: ready ? 1 : 0, vocabCount: 0, grammarCount: 0, exerciseCount: 0, hasPreview: false, hasSummary: false },
    ] };
}
function Harness() {
  const [pdfPath, setPdfPath] = React.useState('');
  const [parseError, setParseError] = React.useState<string | null>(null);
  const flow = useTextbookImportFlow({ pdfPath, setPdfPath, pdfFile: null, setPdfFile: () => {}, docPath: '', setDocPath: () => {}, docUrl: '', setDocUrl: () => {}, setParseError, setDocNote: () => {} });
  currentFlow = flow;
  return <>
    <button onClick={() => { void flow.browse(); }}>选择本地文件</button>
    <button onClick={() => setPdfPath('D:\\教材\\另一份.pdf')}>换教材</button>
    <button onClick={() => flow.setEntries([
      { key: 'recognized-1', title: '第1课', printedPage: '1', kind: 'lesson', level: 1, confidence: 'high' },
      { key: 'recognized-2', title: '第2课', printedPage: '3', kind: 'lesson', level: 1, confidence: 'high' },
    ])}>采用已确认目录</button>
    <button onClick={flow.start}>启动提取</button>
    <button onClick={flow.reuseOutline}>复用目录</button>
    {parseError && <p role="alert">{parseError}</p>}
    <TextbookImportInspection result={flow.inspection.data} document={flow.displayDocument} pending={flow.inspection.isFetching} error={flow.inspection.error}
      onRecheck={() => { void flow.recheck(); }} onContinue={() => flow.setStep(2)} onUse={(id) => { opened = id; }} />
    {flow.entries && <TextbookPageMapping entries={flow.entries} onChange={flow.setEntries} />}
  </>;
}
async function tickUntil(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  }
  throw new Error('界面未在预期时间更新');
}
async function click(text: string) {
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
  if (!button) throw new Error(`缺少按钮：${text}`);
  await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve(); });
}
async function prepare() {
  dom = await setupDom();
  ready = false; failSlots = false; picked = 0; opened = ''; submitted = undefined;
  __resetPlatformForTest();
  Object.assign(window, { __TAURI__: { core: { invoke: async (command: string) => {
    expect(command).toBe('platform_pick_file'); picked++; return selectedPath;
  } } } });
  usePipelineJobStore.getState().clearActiveJob();
  usePreferencesStore.setState({ pipelineModel: 'user-selected-model', pipelineEffort: 'low', pipelinePoolSize: '2' });
  globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/inspect-import')) {
      // 请求由真实 Hook 序列化；仅测试的 HTTP 边界替身。
      const body = JSON.parse(String(init?.body)) as { filePath: string };
      const doc = storedDocument();
      const result: TextbookInspectionResult = body.filePath === selectedPath
        ? { status: ready ? 'ready' : 'partial', canDirectlyUse: true, summary: `已导入：${doc.readyLessonCount}/2 课就绪`, matchedDocument: doc }
        : { status: 'not_imported', canDirectlyUse: false, summary: '尚未导入' };
      return Response.json(result);
    }
    if (url.includes('/textbook-lessons/')) {
      if (failSlots) return Response.json({ error: { userMessage: '目录暂时无法读取' } }, { status: 503 });
      return Response.json({ slots: storedDocument().lessonDetails.map((lesson, index) => ({
        documentId: 'stored-book', lessonId: lesson.lessonId, lessonNumber: index + 1, title: lesson.title, sortOrder: index + 1,
        kind: 'lesson', parentId: null, startPage: index === 0 ? 8 : 10, endPage: null, status: lesson.status,
        hasPassage: lesson.hasPassage, hasPreview: lesson.hasPreview, hasSummary: lesson.hasSummary,
      })) });
    }
    if (url.endsWith('/textbook-pipeline-jobs')) {
      submitted = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ jobId: 'test-job', documentId: 'stored-book', userId: 'test-user', title: '测试教材', status: 'running', totalLessons: 2, doneLessons: 0, successfulLessons: 0, failedLessons: [], startedAt: '2026-09-30T00:00:00Z' }, { status: 202 });
    }
    throw new Error(`未预期的请求：${url}`);
  }, { preconnect: originalFetch.preconnect });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  const root = dom.root;
  act(() => root.render(<QueryClientProvider client={client!}><Harness /></QueryClientProvider>));
}
afterEach(() => {
  dom?.teardown(); dom = null;
  client?.clear(); client = null;
  globalThis.fetch = originalFetch;
  currentFlow = undefined;
  usePipelineJobStore.getState().clearActiveJob();
  usePreferencesStore.setState(previousPreferences);
  __resetPlatformForTest();
});

describe('Tauri 教材导入交互集成：真实 Hook、Query 与检测/页码组件', () => {
  it('原生路径选择后展示实际逐课内容，打开已有教材，重新检测更新完成状态', async () => {
    await prepare();
    await click('选择本地文件');
    await tickUntil(() => currentFlow?.inspection.data?.status === 'partial');
    expect(picked).toBe(1);
    expect(currentFlow?.path).toBe(selectedPath);
    expect(document.body.textContent).toContain('1/2 课就绪');
    const rows = [...document.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('第1课已就绪已保存723');
    expect(rows[1]?.textContent).toContain('第2课待提取未保存000');
    await click('打开已导入内容');
    expect(opened).toBe('stored-book');
    ready = true;
    await click('重新检测');
    await tickUntil(() => currentFlow?.inspection.data?.status === 'ready');
    expect(document.body.textContent).toContain('2/2 课就绪');
    expect(document.querySelectorAll('tbody tr')[1]?.textContent).toContain('已就绪已保存');
  });

  it('用户确认印刷页映射后只提交物理页，保留原课 ID，并传递真实用户模型配置', async () => {
    await prepare();
    await click('选择本地文件');
    await tickUntil(() => Boolean(currentFlow?.slots.data?.length));
    await click('采用已确认目录');
    await click('启动提取');
    expect(submitted).toBeUndefined();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('PDF 实际页码');
    const input = document.querySelector('input[aria-label="第一条目录对应的 PDF 页"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('页码输入缺失');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '8');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click('确认页码对应并换算');
    expect(currentFlow?.entries?.map((e) => e.physicalPage)).toEqual([8, 10]);
    await click('启动提取');
    await tickUntil(() => Boolean(submitted));
    expect(submitted?.filePath).toBe(selectedPath);
    expect(submitted?.documentId).toBe('stored-book');
    expect(submitted?.model).toBe('user-selected-model');
    expect(submitted?.effort).toBe('low');
    expect(submitted?.poolSize).toBe(2);
    expect(submitted?.forceOverwrite).toBe(false);
    expect(submitted?.tocEntries).toEqual([
      { id: 'old-l1', title: '第1课', level: 'lesson', startPage: 8, sortOrder: 1 },
      { id: 'old-l2', title: '第2课', level: 'lesson', startPage: 10, sortOrder: 2 },
    ]);
  });

  it('目录读取失败不能假装空目录；换文件不会绑定另一份教材', async () => {
    await prepare(); failSlots = true;
    await click('选择本地文件');
    await tickUntil(() => Boolean(currentFlow?.inspection.data));
    expect(currentFlow?.displayDocument?.documentId).toBe('stored-book');
    await tickUntil(() => Boolean(currentFlow?.slots.isError));
    expect(currentFlow?.targetDocument?.documentId).toBe('stored-book');
    expect(document.querySelector('[role="combobox"]')).toBeNull();
    expect(document.body.textContent).not.toContain('确认教材版本');
    await click('复用目录');
    expect(currentFlow?.entries).toBeNull();
    await click('换教材');
    await tickUntil(() => currentFlow?.inspection.data?.status === 'not_imported');
    expect(currentFlow?.targetDocument).toBeUndefined();
    expect(document.body.textContent).not.toContain('已导入《测试教材》');
  });
});
