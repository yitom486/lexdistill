import { afterEach, describe, expect, it } from 'bun:test';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { runAgentpoolChapters } from '../application/agentpool-textbook-runner.js';
import { harnessInjection, stubPoolDriver, type ChapterScript } from './agentpool-pipeline-harness.js';
import { requiredContent } from './textbook-pipeline-fixtures.js';
import type { McpChapterScope } from '../mcp/textbook-mcp-scope.js';
import type { LessonExtractionJob } from '../application/lesson-batch-extractor.js';
import type { BusinessError } from '@lexdistill/shared';

const repos: DrizzleLearnerRepository[] = [];
afterEach(() => { for (const repo of repos.splice(0)) repo.getRawDb().close(); });

let rpcSeq = 0;
async function submitRequiredScope(scope: McpChapterScope) {
  for (const kind of ['grammar', 'vocabulary', 'exercises'] as const) {
    const result = await scope.submission.execute(kind, requiredContent[kind], `iso-${++rpcSeq}`);
    if (!result.ok) throw result.error;
  }
}

function chapterJobs(): LessonExtractionJob[] {
  return [
    { documentId: 'book', lessonId: 'a', text: '甲', title: '甲', language: 'ja', allowAiExercises: true, tocEntries: [], tocPath: [] },
    { documentId: 'book', lessonId: 'b', text: '乙', title: '乙', language: 'ja', allowAiExercises: true, tocEntries: [], tocPath: [] },
  ];
}

describe('agentpool 失败隔离与关闭', () => {
  it('一个 Worker 拿不到租约：存活 Worker 接走全部章节，无人认领才记失败，关闭正常', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    await repo.seedTextbookTocSkeleton({
      documentId: 'book', userId: 'owner', title: '隔离', language: 'ja',
      entries: [{ id: 'a', title: '甲', level: 'lesson', startPage: 1 }, { id: 'b', title: '乙', level: 'lesson', startPage: 2 }],
    });
    const scripts = new Map<string, ChapterScript>([
      ['a', async (scope) => { await submitRequiredScope(scope); }],
      ['b', async (scope) => { await submitRequiredScope(scope); }],
    ]);
    let calls = 0;
    const driver = stubPoolDriver({
      acquire: (async () => {
        if (++calls > 1) throw new Error('lease unavailable');
        return { agentIndex: 0 };
      }) as never,
    });
    const harness = harnessInjection(repo, scripts, driver);
    const failed: string[] = [];
    const saved: string[] = [];
    const controller = new AbortController();
    const outcome = await runAgentpoolChapters({
      registry: harness.registry,
      gatewayBaseUrl: 'http://127.0.0.1:1',
      userId: 'owner',
      documentId: 'book',
      jobs: chapterJobs(),
      poolSize: 2,
      workingDirectory: process.cwd(),
      allowAiExercises: true,
      firstResponseTimeoutMs: 1000,
      stallTimeoutMs: 1000,
      wallTimeoutMs: 1000,
      modelRetries: 0,
      storageRetries: 0,
      signal: controller.signal,
      emit: () => undefined,
      fail: (lessonId: string) => { failed.push(lessonId); },
      markSaved: (lessonId: string) => { saved.push(lessonId); },
      driver,
      ...(harness.extra.onChapterScope ? { onChapterScope: harness.extra.onChapterScope } : {}),
    });
    expect(failed).toEqual([]);
    expect(saved).toEqual(['a', 'b']);
    expect(outcome.driverCloseFailed).toBe(false);
    expect(driver.finishes).toHaveLength(1);
  });

  it('持续活动也逃不过墙钟上限：超时记失败，Worker 照常领下一章', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    await repo.seedTextbookTocSkeleton({
      documentId: 'book', userId: 'owner', title: '墙钟', language: 'ja',
      entries: [{ id: 'a', title: '甲', level: 'lesson', startPage: 1 }, { id: 'b', title: '乙', level: 'lesson', startPage: 2 }],
    });
    // ask 永不返回，drain 永远有活动：模拟空转刷屏，stall 永远等不到。
    const driver = stubPoolDriver({
      ask: (async () => new Promise<never>(() => undefined)) as never,
      drainEvents: (() => [{ kind: 'activity', turnId: 'busy-turn', atMs: Date.now() }]) as never,
    });
    const failed: BusinessError[] = [];
    const saved: string[] = [];
    const controller = new AbortController();
    const outcome = await runAgentpoolChapters({
      registry: harnessInjection(repo).registry,
      gatewayBaseUrl: 'http://127.0.0.1:1',
      userId: 'owner',
      documentId: 'book',
      jobs: chapterJobs(),
      poolSize: 1,
      workingDirectory: process.cwd(),
      allowAiExercises: true,
      firstResponseTimeoutMs: 30_000,
      stallTimeoutMs: 30_000,
      wallTimeoutMs: 120,
      modelRetries: 0,
      storageRetries: 0,
      signal: controller.signal,
      emit: () => undefined,
      fail: (lessonId: string, error: BusinessError) => { failed.push(error); void lessonId; },
      markSaved: (lessonId: string) => { saved.push(lessonId); },
      driver,
    });
    expect(saved).toEqual([]);
    expect(failed.map(error => error.code)).toEqual(['E_AGENT_WALL_TIMEOUT', 'E_AGENT_WALL_TIMEOUT']);
    expect(outcome.driverCloseFailed).toBe(false);
    expect(driver.finishes).toHaveLength(1);
  });

  it('池关闭失败会上报且不抛，调用方据此保留临时文件', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    await repo.seedTextbookTocSkeleton({
      documentId: 'book', userId: 'owner', title: '关闭', language: 'ja',
      entries: [{ id: 'a', title: '甲', level: 'lesson', startPage: 1 }],
    });
    const scripts = new Map<string, ChapterScript>([['a', async (scope) => { await submitRequiredScope(scope); }]]);
    const driver = stubPoolDriver();
    const rawClose = driver.close.bind(driver);
    let closeCalls = 0;
    driver.close = (async () => {
      closeCalls++;
      await rawClose();
      return { closeErrors: ['worker 0 close failed'], panickedWorkers: 0 };
    }) as typeof driver.close;
    const harness = harnessInjection(repo, scripts, driver);
    const failed: BusinessError[] = [];
    const controller = new AbortController();
    const outcome = await runAgentpoolChapters({
      registry: harness.registry,
      gatewayBaseUrl: 'http://127.0.0.1:1',
      userId: 'owner',
      documentId: 'book',
      jobs: chapterJobs().slice(0, 1),
      poolSize: 1,
      workingDirectory: process.cwd(),
      allowAiExercises: true,
      firstResponseTimeoutMs: 1000,
      stallTimeoutMs: 1000,
      wallTimeoutMs: 1000,
      modelRetries: 0,
      storageRetries: 0,
      signal: controller.signal,
      emit: () => undefined,
      fail: (lessonId: string, error: BusinessError) => { failed.push(error); void lessonId; },
      markSaved: () => undefined,
      driver,
      ...(harness.extra.onChapterScope ? { onChapterScope: harness.extra.onChapterScope } : {}),
    });
    expect(closeCalls).toBe(1);
    expect(outcome.driverCloseFailed).toBe(true);
    expect(failed).toHaveLength(0);
  });
});
