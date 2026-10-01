import { expect, it } from 'bun:test';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Hono } from 'hono';
import { DEFAULT_TEXTBOOK_PIPELINE_SETTINGS, TextbookASTSchema } from '@study-studio/document-model';
import { DrizzleLearnerRepository } from '../../../../../gateway/src/infrastructure/drizzle-learner-repository.js';
import { createPdfImportRoutes } from '../../../../../gateway/src/modules/library/http/pdf-import-routes.js';
import { createLibraryRoutes } from '../../../../../gateway/src/modules/library/http/library-routes.js';
import type { GatewayDeps } from '../../../../../gateway/src/composition/gateway-deps.js';
import { LibraryLessonCommitTool } from '../../../../../gateway/src/modules/library/tools/library-lesson-commit-tool.js';
import { TextbookPipelineJobRegistry } from '../../../../../gateway/src/modules/library/application/pipeline-job-runner.js';
import { fixturePdf, fixturePng, pipelineModel } from '../../../../../gateway/src/modules/library/__tests__/textbook-pipeline-fixtures.js';
import { pinProcessToTestRuntime } from '../../../../../gateway/src/modules/library/__tests__/pdf-test-runtime.js';
import { act, setupDom } from '../../toc/__tests__/dom-setup.js';

it('桌面解析选择与资源配置 → Gateway → MinerU V1 HTTP → 工具 → SQLite → 运行监视，已完成章不再解析', async () => {
  if (process.env.LINGUA_MINERU_DOM_CHILD !== '1') {
    const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], { env: { ...process.env, LINGUA_MINERU_DOM_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe' });
    const [exit, output] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect({ exit, output: exit ? output : '' }).toEqual({ exit: 0, output: '' }); return;
  }
  pinProcessToTestRuntime();
  const dom = await setupDom(true), originalFetch = globalThis.fetch;
  const repo = new DrizzleLearnerRepository(':memory:'), registry = new TextbookPipelineJobRegistry();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  let parsed = 0;
  const service = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    expect(request.headers.get('Authorization')).toBeNull();
    const path = new URL(request.url).pathname;
    if (path === '/v1/health') return Response.json({ features: { output_formats: ['structured_content'] } });
    if (path === '/v1/uploads') { expect(await request.json()).toMatchObject({ filename: 'chapter.pdf', purpose: 'parse' }); return Response.json({ id: 'upload', status: 'completed', file: { id: 'input' } }); }
    if (path === '/v1/parse/jobs') {
      expect(await request.json()).toMatchObject({ tier: 'standard', output_formats: ['structured_content'] }); parsed++;
      return Response.json({ job_id: 'local-task', status: 'completed', files: [{ status: 'completed', output_files: { structured_content: { file_id: 'output' } } }] });
    }
    if (path === '/v1/files/output/content') return Response.json({ pages: [{ page_idx: 0, blocks: [{ type: 'table', content: '<table><tr><td>词甲</td><td>释义甲</td></tr></table>' }] }] });
    return new Response(null, { status: 404 });
  } });
  const priorLocalToken = process.env.MINERU_LOCAL_TOKEN; delete process.env.MINERU_LOCAL_TOKEN;
  const tool = new LibraryLessonCommitTool(repo), model = pipelineModel(tool);
  // 只运行文库与导入路由；模型/工具/PDF 由正式注入点提供，其他 GatewayServer 能力不访问。
  const deps = { repo, server: { pipelineJobs: registry } as GatewayDeps['server'], port: 0 };
  const pdfRoutes = createPdfImportRoutes(deps, { adapter: model.adapter, submissionTool: tool, loadInspector: async () => ({
    processPdf: () => ({ markdown: '', pagesNeedingOcr: [2] }), processPdfWithOcr: async () => { throw new Error('旧 OCR 不得调用'); },
    renderPdfPages: async (_pdf, pages) => pages.map(pageNumber => ({ pageNumber, png: fixturePng, width: 1, height: 1 })),
  }) });
  // 与生产相同：文档按 ID 的通配路由先注册，配置接口仍必须可达。
  const app = new Hono().route('/', createLibraryRoutes(deps)).route('/', pdfRoutes);
  const configResponse = await app.request('/api/documents/desktop-owner/textbook-parsers/config');
  expect(configResponse.status).toBe(200);
  expect(await configResponse.json()).toEqual({ cloudTokenConfigured: !!(process.env.MINERU_TOKEN ?? '').trim().replace(/^Bearer\s+/i, '') });
  const reads: string[] = [], submitted: unknown[] = [];
  globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.origin === service.url.origin) return originalFetch(input, init);
    if (url.pathname === '/api/agent/models') return Response.json({ models: [] });
    reads.push(url.pathname);
    if (url.pathname.endsWith('/textbook-pipeline-jobs') && init?.body) submitted.push(JSON.parse(String(init.body)));
    return app.request(url.pathname + url.search, init);
  }, { preconnect: originalFetch.preconnect });
  try {
    const { usePreferencesStore } = await import('../../../stores/usePreferencesStore.js');
    const { useStartPipelineJobMutation } = await import('../../../queries/pipeline-jobs.js');
    const { TextbookExtractionSettings } = await import('../TextbookExtractionSettings.js');
    const { TextbookImportMonitor } = await import('../monitor/TextbookImportMonitor.js');
    usePreferencesStore.setState({ pipelineSettings: DEFAULT_TEXTBOOK_PIPELINE_SETTINGS, pipelineModel: 'user-model', pipelineEffort: 'low', pipelinePoolSize: '1' });
    const pdfBase64 = Buffer.from(await fixturePdf(2)).toString('base64');
    function Harness() {
      const start = useStartPipelineJobMutation('desktop-owner'), runs = React.useRef(0);
      const [monitorOpen, setMonitorOpen] = React.useState(false);
      return <><TextbookExtractionSettings forceOverwrite={false} onForceOverwrite={() => {}} pending={start.isPending} onStart={() => {
        const preference = usePreferencesStore.getState();
        start.mutate({ ...preference.pipelineSettings, poolSize: 1, model: preference.pipelineModel, effort: preference.pipelineEffort,
          documentId: 'desktop-book', traceId: runs.current++ ? 'desktop-repeat' : 'desktop-trace', title: '桌面贯通教材', pdfBase64,
          tocEntries: [{ id: 'part', title: '当前章节', level: 'lesson', startPage: 2, endPage: 2, sortOrder: 0 }] });
      }} /><button onClick={() => setMonitorOpen(true)}>查看本次运行</button><TextbookImportMonitor open={monitorOpen} onOpenChange={setMonitorOpen} userId="desktop-owner" traceId="desktop-trace" /></>;
    }
    async function until(check: () => boolean) { for (let attempt = 0; attempt < 160; attempt++) { if (check()) return; await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); } throw new Error('桌面贯通状态没有更新'); }
    await act(async () => { dom.root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>); });
    await until(() => reads.some(path => path.endsWith('/textbook-parsers/config')));
    const doc = dom.dom.window.document;
    await act(async () => doc.querySelector<HTMLButtonElement>('[aria-label="扫描正文解析方式"]')!.click());
    await until(() => !![...doc.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent?.includes('本地部署')));
    const localOption = [...doc.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent?.includes('本地部署'))!;
    await act(async () => localOption.focus());
    await act(async () => localOption.click());
    await until(() => !!doc.querySelector('[aria-label="本地 MinerU 服务地址"]'));
    const address = doc.querySelector<HTMLInputElement>('[aria-label="本地 MinerU 服务地址"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(dom.dom.window.HTMLInputElement.prototype, 'value')!.set!.call(address, service.url.href); address.dispatchEvent(new dom.dom.window.Event('input', { bubbles: true })); });
    expect(usePreferencesStore.getState().pipelineSettings.mineruLocalUrl).toBe(service.url.href);
    await act(async () => { usePreferencesStore.getState().setPipelineSettings({ parseConcurrency: 1, parseTimeoutMs: 3000, parseRetries: 0 }); await usePreferencesStore.persist.rehydrate(); });
    expect(usePreferencesStore.getState().pipelineSettings.parserBackend).toBe('mineru-local');
    async function start() { await act(async () => [...doc.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '开始提取并保存教材')!.click()); }
    await start();
    await until(() => model.inputs.length === 1 && registry.getActive('desktop-owner') === null);
    expect(parsed).toBe(1); expect(submitted[0]).toMatchObject({ parserBackend: 'mineru-local', mineruLocalUrl: service.url.href, parseConcurrency: 1, parseTimeoutMs: 3000 });
    expect(model.created[0]?.model).toBe('user-model'); expect(model.inputs[0]?.input.attachments?.[0]?.label).toBe('原书 PDF 第 2 页');
    const saved = await repo.getDocumentById('desktop-book'); if (!saved.ok || !saved.value?.astJson) throw new Error('教材未保存');
    const ast = TextbookASTSchema.parse(JSON.parse(saved.value.astJson));
    expect(ast.lessons[0]?.content?.vocabularies[0]?.sourceRefs).toEqual([{ blockId: 'p2b0', page: 2 }]);
    await act(async () => [...doc.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '查看本次运行')!.click());
    await until(() => !!doc.querySelector('[data-testid="model-process"]'));
    expect(doc.querySelector('[data-testid="parse-timeline"]')).toBeNull();
    expect(doc.body.textContent).not.toContain('parse_submitted');
    await act(async () => [...doc.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => button.textContent === '解析结果')!.click());
    await until(() => !!doc.querySelector('[data-testid="chapter-source"]'));
    expect(doc.querySelector('[data-testid="chapter-source"]')?.textContent).toContain('词甲');
    await act(async () => [...doc.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '当前章节')!.click());
    await act(async () => [...doc.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => button.textContent === '保存结果')!.click());
    await act(async () => [...doc.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '查询数据库当前保存内容')!.click());
    await until(() => !!doc.querySelector('[data-testid="saved-result"]'));
    expect(doc.querySelector('[data-testid="saved-result"]')?.textContent).toContain('原书来源定位');
    expect(doc.querySelector('[data-testid="saved-result"]')?.textContent).toContain('p2b0');
    await act(async () => [...doc.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Close')!.click());
    await start(); await until(() => submitted.length === 2 && registry.getActive('desktop-owner') === null);
    expect(parsed).toBe(1); expect(model.inputs).toHaveLength(1);
    expect(JSON.stringify(submitted)).not.toContain('Token');
  } finally {
    await registry.shutdown(); globalThis.fetch = originalFetch;
    if (priorLocalToken === undefined) delete process.env.MINERU_LOCAL_TOKEN; else process.env.MINERU_LOCAL_TOKEN = priorLocalToken;
    await act(async () => { dom.root.unmount(); await new Promise(resolve => setTimeout(resolve, 30)); });
    client.clear(); dom.teardown(); repo.getRawDb().close(); await service.stop(true);
  }
}, 30000);
