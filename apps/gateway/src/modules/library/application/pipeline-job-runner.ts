import {
  BusinessError,
  err,
  generateId,
  isOk,
  logger,
  ok,
  type Result,
} from '@study-studio/shared';
import type {
  TextbookPipelineJobSnapshot,
} from '@study-studio/protocol';
import type { ContentRepository } from '../ports.js';
import {
  executeTextbookPipeline,
  type TextbookPipelineInput,
} from './textbook-pipeline.js';

export interface StartPipelineJobInput extends TextbookPipelineInput {
  model?: string | undefined;
  poolSize?: number | undefined;
}

interface RunningPipelineJob {
  snapshot: TextbookPipelineJobSnapshot;
  controller: AbortController;
  promise: Promise<void>;
  listeners: Set<(snapshot: TextbookPipelineJobSnapshot) => void>;
}

/**
 * AI-Native 教材整书流水线提炼任务注册表（进程内单例与事件流管理）。
 *
 * 核心架构特性：
 * 1. 任务与 HTTP 请求完全解耦：启动时秒级返回 202 + jobId，后台并发执行；
 * 2. 同教材单例防重：防止用户重复多次点击导致重复建任务抢占算力；
 * 3. 广播发布/订阅池 (Pub/Sub)：支持向多个 SSE 客户端并发推送事件（断线重连/多标签同步）；
 * 4. 可中断取消机制：通过 AbortController 安全收尾。
 */
export class TextbookPipelineJobRegistry {
  private readonly jobs = new Map<string, RunningPipelineJob>();

  public start(
    repo: ContentRepository,
    input: StartPipelineJobInput
  ): Result<TextbookPipelineJobSnapshot, BusinessError> {
    // 0. 防重复提交：若同文档已有正在运行的任务，直接返回该任务快照
    if (input.documentId) {
      for (const job of this.jobs.values()) {
        if (
          job.snapshot.documentId === input.documentId &&
          job.snapshot.userId === input.userId &&
          job.snapshot.status === 'running'
        ) {
          return ok({ ...job.snapshot, failedLessons: [...job.snapshot.failedLessons] });
        }
      }
    }

    const jobId = generateId('pipejob');
    const now = new Date().toISOString();
    const documentId = input.documentId ?? generateId('doc_tb');
    const totalLessons = input.tocEntries.length;

    const snapshot: TextbookPipelineJobSnapshot = {
      jobId,
      userId: input.userId,
      documentId,
      title: input.title,
      status: 'running',
      totalLessons,
      doneLessons: 0,
      successfulLessons: 0,
      failedLessons: [],
      ...(input.poolSize ? { concurrency: input.poolSize } : {}),
      ...(input.model ? { model: input.model } : {}),
      startedAt: now,
    };

    const controller = new AbortController();
    const listeners = new Set<(s: TextbookPipelineJobSnapshot) => void>();

    const running: RunningPipelineJob = {
      snapshot,
      controller,
      listeners,
      promise: this.runPipeline(repo, snapshot, controller.signal, {
        ...input,
        documentId,
      }),
    };

    this.jobs.set(jobId, running);
    void running.promise.catch(() => {});

    return ok({ ...snapshot, failedLessons: [] });
  }

