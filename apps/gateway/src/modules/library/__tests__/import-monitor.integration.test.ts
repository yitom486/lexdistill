import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ImportEventPageSchema, ImportEventSchema } from '@study-studio/document-model';
import { BusinessError, err } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { TextbookContentTools } from '../tools/textbook-content-tools.js';
import { createImportMonitorRoutes } from '../http/import-monitor-routes.js';
import { pipelineModel } from './textbook-pipeline-fixtures.js';
import { ImportMonitor } from '../application/import-monitor.js';

const repos: DrizzleLearnerRepository[] = [], dirs: string[] = [];
afterEach(async () => { for (const repo of repos.splice(0)) repo.getRawDb().close(); Bun.gc(true); for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function run(repo: DrizzleLearnerRepository, traceId = 'this-import') {
  const tool = new TextbookContentTools(repo), model = pipelineModel(tool);
  const result = await repo.executeTextbookPipeline({ userId: 'owner', traceId, documentId: 'monitored-book', title: '监视集成教材',
    tocEntries: [{ id: 'a', title: '第一部分', level: 'lesson', startPage: 7, endPage: 9 }, { id: 'b', title: '第二部分', level: 'lesson', startPage: 10, endPage: 15 }],
    lessonJobs: [{ lessonId: 'a', text: '第一部分真实输入' }, { lessonId: 'b', text: '第二部分真实输入' }],
    adapter: model.adapter, submissionTool: tool, poolSize: 2, modelRetries: 0,
  });
  return { result, model, app: createImportMonitorRoutes(repo) };
}
const base = '/api/documents/owner/textbook-imports/this-import';
describe('导入监视：实际会话工具 → SQLite 事件 → Gateway 查询与 SSE', () => {
  it('两个 Worker 的目录输入、工具、校验及事务可按任务与会话逐项对应，列表不携带大参数', async () => {
    const repo = new DrizzleLearnerRepository(':memory:'); repos.push(repo);
    const flow = await run(repo);
    expect(flow.result.ok && flow.result.value.allLessonsReady).toBe(true);
    const page = ImportEventPageSchema.parse(await (await flow.app.request(base)).json());
    expect(page.events.length).toBeGreaterThan(20);
    expect(page.events.every(event => !('detail' in event))).toBe(true);
    const bindings = page.events.filter(event => event.name === 'bound');
    expect(new Set(bindings.map(event => event.sessionId)).size).toBe(2);
    for (const binding of bindings) {
      const interactions = page.events.filter(event => event.attemptId === binding.attemptId);
      const input = interactions.find(event => event.name === 'input')!;
      const detail = ImportEventSchema.parse(await (await flow.app.request(`${base}/details/${input.sequence}`)).json());
      expect(detail.detail).toEqual(expect.objectContaining({ message: flow.model.inputs.find(turn => turn.sessionId === binding.sessionId)!.input.message }));
      expect(interactions.map(event => event.name)).toEqual(expect.arrayContaining(['requested', 'content_saved', 'committed', 'result', 'turn_ended', 'unbound']));
      const request = interactions.find(event => event.name === 'requested')!, response = interactions.find(event => event.name === 'result')!;
      expect(request.callId).toBe(response.callId);
      const saved = await flow.app.request(`/api/documents/owner/textbook-saved/monitored-book/${binding.nodeId}`);
      expect(await saved.json()).toEqual(expect.objectContaining({ status: 'ready', learningContent: expect.objectContaining({ articles: expect.any(Array) }) }));
    }
    const foreign = ImportEventPageSchema.parse(await (await flow.app.request(base.replace('/owner/', '/another/'))).json());
    expect(foreign.events).toHaveLength(0);
    expect((await flow.app.request(`${base.replace('/owner/', '/another/')}/details/${page.events[0]!.sequence}`)).status).toBe(404);
    expect((await flow.app.request('/api/documents/another/textbook-saved/monitored-book/a')).status).toBe(404);
  });
  it('游标补取和 SSE 重连只发送后续事件，数据库重开保留真实提示词', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lingua-monitor-')); dirs.push(dir);
    const repo = new DrizzleLearnerRepository(join(dir, 'test.db'));
    const flow = await run(repo), page = ImportEventPageSchema.parse(await (await flow.app.request(base)).json());
    repo.getRawDb().close();
    const reopened = new DrizzleLearnerRepository(join(dir, 'test.db')); repos.push(reopened);
    const app = createImportMonitorRoutes(reopened);
    const after = page.events.at(-2)!.sequence;
    const remaining = ImportEventPageSchema.parse(await (await app.request(`${base}?after=${after}`)).json());
    expect(remaining.events.map(event => event.sequence)).toEqual([page.cursor]);
    const controller = new AbortController();
    const response = await app.request(`${base}/events`, { headers: { 'Last-Event-ID': String(after) }, signal: controller.signal });
    const reader = response.body!.getReader();
    try { const chunk = await reader.read(); expect(new TextDecoder().decode(chunk.value)).toContain(`id: ${page.cursor}`); }
    finally { controller.abort(); await reader.cancel(); }
    const input = page.events.find(event => event.name === 'input')!;
    expect(ImportEventSchema.parse(await (await app.request(`${base}/details/${input.sequence}`)).json()).detail).toEqual(expect.objectContaining({ message: expect.stringContaining('章节:') }));
  });
  it('导入事件写入失败显式报告记录不完整，不改变成功保存的教材', async () => {
    const repo = new DrizzleLearnerRepository(':memory:'); repos.push(repo);
    const append = repo.appendImportEvent.bind(repo); let fail = true;
    repo.appendImportEvent = input => { if (fail) { fail = false; return Promise.resolve(err(new BusinessError('E_TEST_STORAGE', '模拟诊断写入失败', 'DATABASE'))); } return append(input); };
    const flow = await run(repo);
    expect(flow.result.ok && flow.result.value.allLessonsReady).toBe(true);
    const page = ImportEventPageSchema.parse(await (await flow.app.request(base)).json());
    expect(page.warning).toContain('记录不完整');
    const stats = await repo.getTextbookAssetStats('monitored-book');
    expect(stats.ok && stats.value.readyLessons).toBe(2);
  });
  it('目录创建之前允许没有教材和 job 身份，详情不会串到其他操作', async () => {
    const repo = new DrizzleLearnerRepository(':memory:'); repos.push(repo);
    const monitor = new ImportMonitor(repo, 'owner', 'directory-only');
    monitor.record('directory', 'probe_result', { fromPage: 12, toPage: 17 }); await monitor.flush();
    const result = await repo.listImportEvents({ userId: 'owner', traceId: 'directory-only' });
    expect(result.ok && result.value[0]).toEqual(expect.objectContaining({ documentId: null, jobId: null, sessionId: null }));
    expect((await repo.listImportEvents({ userId: 'owner', traceId: 'this-import' })).ok).toBe(true);
  });
});
