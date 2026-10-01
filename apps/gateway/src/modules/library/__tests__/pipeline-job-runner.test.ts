import { expect, it } from 'bun:test';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { TextbookPipelineJobRegistry } from '../application/pipeline-job-runner.js';
import { TextbookContentTools } from '../tools/textbook-content-tools.js';
import { deferred, pipelineModel, submissionFromPrompt } from './textbook-pipeline-fixtures.js';

it('后台任务防重与阶段广播对应实际 SQLite 提交，取消后关闭会话并保留已保存章节', async () => {
  const repo = new DrizzleLearnerRepository(':memory:');
  const registry = new TextbookPipelineJobRegistry();
  const tool = new TextbookContentTools(repo);
  const saved = deferred(), release = deferred();
  const model = pipelineModel(tool, async ({ input, submit }) => {
    expect((await submit({ content: null })).ok).toBe(false);
    expect((await submit(submissionFromPrompt(input.message))).ok).toBe(true);
    saved.resolve();
    await release.promise;
  });
  const input = {
    userId: 'owner', documentId: 'job-book', title: '后台集成教材', poolSize: 1,
    tocEntries: [{ id: 'l1', title: '第一章', level: 'lesson' as const, startPage: 1 }],
    lessonJobs: [{ lessonId: 'l1', text: '第一章内容' }], adapter: model.adapter, submissionTool: tool,
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
    expect(registry.get(start.value.jobId)?.lessonActivities?.l1).toEqual(expect.objectContaining({ attempt: 1, nativeTurnId: 'turn:1', correctionCount: 1, engineRetryCount: 0 }));
    expect(stages).toContain('saving');
    const stats = await repo.getTextbookAssetStats('job-book');
    expect(stats.ok && stats.value.readyLessons).toBe(0); expect(stats.ok && stats.value.lines).toBe(1);
    const cancelled = registry.cancel(start.value.jobId);
    expect(cancelled.ok && cancelled.value.status).toBe('cancelled');
    release.resolve();
    await registry.shutdown();
    expect(model.interrupted).toHaveLength(1);
    expect(model.closed).toHaveLength(1);
    expect(registry.get(start.value.jobId)?.status).toBe('cancelled');
  } finally {
    unsubscribe?.(); release.resolve(); await registry.shutdown(); repo.getRawDb().close();
  }
});