  public get(jobId: string): TextbookPipelineJobSnapshot | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    return { ...job.snapshot, failedLessons: [...job.snapshot.failedLessons] };
  }

  public getActive(userId: string): TextbookPipelineJobSnapshot | null {
    for (const job of this.jobs.values()) {
      if (job.snapshot.userId === userId && job.snapshot.status === 'running') {
        return { ...job.snapshot, failedLessons: [...job.snapshot.failedLessons] };
      }
    }
    return null;
  }

  public cancel(jobId: string): Result<TextbookPipelineJobSnapshot, BusinessError> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return err(new BusinessError('E_NOT_FOUND', '未找到指定的提炼任务', 'LEARNER_STATE'));
    }
    if (job.snapshot.status !== 'running') {
      return ok({ ...job.snapshot, failedLessons: [...job.snapshot.failedLessons] });
    }
    job.controller.abort();
    job.snapshot.status = 'cancelled';
    job.snapshot.finishedAt = new Date().toISOString();
    this.broadcast(jobId);
    return ok({ ...job.snapshot, failedLessons: [...job.snapshot.failedLessons] });
  }

  public subscribe(
    jobId: string,
    listener: (snapshot: TextbookPipelineJobSnapshot) => void
  ): () => void {
    const job = this.jobs.get(jobId);
    if (!job) {
      return () => {};
    }
    job.listeners.add(listener);
    // 订阅挂载时立即投递当前内存快照
    listener({ ...job.snapshot, failedLessons: [...job.snapshot.failedLessons] });
    return () => {
      job.listeners.delete(listener);
    };
  }

  private broadcast(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    const copy = { ...job.snapshot, failedLessons: [...job.snapshot.failedLessons] };
    for (const listener of job.listeners) {
      try {
        listener(copy);
      } catch (err) {
        logger.debug('[TextbookPipelineJobRegistry] SSE listener dispatch error:', err);
      }
    }
  }

  private async runPipeline(
    repo: ContentRepository,
    snapshot: TextbookPipelineJobSnapshot,
    signal: AbortSignal,
    input: TextbookPipelineInput
  ): Promise<void> {
    logger.info('[TextbookPipelineJobRegistry] 开始后台并发执行流水线任务', {
      jobId: snapshot.jobId,
      documentId: snapshot.documentId,
      title: snapshot.title,
    });

    try {
      const pipelineRes = await executeTextbookPipeline(repo, {
        ...input,
        signal,
        onProgress: (prog) => {
          if (signal.aborted) return;
          snapshot.doneLessons = prog.completedCount;
          snapshot.currentLessonId = prog.lessonId;
          const currentEntry = input.tocEntries.find((e) => e.id === prog.lessonId);
          snapshot.currentLessonTitle = currentEntry?.title ?? prog.lessonId;
          snapshot.successfulLessons = prog.completedCount;
          this.broadcast(snapshot.jobId);
        },
      });

      if (signal.aborted) {
        snapshot.status = 'cancelled';
        snapshot.finishedAt = new Date().toISOString();
        this.broadcast(snapshot.jobId);
        return;
      }

      if (isOk(pipelineRes)) {
        snapshot.status = pipelineRes.value.allLessonsReady ? 'done' : 'failed';
        snapshot.doneLessons = pipelineRes.value.lessonCount;
        snapshot.successfulLessons = pipelineRes.value.successfulLessons;
        snapshot.failedLessons = pipelineRes.value.errors.map((e) => ({
          lessonId: e.lessonId,
          title: input.tocEntries.find((te) => te.id === e.lessonId)?.title ?? e.lessonId,
          error: e.error,
        }));
        snapshot.finishedAt = new Date().toISOString();
        logger.info('[TextbookPipelineJobRegistry] 任务完成', {
          jobId: snapshot.jobId,
          successfulLessons: snapshot.successfulLessons,
          status: snapshot.status,
        });
      } else {
        snapshot.status = 'failed';
        snapshot.error = pipelineRes.error.userMessage;
        snapshot.finishedAt = new Date().toISOString();
        logger.warn('[TextbookPipelineJobRegistry] 流水线执行失败', {
          jobId: snapshot.jobId,
          error: pipelineRes.error.userMessage,
        });
      }
      this.broadcast(snapshot.jobId);
    } catch (cause) {
      if (signal.aborted) {
        snapshot.status = 'cancelled';
      } else {
        snapshot.status = 'failed';
        snapshot.error = cause instanceof Error ? cause.message : '流水线执行发生未预料异常';
      }
      snapshot.finishedAt = new Date().toISOString();
      this.broadcast(snapshot.jobId);
    }
  }
}
