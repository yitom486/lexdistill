import { expect, it, mock } from 'bun:test';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TextbookASTSchema } from '@study-studio/document-model';
import { act, setupDom } from '../../../toc/__tests__/dom-setup.js';

it('actual library query separates failed reads and saved cache from preview books', async () => {
  if (process.env['LINGUA_LIBRARY_QUERY_CHILD'] !== '1') {
    const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_LIBRARY_QUERY_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ exit, output: exit ? stdout + stderr : '' }).toEqual({ exit: 0, output: '' });
    return;
  }
  const dom = await setupDom(true);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const originalFetch = globalThis.fetch;
  mock.module('../../../TextbookImporterModal.js', () => ({ TextbookImporterModal: () => null }));
  const { TextbookLearningPreview } = await import('../TextbookLearningPreview.js');
  const { useTextbookNavigationStore } = await import('../../../../stores/useTextbookNavigationStore.js');
  useTextbookNavigationStore.getState().backToLibrary();
  const ast = TextbookASTSchema.parse({
    id: 'saved-book', title: '已保存边界测试教材', shortTitle: '测试教材', language: 'JA', level: 'N5',
    lessons: [{ id: 'saved-chapter', lessonNumber: 1, title: '第一课', vocabularies: [], grammarPoints: [], dialogues: [], exercises: [] }],
  });
  let mode: 'network' | 'http' | 'empty' | 'saved' = 'network';
  let calls = 0;
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  globalThis.fetch = Object.assign(async () => {
    calls += 1;
    if (calls === 1) await firstGate;
    if (mode === 'network') throw new TypeError('Failed to fetch');
    if (mode === 'http') return Response.json({ success: false, error: { code: 'E_TEST_READ', userMessage: '受控读取失败' } }, { status: 503 });
    return Response.json(mode === 'empty' ? [] : [{ id: 'saved-document', astJson: JSON.stringify(ast) }]);
  }, { preconnect: originalFetch.preconnect });
  const doc = dom.dom.window.document;
  const waitFor = async (predicate: () => boolean) => {
    for (let i = 0; i < 200 && !predicate(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(predicate()).toBe(true);
  };
  const query = () => client.getQueryCache().getAll().find(q => q.queryKey[1] === 'textbooks')!;
  const click = async (text: string) => {
    const button = [...doc.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text);
    expect(button).toBeTruthy();
    await act(async () => button!.click());
  };
  try {
    await act(async () => dom.root.render(<QueryClientProvider client={client}>
      <TextbookLearningPreview onAddCardFromTextbook={() => {}} />
    </QueryClientProvider>));
    // Initial read remains unknown even though the three previews are already browsable.
    expect(doc.body.textContent).toContain('正在读取已保存教材');
    expect(doc.body.textContent).toContain('临时演示');
    expect(doc.body.textContent).not.toContain('正在同步');
    releaseFirst();
    await waitFor(() => query().state.status === 'error' && doc.body.textContent?.includes('暂时无法读取已保存教材') === true);
    expect(query().state.data).toBeUndefined();
    expect(doc.body.textContent).toContain('暂时无法读取已保存教材');
    expect(doc.body.textContent).toContain('临时演示教材仍可浏览');
    expect(doc.body.textContent).not.toContain('可能不是最新');

    // A non-success HTTP response must also reject, rather than become a successful [].
    mode = 'http';
    await click('重试');
    await waitFor(() => calls === 2 && query().state.fetchStatus === 'idle');
    expect(query().state.status).toBe('error');
    expect(query().state.error?.message).toBe('受控读取失败');
    expect(query().state.data).toBeUndefined();

    mode = 'empty';
    await click('重试');
    await waitFor(() => query().state.status === 'success' && !doc.body.textContent?.includes('暂时无法读取'));
    expect(query().state.data).toEqual([]);
    expect(doc.body.textContent).not.toContain('暂时无法读取');
    expect(doc.body.textContent).not.toContain('可能不是最新');
    expect(doc.querySelectorAll('article')).toHaveLength(3);

    mode = 'saved';
    await click('刷新教材');
    await waitFor(() => doc.body.textContent?.includes(ast.title) === true);
    expect(doc.querySelectorAll('article')).toHaveLength(4);
    const cached = query().state.data;
    mode = 'http';
    await click('刷新教材');
    await waitFor(() => query().state.status === 'error' && query().state.fetchStatus === 'idle' && doc.body.textContent?.includes('可能不是最新') === true);
    expect(query().state.data).toEqual(cached);
    expect(doc.body.textContent).toContain(ast.title);
    expect(doc.body.textContent).toContain('可能不是最新');
    expect(doc.body.textContent).not.toContain('暂时无法读取已保存教材');
  } finally {
    releaseFirst();
    client.clear();
    dom.teardown();
    globalThis.fetch = originalFetch;
  }
}, 20000);
