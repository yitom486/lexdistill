import { createHash } from 'node:crypto';
import {
  ok,
  err,
  isOk,
  type Result,
  BusinessError,
  translateToBusinessError,
  generateId,
  logger,
} from '@study-studio/shared';
import type { TocEntry } from '@study-studio/document-model';
import type {
  ContentRepository,
} from '../ports.js';
import type { ImportTask } from '@study-studio/storage-sqlite';
import {
  LessonBatchExtractor,
  type AgentPoolLike,
  type BatchExtractionProgress,
  type LessonExtractionJob,
  type BatchExtractionOptions,
} from './lesson-batch-extractor.js';
import { slicePdfLessonsWithOcr } from './pdf-import/lesson-content-slicer.js';
import type { PdfInspectorLike } from '../../../infrastructure/pdf-runtime/pdf-runtime.js';

export interface TextbookPipelineInput {
  userId: string;
  documentId?: string | undefined;
  title: string;
  language?: string | undefined;
  filename?: string | undefined;
  /** Phase 0: 目录识别结构（4 级枚举与起止页码） */
  tocEntries: readonly TocEntry[];
  /** Phase 1: 各章节待提炼的 OCR 文本切片（可选：若未提供，将通过 pdf/inspector 自动并发切片） */
  lessonJobs?: Array<{
    lessonId: string;
    ocrText: string;
    title?: string | undefined;
    startPage?: number | undefined;
    endPage?: number | undefined;
    subSections?: string[] | undefined;
  }> | undefined;
  /** PDF 原始字节（用于自动切片抽取） */
  pdf?: Uint8Array | undefined;
  /** PDF 运行时 Inspector */
  inspector?: PdfInspectorLike | undefined;
  /** OCR 并发度（默认 3） */
  ocrConcurrency?: number | undefined;
  /** 是否强制重新提炼全书（默认 false：若已为 ready 则直接跳过以保全复习记录并节约算力） */
  forceOverwrite?: boolean | undefined;
  /** 可选注入的 Worker 池（支持 AgentPool 或测试 Mock） */
  pool?: AgentPoolLike | undefined;
  poolFactory?: BatchExtractionOptions['poolFactory'];
  model?: string | undefined;
  effort?: string | undefined;
  poolSize?: number | undefined;
  /** 实时进度通知回调 */
  onProgress?: ((progress: BatchExtractionProgress) => void) | undefined;
  /** 任务终止信号 */
  signal?: AbortSignal | undefined;
}

export interface TextbookPipelineOutput {
  task: ImportTask;
  documentId: string;
  title: string;
  lessonCount: number;
  allLessonsReady: boolean;
  successfulLessons: number;
  failedLessons: number;
  errors: Array<{ lessonId: string; error: string }>;
}

/**
 * AI-Native 教材端到端导入一条龙流水线：
 * 1. 建立 document_imports 任务台账（状态 processing）；
 * 2. Phase 0 骨架优先落库（单调递增自动校验 + 生成全书 pending 槽位）；
 * 3. Phase 1&2 章节并发提炼（依托 agentpools 独占租借 Lease 与内置重试）；
 * 4. 目录白名单对齐核验（E_TOC_SLOT_NOT_FOUND 防幻觉造课）与事务原子落盘；
 * 5. 任务状态终结（更新为 done 或包含失败摘要），返回完整教材学习资产。
 */
