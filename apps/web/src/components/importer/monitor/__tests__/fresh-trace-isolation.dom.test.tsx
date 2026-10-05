import { afterEach, describe, expect, it } from 'bun:test';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DrizzleLearnerRepository } from '../../../../../../gateway/src/infrastructure/drizzle-learner-repository.js';
import { createImportMonitorRoutes } from '../../../../../../gateway/src/modules/library/http/import-monitor-routes.js';
import { ImportMonitor } from '../../../../../../gateway/src/modules/library/application/import-monitor.js';
import { act, setupDom, type DomHandle } from '../../../toc/__tests__/dom-setup.js';

let dom: DomHandle | undefined, client: QueryClient | undefined;
const originalFetch = globalThis.fetch;
afterEach(() => { dom?.teardown(); dom = undefined; client?.clear(); globalThis.fetch = originalFetch; });
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); }); }

describe('运行详情零污染：新 trace 看不到旧运行', () => {
  it('旧 trace 有记录时，新 trace 打开为空且不串章节', async () => {
    if (process.env['LINGUA_FRESH_TRACE_CHILD'] !== '1') {
      const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], { env: { ...process.env, LINGUA_FRESH_TRACE_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe' });
      const [exit, output] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      expect({ exit, output: exit ? output : '' }).toEqual({ exit: 0, output: '' });
      return;
    }
    const repo = new DrizzleLearnerRepository(':memory:');
    try {
      const monitor = new ImportMonitor(repo, 'owner', 'old-trace', { documentId: 'old-book' });
      monitor.record('task', 'started', { title: '旧书' });
      monitor.record('model', 'input', { message: '旧章节输入' }, { nodeId: 'old-lesson' });
      await monitor.flush();
      const app = createImportMonitorRoutes(repo);
      globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        return app.request(`${url.pathname}${url.search}`, init);
      }, { preconnect: originalFetch.preconnect });
      dom = await setupDom(true); client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const { TextbookImportMonitor } = await import('../TextbookImportMonitor.js');
      await act(async () => {
        dom!.root.render(<QueryClientProvider client={client!}><TextbookImportMonitor open onOpenChange={() => undefined} userId="owner" traceId="new-trace" /></QueryClientProvider>);
      });
      await settle(); await settle();
      const doc = dom.dom.window.document;
      expect(doc.body.textContent).toContain('本次没有可回溯的交互记录');
      expect(doc.body.textContent).not.toContain('旧章节输入');
      expect(doc.querySelector('[data-testid="worker-live"]')).toBeNull();
      expect(doc.querySelector('[aria-label="本次导入章节"]')).toBeNull();
    } finally {
      repo.getRawDb().close();
    }
  });
});
