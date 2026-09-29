import { describe, expect, it } from 'bun:test';
import { isOk } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { TextbookPipelineJobRegistry } from '../application/pipeline-job-runner.js';
import type { TextbookPipelineJobSnapshot } from '@study-studio/protocol';

describe('TextbookPipelineJobRegistry (流水线异步任务注册表与 SSE 广播)', () => {
  it('启动任务并支持单例防重、快照查询与取消控制', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    const registry = new TextbookPipelineJobRegistry();

    const tocEntries = [
      { id: 'l1', title: '第1课 初次见面', level: 'lesson' as const, startPage: 5, sortOrder: 1 },
      { id: 'l2', title: '第2课 这是什么', level: 'lesson' as const, startPage: 12, sortOrder: 2 },
    ];

    // 1. 启动任务
    const startRes = registry.start(repo, {
      userId: 'test_user_001',
      documentId: 'doc_tb_001',
      title: '测试教材第一册',
      tocEntries,
      lessonJobs: [
        { lessonId: 'l1', ocrText: '第1课 初次见面 わたしはワンです。', title: '第1课 初次见面' },
        { lessonId: 'l2', ocrText: '第2课 这是什么 これは本です。', title: '第2课 这是什么' },
      ],
      poolSize: 2,
    });

    expect(isOk(startRes)).toBe(true);
    if (!isOk(startRes)) return;

    const initialSnapshot = startRes.value;
    expect(initialSnapshot.status).toBe('running');
    expect(initialSnapshot.totalLessons).toBe(2);
    expect(initialSnapshot.doneLessons).toBe(0);
    expect(initialSnapshot.documentId).toBe('doc_tb_001');

    // 2. 防重测试：同文档运行中重复 start 直接返回相同快照
    const duplicateRes = registry.start(repo, {
      userId: 'test_user_001',
      documentId: 'doc_tb_001',
      title: '测试教材第一册',
      tocEntries,
    });
    expect(isOk(duplicateRes)).toBe(true);
    if (isOk(duplicateRes)) {
      expect(duplicateRes.value.jobId).toBe(initialSnapshot.jobId);
    }

    // 3. 快照查询与活跃任务查询
    const queried = registry.get(initialSnapshot.jobId);
    expect(queried).not.toBeNull();
    expect(queried?.jobId).toBe(initialSnapshot.jobId);

    const active = registry.getActive('test_user_001');
    expect(active).not.toBeNull();
    expect(active?.jobId).toBe(initialSnapshot.jobId);

    // 4. 事件订阅与广播 (Pub/Sub)
    const receivedSnapshots: TextbookPipelineJobSnapshot[] = [];
    const unsubscribe = registry.subscribe(initialSnapshot.jobId, (snap) => {
      receivedSnapshots.push(snap);
    });
    // 刚订阅时应立即收到当前快照
    expect(receivedSnapshots.length).toBeGreaterThanOrEqual(1);

    // 5. 中止取消任务
    const cancelRes = registry.cancel(initialSnapshot.jobId);
    expect(isOk(cancelRes)).toBe(true);
    if (isOk(cancelRes)) {
      expect(cancelRes.value.status).toBe('cancelled');
    }

    const cancelledSnapshot = registry.get(initialSnapshot.jobId);
    expect(cancelledSnapshot?.status).toBe('cancelled');

    unsubscribe();
  });
});