export async function executeTextbookPipeline(
  repo: ContentRepository,
  input: TextbookPipelineInput
): Promise<Result<TextbookPipelineOutput, BusinessError>> {
  const documentId = input.documentId ?? generateId('doc_tb');
  const filename = input.filename ?? `${input.title}.pdf`;

  logger.info('[TextbookPipeline] 开始执行教材提炼一条龙流水线', {
    documentId,
    title: input.title,
    userId: input.userId,
    filename,
    hasLessonJobs: Array.isArray(input.lessonJobs) && input.lessonJobs.length > 0,
    forceOverwrite: input.forceOverwrite,
  });

  // 1. 创建导入任务记录（台账状态 processing）
  const taskCreated = await repo.createImportTask({
    userId: input.userId,
    sourceKind: 'pdf',
    filename,
  });
  if (!isOk(taskCreated)) {
    logger.error('[TextbookPipeline] 创建导入任务台账记录失败', {
      documentId,
      error: taskCreated.error.userMessage,
    });
    return taskCreated;
  }
  const task = taskCreated.value;

  try {
    // 2. Phase 0: 目录识别并优先建立骨架槽位（严格单调递增自动校验门禁）
    const tocResult = await repo.seedTextbookTocSkeleton({
      documentId,
      userId: input.userId,
      title: input.title,
      language: input.language ?? 'ja',
      entries: input.tocEntries,
      forceOverwrite: input.forceOverwrite,
      ...(input.pdf ? { sourceFingerprint: createHash('sha256').update(input.pdf).digest('hex') } : {}),
    });

    if (!isOk(tocResult)) {
      logger.warn('[TextbookPipeline] Phase 0 目录骨架建槽门禁校验未通过', {
        taskId: task.id,
        documentId,
        code: tocResult.error.code,
        error: tocResult.error.userMessage,
      });
      await repo.updateImportTask(task.id, {
        status: 'failed',
        documentId,
        error: tocResult.error.userMessage,
      });
      return tocResult;
    }

    logger.info('[TextbookPipeline] Phase 0 目录骨架槽位初始化成功', {
      taskId: task.id,
      documentId,
      lessonCount: tocResult.value.lessonCount,
      totalEntries: tocResult.value.totalEntries,
    });

    // 3. 准备章节待提炼任务：若已提供切片则直接使用，否则通过 PDF 与检测器自动并发切片
    let jobs: LessonExtractionJob[] = [];
    if (Array.isArray(input.lessonJobs) && input.lessonJobs.length > 0) {
      jobs = input.lessonJobs.map((j) => ({
        documentId,
        lessonId: j.lessonId,
        ocrText: j.ocrText,
        ...(j.title ? { title: j.title } : {}),
        ...(j.startPage !== undefined ? { startPage: j.startPage } : {}),
        ...(j.endPage !== undefined ? { endPage: j.endPage } : {}),
        ...(j.subSections ? { subSections: j.subSections } : {}),
      }));
    } else if (input.pdf && input.inspector) {
      logger.info('[TextbookPipeline] 未传入切片文本，启动 PDF 自动切片与 OCR 流水线', {
        taskId: task.id,
        documentId,
        concurrency: input.ocrConcurrency ?? 3,
      });
      const sliceRes = await slicePdfLessonsWithOcr({
        pdf: input.pdf,
        tocEntries: input.tocEntries,
        inspector: input.inspector,
        concurrency: input.ocrConcurrency ?? 3,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      if (!isOk(sliceRes)) {
        logger.warn('[TextbookPipeline] PDF 章节切片提取失败', {
          taskId: task.id,
          documentId,
          error: sliceRes.error.userMessage,
        });
        await repo.updateImportTask(task.id, {
          status: 'failed',
          documentId,
          error: sliceRes.error.userMessage,
        });
        return sliceRes;
      }
      jobs = sliceRes.value.map((s) => ({
        documentId,
        lessonId: s.lessonId,
        ocrText: s.ocrText,
        title: s.title,
        startPage: s.startPage,
        endPage: s.endPage,
        ...(s.subSections ? { subSections: s.subSections } : {}),
      }));
      logger.info('[TextbookPipeline] PDF 章节切片抽取完成', {
        taskId: task.id,
        documentId,
        slicedJobsCount: jobs.length,
      });
    } else {
      const noJobErr = new BusinessError(
        'E_INVALID_INPUT',
        '未提供章节文本切片 (lessonJobs)，也未提供 PDF 字节或检测器供自动切片',
        'VALIDATION',
        false
      );
      logger.warn('[TextbookPipeline] 缺少正文切片或 PDF 数据源', {
        taskId: task.id,
        documentId,
      });
      await repo.updateImportTask(task.id, {
        status: 'failed',
        documentId,
        error: noJobErr.userMessage,
      });
      return err(noJobErr);
    }

    // 4. Phase 1 & 2: 依托 AgentPool 执行各章节并发提炼与白名单回填
    logger.info('[TextbookPipeline] 启动 Phase 1&2 章节并发提炼批处理', {
      taskId: task.id,
      documentId,
      jobCount: jobs.length,
      forceOverwrite: input.forceOverwrite,
    });
    const extractor = new LessonBatchExtractor(repo);
    const batchSummary = await extractor.extractBatch(jobs, {
      pool: input.pool,
      forceOverwrite: input.forceOverwrite,
      onProgress: input.onProgress,
      model: input.model,
      effort: input.effort,
      poolFactory: input.poolFactory,
      poolSize: input.poolSize,
      ...(input.signal ? { signal: input.signal } : {}),
    });

    // 5. 更新导入任务最终状态
    const finalStatus = batchSummary.allLessonsReady ? 'done' : 'failed';
    const failureMsg =
      batchSummary.failedJobs > 0
        ? `部分课次提炼未成功完成 (${batchSummary.failedJobs}/${batchSummary.totalJobs})，建议重试失败课次: ${batchSummary.errors.map((e) => e.lessonId).join(', ')}`
        : undefined;

    const taskUpdated = await repo.updateImportTask(task.id, {
      status: finalStatus,
      documentId,
      lessons: batchSummary.successfulJobs,
      ...(failureMsg ? { error: failureMsg } : {}),
    });

    const finalTask = isOk(taskUpdated) ? taskUpdated.value : task;

    if (batchSummary.allLessonsReady) {
      logger.info('[TextbookPipeline] 教材导入一条龙流水线圆满完成', {
        taskId: task.id,
        documentId,
        totalLessons: batchSummary.totalJobs,
        successfulLessons: batchSummary.successfulJobs,
      });
    } else {
      logger.warn('[TextbookPipeline] 教材提炼流水线结束但存在未就绪课次', {
        taskId: task.id,
        documentId,
        totalLessons: batchSummary.totalJobs,
        failedLessons: batchSummary.failedJobs,
        errors: batchSummary.errors,
      });
    }

    return ok({
      task: finalTask,
      documentId,
      title: input.title,
      lessonCount: tocResult.value.lessonCount,
      allLessonsReady: batchSummary.allLessonsReady,
      successfulLessons: batchSummary.successfulJobs,
      failedLessons: batchSummary.failedJobs,
      errors: batchSummary.errors,
    });
  } catch (cause) {
    const bizErr = translateToBusinessError(cause, {
      category: 'PIPELINE_EXECUTION',
      fallbackMessage: '教材处理流水线执行发生异常中断，请稍后重试',
    });
    logger.error('[TextbookPipeline] 流水线执行发生未捕获异常', {
      taskId: task.id,
      documentId,
      code: bizErr.code,
      error: bizErr.userMessage,
    });
    await repo.updateImportTask(task.id, {
      status: 'failed',
      documentId,
      error: bizErr.userMessage,
    });
    return err(bizErr);
  }
}
