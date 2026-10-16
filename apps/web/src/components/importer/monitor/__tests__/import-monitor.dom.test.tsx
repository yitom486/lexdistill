import { afterEach, describe, expect, it } from 'bun:test';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TextbookASTSchema } from '@lexdistill/document-model';
import { convertAstToTextbookBook } from '../../textbook-converter.js';
import { DrizzleLearnerRepository } from '../../../../../../gateway/src/infrastructure/drizzle-learner-repository.js';
import { TextbookContentTools } from '../../../../../../gateway/src/modules/library/tools/textbook-content-tools.js';
import { createImportMonitorRoutes } from '../../../../../../gateway/src/modules/library/http/import-monitor-routes.js';
import { deferred } from '../../../../../../gateway/src/modules/library/__tests__/textbook-pipeline-fixtures.js';
import { harnessInjection, type ChapterScript } from '../../../../../../gateway/src/modules/library/__tests__/agentpool-pipeline-harness.js';
import { requiredContent } from '../../../../../../gateway/src/modules/library/__tests__/textbook-pipeline-fixtures.js';
import type { McpChapterScope } from '../../../../../../gateway/src/modules/library/mcp/textbook-mcp-scope.js';
import { act, setupDom, type DomHandle } from '../../../toc/__tests__/dom-setup.js';

let scopeRpcSeq = 0;
async function submitScope(scope: McpChapterScope, kind: 'grammar' | 'vocabulary' | 'exercises' | 'articles', raw: unknown) {
  const result = await scope.submission.execute(kind, raw, `dom-${++scopeRpcSeq}`);
  if (!result.ok) throw result.error;
}
async function submitRequiredScope(scope: McpChapterScope) {
  for (const kind of ['grammar', 'vocabulary', 'exercises'] as const) {
    await submitScope(scope, kind, requiredContent[kind]);
  }
}

