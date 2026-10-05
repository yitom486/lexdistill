import { expect, it } from 'bun:test';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { TextbookPipelineJobRegistry } from '../application/pipeline-job-runner.js';
import { requiredContent } from './textbook-pipeline-fixtures.js';
import { harnessInjection, stubPoolDriver, type ChapterScript } from './agentpool-pipeline-harness.js';
import type { McpChapterScope } from '../mcp/textbook-mcp-scope.js';
import { deferred } from './textbook-pipeline-fixtures.js';

let rpcSeq = 0;
async function submitScope(scope: McpChapterScope, kind: 'grammar' | 'vocabulary' | 'exercises' | 'articles', raw: unknown) {
  const result = await scope.submission.execute(kind, raw, `job-${++rpcSeq}`);
  if (!result.ok) throw result.error;
}

it('后台任务防重与阶段广播对应实际 SQLite 提交，取消后关闭会话且当前轮次暂存内容不落库', async () => {
  const repo = new DrizzleLearnerRepository(':memory:');
  const registry = new TextbookPipelineJobRegistry();
  const saved = deferred(), release = deferred();
  const driver = stubPoolDriver();
  const cancels: number[] = [];
  const rawCancel = driver.cancel.bind(driver);
  driver.cancel = (lease) => { cancels.push(lease.agentIndex); rawCancel(lease); };
  let closes = 0;
  const rawClose = driver.close.bind(driver);
  driver.close = (async (drain?: boolean) => { closes++; return rawClose(drain); }) as typeof driver.close;
  const harness = harnessInjection(repo, new Map<string, ChapterScript>([['l1', async (scope) => {
    const bad = await scope.submission.execute('articles', { items: [{ text: '' }] }, 'job-bad');
    expect(bad.ok).toBe(false);
    await submitScope(scope, 'articles', { items: [{ text: '第一章正文' }] });
    for (const kind of ['grammar', 'vocabulary', 'exercises'] as const) {
      await submitScope(scope, kind, requiredContent[kind]);
    }
    saved.resolve();
    await release.promise;
  }]]), driver);
  const input = {
    userId: 'owner', documentId: 'job-book', title: '后台集成教材', poolSize: 1,
    tocEntries: [{ id: 'l1', title: '第一章', level: 'lesson' as const, startPage: 1 }],
    lessonJobs: [{ lessonId: 'l1', text: '第一章内容' }],
    ...harness.extra,
  };
  let unsubscribe: (() => void) | undefined;
  try {
    const start = registry.start(repo, input);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const duplicate = registry.start(repo, input);
    expect(duplicate.ok && duplicate.value.jobId).toBe(start.value.jobId);
    const stages: string[] = [];
    unsubscribe = registry.subscribe(start.value.jobId, snapshot => {
      if (snapshot.currentStage) stages.push(snapshot.currentStage);
    });
    await saved.promise;
    expect(registry.getActive('owner')?.jobId).toBe(start.value.jobId);
    expect(registry.get(start.value.jobId)?.successfulLessons).toBe(0);
    expect(harness.driver.asks).toHaveLength(0);
    expect(stages).not.toContain('saving'); expect(stages).toContain('extracting');
    const stats = await repo.getTextbookAssetStats('job-book');
    expect(stats.ok && stats.value.readyLessons).toBe(0); expect(stats.ok && stats.value.lines).toBe(0);
    const cancelled = registry.cancel(start.value.jobId);
    expect(cancelled.ok && cancelled.value.status).toBe('cancelled');
    release.resolve();
    await registry.shutdown();
    expect(cancels.length).toBeGreaterThan(0);
    expect(driver.finishes).toHaveLength(1);
    expect(closes).toBe(1);
    expect(registry.get(start.value.jobId)?.status).toBe('cancelled');
    expect(repo.getRawDb().query('SELECT count(*) AS n FROM textbook_articles').get()).toEqual({ n: 0 });
  } finally {
    unsubscribe?.(); release.resolve(); await registry.shutdown(); repo.getRawDb().close();
  }
});
