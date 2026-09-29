import {
  ok,
  err,
  isOk,
  type Result,
  BusinessError,
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
} from './lesson-batch-extractor.js';

export interface TextbookPipelineInput {
  userId: string;
  documentId?: string | undefined;
  title: string;
  language?: string | undefined;
  filename?: string | undefined;
  /** Phase 0: 目录识别结构（4 级枚举与起止页码） */
  tocEntries: readonly TocEntry[];
  /** Phase 1: 各章节待提炼的 OCR 文本切片 */
  lessonJobs: Array<{
    lessonId: string;
    ocrText: string;
    title?: string | undefined;
  }>;
  /** 可选注入的 Worker 池（支持 AgentPool 或测试 Mock） */
  pool?: AgentPoolLike | undefined;
  /** 实时进度通知回调 */
  onProgress?: ((progress: BatchExtractionProgress) => void) | undefined;
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

  // 1. 创建导入任务记录
  const taskCreated = await repo.createImportTask({
    userId: input.userId,
    sourceKind: 'pdf',
    filename,
  });
  if (!isOk(taskCreated)) {
    return taskCreated;
  }
  const task = taskCreated.value;

  // 2. Phase 0: 目录识别并优先建立骨架槽位（严格单调递增自动校验门禁）
  const tocResult = await repo.seedTextbookTocSkeleton({
    documentId,
    userId: input.userId,
    title: input.title,
    language: input.language ?? 'ja',
    entries: input.tocEntries,
  });

  if (!isOk(tocResult)) {
    await repo.updateImportTask(task.id, {
      status: 'failed',
      documentId,
      error: tocResult.error.userMessage,
    });
    return tocResult;
  }

  // 3. Phase 1 & 2: 依托 AgentPool 执行各章节并发提炼与白名单回填
  const extractor = new LessonBatchExtractor(repo);
  const jobs: LessonExtractionJob[] = input.lessonJobs.map((j) => ({
    documentId,
    lessonId: j.lessonId,
    ocrText: j.ocrText,
    ...(j.title ? { title: j.title } : {}),
  }));

  const batchSummary = await extractor.extractBatch(jobs, {
    pool: input.pool,
    onProgress: input.onProgress,
  });

  // 4. 更新导入任务最终状态
  const finalStatus = batchSummary.allLessonsReady ? 'done' : 'failed';
  const taskUpdated = await repo.updateImportTask(task.id, {
    status: finalStatus,
    documentId,
    lessons: batchSummary.successfulJobs,
    ...(batchSummary.failedJobs > 0
      ? { error: `部分课次提炼失败: ${batchSummary.errors.map((e) => e.lessonId).join(', ')}` }
      : {}),
  });

  const finalTask = isOk(taskUpdated) ? taskUpdated.value : task;

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
}
