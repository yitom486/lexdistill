import { expect, it } from 'bun:test';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_TEXTBOOK_PIPELINE_SETTINGS } from '@study-studio/document-model';
import { DrizzleLearnerRepository } from '../../../../../gateway/src/infrastructure/drizzle-learner-repository.js';
import { createPdfImportRoutes } from '../../../../../gateway/src/modules/library/http/pdf-import-routes.js';
import { TextbookContentTools } from '../../../../../gateway/src/modules/library/tools/textbook-content-tools.js';
import { TextbookPipelineJobRegistry } from '../../../../../gateway/src/modules/library/application/pipeline-job-runner.js';
import { fixturePdf, fixturePng, pipelineModel } from '../../../../../gateway/src/modules/library/__tests__/textbook-pipeline-fixtures.js';
import { act, setupDom } from '../../toc/__tests__/dom-setup.js';
import { GATEWAY_BASE_URL } from '../../../lib/api-client.js';

it('桌面默认直接读图、保留云端与本地手动选择，Query → Gateway → 图片或 OCR → 工具 → SQLite', async () => {
  if (process.env.LINGUA_LOCAL_OCR_DOM_CHILD !== '1') {
    const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_LOCAL_OCR_DOM_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    const [exit, output] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect({ exit, output: exit ? output : '' }).toEqual({ exit: 0, output: '' }); return;
  }
  const dom = await setupDom(true), originalFetch = globalThis.fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const repo = new DrizzleLearnerRepository(':memory:'), registry = new TextbookPipelineJobRegistry();
  const tool = new TextbookContentTools(repo), model = pipelineModel(tool);
  let calls = 0, renders = 0;
  const submitted: unknown[] = [];
  const app = createPdfImportRoutes({ repo, server: { pipelineJobs: registry } as never, port: 0 }, {
    adapter: model.adapter, submissionTool: tool, loadInspector: async () => ({
      processPdf: () => ({ markdown: '', pagesNeedingOcr: [1] }),
      renderPdfPages: async (_, pages) => { renders++; expect(pages).toEqual([2]); return pages.map(pageNumber => ({ pageNumber, png: fixturePng, width: 1, height: 1 })); },
      processPdfWithOcr: async (_, options) => {
        calls++; expect(options?.pageNumbers).toEqual([1]);
        return { pages: [{ pageNumber: 1, markdown: '本地识别教材内容' }] };
      },
    }),
  });
  globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    // The browser only reaches Gateway; any attempted external upload fails this test.
    expect(url.origin).toBe(new URL(GATEWAY_BASE_URL).origin);
    if (url.pathname === '/api/agent/models') return Response.json({ models: [] });
    if (url.pathname.endsWith('/textbook-pipeline-jobs') && init?.body) submitted.push(JSON.parse(String(init.body)));
    return app.request(url.pathname + url.search, init);
  }, { preconnect: originalFetch.preconnect });
  try {
    dom.dom.window.localStorage.setItem('study_studio_user_preferences', JSON.stringify({ version: 0, state: {
      theme: 'dark', pipelinePoolSize: '4', pipelineSettings: { ...DEFAULT_TEXTBOOK_PIPELINE_SETTINGS, poolSize: 4, parserBackend: 'mineru-cloud', parseRetries: 2 },
    } }));
    const { usePreferencesStore } = await import('../../../stores/usePreferencesStore.js');
    await usePreferencesStore.persist.rehydrate();
    expect(usePreferencesStore.getState().pipelineSettings.parserBackend).toBe('model-vision');
    expect(usePreferencesStore.getState().pipelinePoolSize).toBe('6');
    expect(usePreferencesStore.getState().pipelineSettings.poolSize).toBe(6);
    expect(usePreferencesStore.getState().pipelineSettings.parseRetries).toBe(2);
    expect(usePreferencesStore.getState().theme).toBe('dark');
    const { useStartPipelineJobMutation } = await import('../../../queries/pipeline-jobs.js');
    const { TextbookExtractionSettings } = await import('../TextbookExtractionSettings.js');
    const pdfBase64 = Buffer.from(await fixturePdf(2)).toString('base64');
    function Harness() {
      const start = useStartPipelineJobMutation('ocr-desktop');
      return <><TextbookExtractionSettings forceOverwrite={false} onForceOverwrite={() => {}} pending={start.isPending} onStart={() => {
        start.mutate({ ...usePreferencesStore.getState().pipelineSettings, poolSize: 1, title: 'OCR 桌面教材', forceOverwrite: true,
          documentId: 'ocr-desktop-book', pdfBase64,
          tocEntries: [{ id: 'lesson', title: '完整第一课', level: 'lesson', startPage: 2, endPage: 2, sortOrder: 0 }] });
      }} />{start.isError && <p role="alert">{start.error.message}</p>}</>;
    }
    await act(async () => dom.root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>));
    const doc = dom.dom.window.document;
    async function until(check: () => boolean) {
      for (let attempt = 0; attempt < 200; attempt++) {
        if (check()) return;
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
      }
      throw new Error(`本地 OCR 桌面状态未更新：${JSON.stringify({ submitted, calls, inputs: model.inputs.length, active: registry.getActive('ocr-desktop'), alerts: [...doc.querySelectorAll('[role="alert"]')].map(node => node.textContent) })}`);
    }
    async function choose(text: string) {
      await act(async () => doc.querySelector<HTMLButtonElement>('[aria-label="扫描正文解析方式"]')!.click());
      await until(() => !![...doc.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent === text));
      const option = [...doc.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent === text)!;
      await act(async () => option.focus()); await act(async () => option.click());
    }
    expect(doc.querySelector('[aria-label="本地 MinerU 服务地址"]')).toBeNull();
    expect(doc.querySelector('[aria-label="扫描正文解析方式"]')).toBeNull();
    await act(async () => [...doc.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.startsWith('更多设置'))!.click());
    expect(doc.body.textContent).toContain('无需 OCR 或 MinerU');
    await act(async () => [...doc.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '开始整理教材')!.click());
    await until(() => submitted.length === 1 && registry.getActive('ocr-desktop') === null && model.inputs.length === 1);
    expect(submitted[0]).toMatchObject({ parserBackend: 'model-vision' });
    expect(renders).toBe(1); expect(calls).toBe(0); expect(model.inputs[0]?.input.attachments).toHaveLength(1);
    await choose('MinerU 云端精准解析');
    await act(async () => usePreferencesStore.persist.rehydrate());
    expect(usePreferencesStore.getState().pipelineSettings.parserBackend).toBe('mineru-cloud');
    expect(doc.body.textContent).toContain('扫描章节上传到 MinerU 云端');
    await choose('本地 OCR');
    await act(async () => usePreferencesStore.persist.rehydrate());
    expect(usePreferencesStore.getState().pipelineSettings.parserBackend).toBe('local-ocr');
    await act(async () => [...doc.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '开始整理教材')!.click());
    await until(() => submitted.length === 2 && registry.getActive('ocr-desktop') === null && model.inputs.length === 2);
    expect(submitted[1]).toMatchObject({ parserBackend: 'local-ocr' });
    expect(calls).toBe(1); expect(model.inputs[1]?.input.message).toContain('本地识别教材内容');
    expect(model.inputs[1]?.input.message).toContain('- 完整第一课');
    expect(model.inputs[1]?.input.attachments).toBeUndefined();
    const assets = await repo.getTextbookAssetStats('ocr-desktop-book');
    expect(assets.ok && assets.value).toMatchObject({ readyLessons: 1, vocab: 1, grammar: 1, exercises: 1 });
  } finally {
    await registry.shutdown(); globalThis.fetch = originalFetch;
    await act(async () => dom.root.unmount()); client.clear(); dom.teardown(); repo.getRawDb().close();
  }
}, 30000);