let dom: DomHandle | undefined, repo: DrizzleLearnerRepository | undefined, client: QueryClient | undefined;
const originalFetch = globalThis.fetch;
afterEach(() => { dom?.teardown(); dom = undefined; client?.clear(); repo?.getRawDb().close(); repo = undefined; globalThis.fetch = originalFetch; });
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); }); }
describe('页面内运行详情：真实 Query → Gateway → SQLite', () => {
  it('当前交互展开、历史折叠；详情按需读；关闭重开保留本次记录和已保存内容', async () => {
    // Base UI 在导入时选择 DOM layout effect；隔离进程防止其他测试先在无 DOM 时缓存该模块。
    if (process.env['LINGUA_MONITOR_DOM_CHILD'] !== '1') {
      const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], { env: { ...process.env, LINGUA_MONITOR_DOM_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe' });
      const [exit, output] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      expect({ exit, output: exit ? output : '' }).toEqual({ exit: 0, output: '' });
      return;
    }
    repo = new DrizzleLearnerRepository(':memory:');
    const currentRepo = repo;
    const waiting = deferred(), reached = deferred();
    const wbadu: Array<{ lesson: string; attempt: number }> = [];
    const harness = harnessInjection(repo, new Map<string, ChapterScript>([
      ['a', async (scope) => {
        expect((await scope.submission.execute('articles', { items: [{ text: '' }] }, 'rpc-a-bad')).ok).toBe(false);
        expect((await scope.submission.execute('articles', { items: [{ text: '整理后的正文 已保存部分' }] }, 'rpc-a')).ok).toBe(true);
        await submitRequiredScope(scope);
      }],
      ['b', async (scope, job, attempt) => {
        wbadu.push({ lesson: job.lessonId, attempt });
        if (attempt === 0) return;
        expect((await scope.submission.execute('articles', { items: [{ text: '' }] }, 'rpc-b-bad')).ok).toBe(false);
        expect((await scope.submission.execute('articles', { items: [{ text: '当前正文' }] }, 'rpc-b')).ok).toBe(true);
        await submitRequiredScope(scope);
        if (job.lessonId === 'b' && attempt === 1) { reached.resolve(); await waiting.promise; }
      }],
    ]));
    const running = repo.executeTextbookPipeline({ userId: 'owner', traceId: 'desktop-trace', documentId: 'desktop-book', title: '监视教材', poolSize: 1,
      tocEntries: [{ id: 'a', level: 'section', title: '已保存部分', startPage: 5, endPage: 7 }, { id: 'ac', level: 'section', parentId: 'a', title: '会话小节', startPage: 6, endPage: 7 },
        { id: 'b', level: 'lesson', title: '当前部分', startPage: 8, endPage: 11 }],
      lessonJobs: [{ lessonId: 'a', text: '历史正文' }, { lessonId: 'b', text: '当前正文' }], ...harness.extra });
    try {
      await reached.promise;
      const document = await currentRepo.getDocumentById('desktop-book'); if (!document.ok) throw document.error;
      const book = convertAstToTextbookBook(TextbookASTSchema.parse(JSON.parse(document.value!.astJson!)));
      expect(book.lessons.map(lesson => lesson.id)).toEqual(['a', 'b']); expect(book.totalLessons).toBe(1);
      expect(book.lessons[0]?.kind).toBe('section'); expect(book.lessons[0]?.learningContent?.articles).toHaveLength(1);
      let recorded = await currentRepo.listImportEvents({ userId: 'owner', traceId: 'desktop-trace' });
      for (let attempt = 0; attempt < 30 && recorded.ok && recorded.value.filter(event => event.nodeId === 'b' && event.category === 'model' && event.name === 'input').length < 2; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 10));
        recorded = await currentRepo.listImportEvents({ userId: 'owner', traceId: 'desktop-trace' });
      }
      if (!recorded.ok) throw recorded.error;
      const historyInput = recorded.value.find(event => event.nodeId === 'b' && event.category === 'model' && event.name === 'input')!;
      const otherInput = recorded.value.find(event => event.nodeId === 'a' && event.category === 'model' && event.name === 'input')!;
      expect(historyInput.sessionId).toBe(otherInput.sessionId);
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
      expect(doc.querySelector('[role="dialog"]')).toBeNull();
      for (let attempt = 0; attempt < 30 && !doc.querySelector('[data-testid="current-interaction"]'); attempt++) await settle();
      expect(doc.body.textContent).toContain('最近一轮交互');
      expect(doc.querySelector('[data-testid="parse-timeline"]')).toBeNull();
      expect(doc.body.textContent).not.toContain('parse_submitted');
      expect(doc.body.textContent).not.toContain('目录已随本轮输入发送');
      expect(doc.body.textContent).toContain('不同 Worker 使用独立线程');
      expect(doc.querySelector<HTMLDetailsElement>('[data-testid="current-interaction"]')?.open).toBe(true);
      const historyForInput = doc.querySelector<HTMLDetailsElement>('[data-testid="history-interaction"]')!;
      expect(historyForInput.open).toBe(false);
      await act(async () => { historyForInput.open = true; historyForInput.dispatchEvent(new dom!.dom.window.Event('toggle')); }); await settle();
      for (let attempt = 0; attempt < 20 && !doc.querySelector('[data-testid="raw-model-input"]'); attempt++) await settle();
      expect(doc.querySelector<HTMLDetailsElement>('[data-testid="raw-model-input"]')?.open).toBe(false);
      for (let attempt = 0; attempt < 20 && !doc.body.textContent?.includes('应用发起新轮重试'); attempt++) await settle();
      expect(doc.body.textContent).toContain('应用发起新轮重试');
      expect(doc.querySelector<HTMLDetailsElement>('[data-testid="history-interaction"]')?.open).toBe(true);
      expect(doc.body.textContent).toContain('当前正文');
      expect(doc.body.textContent).toContain('已暂存，等待整课提交');
      expect(currentRepo.getRawDb().query('SELECT count(*) AS n FROM textbook_articles WHERE chapter_id=?').get('b')).toEqual({ n: 0 });
      expect(reads.some(path => path.endsWith('/details/' + otherInput.sequence))).toBe(false);
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
      expect(doc.querySelector('[data-testid="worker-context-history"]')).toBeNull();
      const history = doc.querySelector<HTMLDetailsElement>('[data-testid="history-interaction"]')!;
      expect(history.open).toBe(false);
      await act(async () => { history.open = true; history.dispatchEvent(new dom!.dom.window.Event('toggle')); }); await settle(); await settle();
      expect(history.textContent).toContain('当前正文');
      expect(doc.body.textContent).not.toContain('历史正文');
      const detailReads = reads.filter(path => path.includes('/details/'));
      expect(detailReads.length).toBeGreaterThan(0);
      expect(detailReads.length).toBeLessThan(25);
      const close = [...doc.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '收起详情')!;
      await act(async () => close.click()); await settle();
      expect(doc.querySelector('[role="dialog"]')).toBeNull();
      expect(doc.querySelector('[aria-label="教材导入运行详情"]')).toBeNull();
      await act(async () => [...doc.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '重开监视')!.click());
      await settle();
      expect(doc.querySelector<HTMLDetailsElement>('[data-testid="history-interaction"]')?.open).toBe(false);
      expect(doc.body.textContent).toContain('应用发起新轮重试');
      waiting.resolve(); await running;
      await act(async () => [...doc.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '刷新记录')!.click()); await settle(); await settle();
      expect(doc.body.textContent).toContain('暂存内容已随整课保存');
      expect(doc.body.textContent).not.toContain('已暂存，等待整课提交');
    } finally { waiting.resolve(); await running; }
  });
});
