import { afterEach, describe, expect, it } from 'bun:test';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TextbookASTSchema } from '@study-studio/document-model';
import { convertAstToTextbookBook } from '../../textbook-converter.js';
import { DrizzleLearnerRepository } from '../../../../../../gateway/src/infrastructure/drizzle-learner-repository.js';
import { TextbookContentTools } from '../../../../../../gateway/src/modules/library/tools/textbook-content-tools.js';
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
    const currentRepo = repo, tool = new TextbookContentTools(repo), waiting = deferred(), reached = deferred();
    const model = pipelineModel(tool, async ({ input, submit, sessionId, turnId }) => {
      const value = submissionFromPrompt(input.message);

      if (input.message.includes('章节: 当前部分')) { reached.resolve(); await waiting.promise; }
      else {
        const bad = await submit({items:[{text:''}]});
        expect(bad.ok).toBe(false);
      }
      expect((await submit(value)).ok).toBe(true);
    });
    const create = model.adapter.createSession;
    model.adapter.createSession = async options => {
      const created = await create(options); if (!created.ok) return created;
      const send = created.value.send.bind(created.value);
      created.value.send = async function* (input) {
        yield { type: 'RUNTIME_RETRY', code: 'E_ENGINE_BUSY', message: '受控引擎繁忙，当前轮次继续重试', category: 'AGENT_RUNTIME' };
        yield* send(input);
      };
      return created;
    };
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
      expect(book.lessons[0]?.kind).toBe('section'); expect(book.lessons[0]?.learningContent?.articles).toHaveLength(1);
      const recorded = await currentRepo.listImportEvents({ userId: 'owner', traceId: 'desktop-trace' });
      if (!recorded.ok) throw recorded.error;
      const historyInput = recorded.value.find(event => event.nodeId === 'a' && event.category === 'model' && event.name === 'input')!;
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
      expect(doc.body.textContent).toContain('最近一轮交互');
      expect(doc.querySelector('[data-testid="parse-timeline"]')).toBeNull();
      expect(doc.body.textContent).not.toContain('parse_submitted');
      expect(doc.body.textContent).not.toContain('目录已随本轮输入发送');
      expect(doc.body.textContent).toContain('本 Worker 会复用线程');
      expect(doc.querySelector<HTMLDetailsElement>('[data-testid="current-interaction"]')?.open).toBe(true);
      expect(doc.body.textContent).toContain('引擎内部重试（本轮尚未结束）');
      for (let attempt = 0; attempt < 20 && !doc.body.textContent?.includes('受控引擎繁忙'); attempt++) await settle();
      expect(doc.body.textContent).toContain('受控引擎繁忙');
      expect(doc.body.textContent).toContain('不刷新模型输出等待期限');
      expect(doc.querySelector<HTMLDetailsElement>('[data-testid="history-interaction"]')?.open).toBe(false);
      expect(doc.body.textContent).toContain('当前正文');
      expect(reads.some(path => path.endsWith('/details/' + historyInput.sequence))).toBe(false);
      await act(async () => [...doc.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '已保存部分')!.click());
      await settle();
      await act(async () => [...doc.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => button.textContent === '保存结果')!.click());
      await settle();
      await act(async () => [...doc.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '查询数据库当前保存内容')!.click());
      await settle(); await settle();
      expect(doc.body.textContent).toContain('当前版本');
      expect(doc.querySelector('[data-testid="saved-result"]')?.textContent).toContain('整理后的正文 已保存部分');
      await act(async () => [...doc.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => button.textContent === '模型过程')!.click()); await settle();
      const recent = doc.querySelector<HTMLDetailsElement>('[data-testid="current-interaction"]')!;
      await act(async () => { recent.open = false; recent.dispatchEvent(new dom!.dom.window.Event('toggle')); });
      await act(async () => [...doc.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '刷新记录')!.click()); await settle(); await settle();
      expect(doc.querySelector<HTMLButtonElement>('nav [aria-pressed="true"]')?.textContent).toBe('已保存部分');
      expect(recent.open).toBe(false);
      await act(async () => { recent.open = true; recent.dispatchEvent(new dom!.dom.window.Event('toggle')); }); await settle();
      expect(recent.textContent).toContain('工具');
      await act(async () => [...doc.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '当前部分')!.click()); await settle();
      const outer = doc.querySelector<HTMLDetailsElement>('[data-testid="worker-context-history"]')!;
      expect(outer.open).toBe(false);
      const history = outer.querySelector<HTMLDetailsElement>('[data-testid="history-interaction"]')!;
      expect(history.open).toBe(false);
      await act(async () => { outer.open = true; outer.dispatchEvent(new dom!.dom.window.Event('toggle')); history.open = true; history.dispatchEvent(new dom!.dom.window.Event('toggle')); }); await settle(); await settle();
      expect(history.textContent).toContain('历史正文');
      const detailReads = reads.filter(path => path.includes('/details/'));
      expect(detailReads.length).toBeGreaterThan(0);
      expect(detailReads.length).toBeLessThan(25);
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
