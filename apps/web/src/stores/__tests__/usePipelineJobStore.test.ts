import { describe, expect, it, beforeEach } from 'bun:test';
import { usePipelineJobStore } from '../usePipelineJobStore.js';
import type { TextbookPipelineJobSnapshot } from '@study-studio/protocol';

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    length: 0,
  };
}

describe('usePipelineJobStore (流水线任务全局状态管理)', () => {
  beforeEach(() => {
    usePipelineJobStore.getState().clearActiveJob();
    usePipelineJobStore.getState().setIsWidgetMinimized(false);
    usePipelineJobStore.getState().setIsImporterModalOpen(false);
  });

  it('初始状态为空，支持设置活跃任务与最小化切换', () => {
    const state = usePipelineJobStore.getState();
    expect(state.activeJobId).toBeNull();
    expect(state.activeJob).toBeNull();
    expect(state.isWidgetMinimized).toBe(false);
    expect(state.isImporterModalOpen).toBe(false);

    const snapshot: TextbookPipelineJobSnapshot = {
      jobId: 'pipejob_test_01',
      userId: 'user_01',
      documentId: 'doc_tb_01',
      title: '大家的日语',
      status: 'running',
      totalLessons: 25,
      doneLessons: 5,
      successfulLessons: 5,
      failedLessons: [],
      concurrency: 3,
      startedAt: new Date().toISOString(),
    };

    usePipelineJobStore.getState().setActiveJob(snapshot);

    const updated = usePipelineJobStore.getState();
    expect(updated.activeJobId).toBe('pipejob_test_01');
    expect(updated.activeJob?.title).toBe('大家的日语');
    expect(updated.activeJob?.doneLessons).toBe(5);

    // 最小化与展开切换
    usePipelineJobStore.getState().toggleWidgetMinimized();
    expect(usePipelineJobStore.getState().isWidgetMinimized).toBe(true);

    usePipelineJobStore.getState().toggleWidgetMinimized();
    expect(usePipelineJobStore.getState().isWidgetMinimized).toBe(false);

    // 模态框显隐控制
    usePipelineJobStore.getState().setIsImporterModalOpen(true);
    expect(usePipelineJobStore.getState().isImporterModalOpen).toBe(true);

    // 清除状态
    usePipelineJobStore.getState().clearActiveJob();
    expect(usePipelineJobStore.getState().activeJobId).toBeNull();
    expect(usePipelineJobStore.getState().activeJob).toBeNull();
  });
});
