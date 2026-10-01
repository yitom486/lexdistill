import { afterEach, describe, expect, it } from 'bun:test';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TextbookASTSchema } from '@study-studio/document-model';
import { convertAstToTextbookBook } from '../../textbook-converter.js';
import { DrizzleLearnerRepository } from '../../../../../../gateway/src/infrastructure/drizzle-learner-repository.js';
import { LibraryLessonCommitTool } from '../../../../../../gateway/src/modules/library/tools/library-lesson-commit-tool.js';
import { createImportMonitorRoutes } from '../../../../../../gateway/src/modules/library/http/import-monitor-routes.js';
import { pipelineModel, submissionFromPrompt, deferred } from '../../../../../../gateway/src/modules/library/__tests__/textbook-pipeline-fixtures.js';
import { act, setupDom, type DomHandle } from '../../../toc/__tests__/dom-setup.js';

let dom: DomHandle | undefined, repo: DrizzleLearnerRepository | undefined, client: QueryClient | undefined;
const originalFetch = globalThis.fetch;
afterEach(() => { dom?.teardown(); dom = undefined; client?.clear(); repo?.getRawDb().close(); repo = undefined; globalThis.fetch = originalFetch; });
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); }); }
describe('桌面监视弹窗：真实 Query → Gateway → SQLite', () => {
  it('当前交互展开、历史折叠；详情按需读；关闭重开保留本次记录和已保存内容', async () => {
    // Base UI 在导入时选择 DOM layout effect；隔离进程防止其他测试先在无 DOM 时缓存该模块。
    if (process.env['LINGUA_MONITOR_DOM_CHILD'] !== '1') {
      const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], { env: { ...process.env, LINGUA_MONITOR_DOM_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe' });
      const [exit, output] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      expect({ exit, output: exit ? output : '' }).toEqual({ exit: 0, output: '' });
      return;
    }
    repo = new DrizzleLearnerRepository(':memory:');
    const currentRepo = repo, tool = new LibraryLessonCommitTool(repo), waiting = deferred(), reached = deferred();
    const model = pipelineModel(tool, async ({ input, submit }) => {
      const value = submissionFromPrompt(input.message);
      value.content.vocabularies[0]!.aiExplanation = '保存的生词独立讲解';
      if (value.content.coverage[0]!.tocId === 'b') { reached.resolve(); await waiting.promise; }
      expect((await submit(value)).ok).toBe(true);
    });
    const running = repo.executeTextbookPipeline({ userId: 'owner', traceId: 'desktop-trace', documentId: 'desktop-book', title: '监视教材', poolSize: 1,
      tocEntries: [{ id: 'u', level: 'unit', title: '真实单元', startPage: 5, endPage: 11 },
        { id: 'a', level: 'section', parentId: 'u', title: '已保存部分', startPage: 5, endPage: 7 }, { id: 'ac', level: 'section', parentId: 'a', title: '会话小节', startPage: 6, endPage: 7 },
        { id: 'b', level: 'lesson', parentId: 'u', title: '当前部分', startPage: 8, endPage: 11 }],
      lessonJobs: [{ lessonId: 'a', text: '历史正文' }, { lessonId: 'b', text: '当前正文' }], adapter: model.adapter, submissionTool: tool,
    });
    try {
      await reached.promise;
      const document = await currentRepo.getDocumentById('desktop-book'); if (!document.ok) throw document.error;
      const book = convertAstToTextbookBook(TextbookASTSchema.parse(JSON.parse(document.value!.astJson!)));
      expect(book.lessons.map(lesson => lesson.id)).toEqual(['a', 'b']); expect(book.totalLessons).toBe(1);
      expect(book.lessons[0]?.kind).toBe('section'); expect(book.lessons[0]?.directory?.map(node => node.id)).toEqual(['u', 'a', 'ac']);
      const app = createImportMonitorRoutes(currentRepo), reads: string[] = [];
      globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        reads.push(url.pathname); return app.request(`${url.pathname}${url.search}`, init);
      }, { preconnect: originalFetch.preconnect });
      dom = await setupDom(true); client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const { TextbookImportMonitor } = await import('../TextbookImportMonitor.js');
      function Harness() {
        const [open, setOpen] = React.useState(true);
        return <><button onClick={() => setOpen(true)}>重开监视</button><TextbookImportMonitor open={open} onOpenChange={setOpen} userId="owner" traceId="desktop-trace" /></>;
      }
      await act(async () => { dom!.root.render(<QueryClientProvider client={client!}><Harness /></QueryClientProvider>); });
      await settle(); await settle();
      const doc = dom.dom.window.document;
      for (let attempt = 0; attempt < 30 && !doc.querySelector('[data-testid="current-interaction"]'); attempt++) await settle();
      expect(doc.body.textContent).toContain('当前交互');
      expect(doc.querySelector<HTMLDetailsElement>('[data-testid="current-interaction"]')?.open).toBe(true);
      expect(doc.querySelector<HTMLDetailsElement>('[data-testid="history-interaction"]')?.open).toBe(false);
      expect(doc.body.textContent).toContain('当前正文');
      await act(async () => [...doc.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '已保存部分')!.click());
      await settle();
      await act(async () => [...doc.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '查询数据库当前保存内容')!.click());
      await settle(); await settle();
      expect(doc.body.textContent).toContain('当前版本');
      expect(doc.querySelector('[data-testid="saved-result"]')?.textContent).toContain('数据库派生行：正文 2');
      expect(doc.querySelector('[data-testid="saved-result"] [data-toc-id="ac"]')?.textContent).toContain('会话小节');
      expect(doc.body.textContent).toContain('整理后的正文 a');
      const savedElement = doc.querySelector('[data-testid="saved-result"]')!;
      await act(async () => [...savedElement.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => button.textContent === '生词')!.click()); await settle();
      expect(savedElement.textContent).toContain('保存的生词独立讲解');
      await act(async () => [...savedElement.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => button.textContent === '知识点与讲解')!.click()); await settle();
      expect(savedElement.querySelector('[data-field="textbookExplanation"]')?.textContent).toContain('原书说明');
      expect(savedElement.querySelector('[data-field="aiExplanation"]')?.textContent).toContain('模型补充说明');
      const previous = doc.querySelector<HTMLDetailsElement>('[data-testid="history-interaction"]')!;
      await act(async () => { previous.open = true; previous.dispatchEvent(new dom!.dom.window.Event('toggle')); });
      await act(async () => [...previous.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => button.textContent === '工具')!.click()); await settle();
      const candidate = [...previous.querySelectorAll<HTMLDetailsElement>('details')].find(item => item.querySelector('summary')?.textContent?.includes('candidate'))!;
      await act(async () => { candidate.open = true; candidate.dispatchEvent(new dom!.dom.window.Event('toggle')); }); await settle(); await settle();
      expect(candidate.textContent).toContain('模型提交候选'); expect(candidate.textContent).toContain('尚不能据此认定已保存');
      expect(candidate.querySelector('[data-toc-id="ac"]')?.textContent).toContain('整理后的正文 ac');
      await act(async () => [...doc.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '本次全部部分')!.click());
      await settle();
      expect(doc.body.textContent).toContain('Agent 会话与当前绑定');
      const detailReads = reads.filter(path => path.includes('/details/'));
      expect(detailReads.length).toBeGreaterThan(0);
      expect(detailReads.length).toBeLessThan(10);
      const history = doc.querySelector<HTMLDetailsElement>('[data-testid="history-interaction"]')!;
      await act(async () => { history.open = true; history.dispatchEvent(new dom!.dom.window.Event('toggle')); });
      expect(history.open).toBe(true);
      const close = [...doc.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Close')!;
      await act(async () => close.click()); await settle();
      expect(doc.querySelector('[role="dialog"]')).toBeNull();
      await act(async () => [...doc.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '重开监视')!.click());
      await settle();
      expect(doc.querySelector<HTMLDetailsElement>('[data-testid="history-interaction"]')?.open).toBe(false);
      expect(doc.body.textContent).toContain('当前正文');
    } finally { waiting.resolve(); await running; }
  });
});
