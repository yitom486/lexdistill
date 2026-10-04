import { createHash } from 'node:crypto';
import type { AgentAdapter } from '@study-studio/agent-runtime';
import { canonicalizeTocEntries, planTextbookTasks, validateTocPageOrder, TextbookPipelineSettingsSchema, type TextbookPipelineSettings, type TocEntry, type TextbookModelActivity } from '@study-studio/document-model';
import { BusinessError, ok, err, generateId, translateToBusinessError, logger, type Result } from '@study-studio/shared';
import type { ImportTask } from '@study-studio/storage-sqlite';
import type { ContentRepository } from '../ports.js';
import type { TextbookContentTools } from '../tools/textbook-content-tools.js';
import { type BatchExtractionProgress, type LessonStage } from './lesson-batch-extractor.js';
import { PdfTaskWorkspace } from './pdf-import/pdf-task-workspace.js';
import type { LessonExtractionJob } from './lesson-batch-extractor.js';
import { ImportMonitor } from './import-monitor.js';

export interface TextbookPipelineInput extends Partial<TextbookPipelineSettings> {
  userId: string; documentId?: string | undefined; title: string;
  language?: string | undefined; filename?: string | undefined;
  tocEntries: readonly TocEntry[];
  lessonJobs?: Array<{ lessonId: string; text: string }> | undefined;
  pdf?: Uint8Array | undefined;
  forceOverwrite?: boolean | undefined;
  adapter?: AgentAdapter | undefined; submissionTool?: TextbookContentTools | undefined;
  model?: string | undefined; effort?: string | undefined;
  traceId?: string | undefined; jobId?: string | undefined;
  onProgress?: ((progress: BatchExtractionProgress) => void) | undefined; signal?: AbortSignal | undefined;
}
export interface TextbookPipelineOutput {
  task: ImportTask; documentId: string; title: string; lessonCount: number;
  allLessonsReady: boolean; successfulLessons: number; failedLessons: number;
  errors: Array<{ lessonId: string; error: string }>;
}

/** 调度器拥有阶段重试；模型发送、输入生产、校验提交和存储各自分工。 */
export async function executeTextbookPipeline(repo: ContentRepository, input: TextbookPipelineInput): Promise<Result<TextbookPipelineOutput, BusinessError>> {
  const settings = TextbookPipelineSettingsSchema.safeParse(input);
  if (!settings.success || !input.adapter || !input.submissionTool) return err(new BusinessError('E_INVALID_INPUT', '教材提取配置或章节会话通道未就绪', 'VALIDATION'));
  const config = settings.data;
  const validatedToc = validateTocPageOrder(input.tocEntries);
  if (!validatedToc.ok) return validatedToc;
  const documentId = input.documentId ?? generateId('doc_tb');
  const monitor = new ImportMonitor(repo, input.userId, input.traceId ?? generateId('import'), { documentId, ...(input.jobId ? { jobId: input.jobId } : {}) });
  const toc = Object.freeze(canonicalizeTocEntries(input.tocEntries).map(entry => Object.freeze({ ...entry })));
  const planned = planTextbookTasks(toc);
  if (!planned.ok) return planned;
  const tasks = planned.value;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  input.signal?.addEventListener('abort', cancel, { once: true });
  if (input.signal?.aborted) controller.abort();
  let task: ImportTask | undefined;
  const errors: TextbookPipelineOutput['errors'] = [];
  let successful = 0, completed = 0;
  const lessons = tasks.map(task => task.root);
  const emptyStats = { vocabCount: 0, grammarCount: 0, exerciseCount: 0, hasPassage: false };
  let workspace: PdfTaskWorkspace | undefined;
  const emit = (lessonId: string, stage: LessonStage, stats = emptyStats, error?: string, allLessonsReady = false, modelActivity?: TextbookModelActivity, activityOnly = false) => {
    if (!activityOnly) monitor.record('task', stage, { stats, error: error ?? null }, { nodeId: lessonId });
    input.onProgress?.({
    documentId, lessonId, stage, completedCount: completed, successfulCount: successful, totalCount: lessons.length,
    stats, allLessonsReady, ...(error ? { error } : {}), ...(modelActivity ? { modelActivity } : {}),
    });
  };
  const fail = (lessonId: string, error: BusinessError) => { completed++; errors.push({ lessonId, error: error.userMessage }); emit(lessonId, 'failed', emptyStats, error.userMessage); };
  try {
    monitor.record('task', 'started', { title: input.title, directory: toc, settings: config, model: input.model ?? null, effort: input.effort ?? null });
    if (controller.signal.aborted) throw new BusinessError('E_CANCELLED', '教材提取已取消', 'TOOL_EXECUTION');
    const created = await repo.createImportTask({ userId: input.userId, sourceKind: 'pdf', filename: input.filename ?? `${input.title}.pdf` });
    if (!created.ok) return created;
    task = created.value;
    // Re-extraction replaces content only in the final lesson transaction.
    const seeded = await repo.seedTextbookTocSkeleton({ documentId, userId: input.userId, title: input.title, language: input.language ?? 'ja', entries: toc,
      ...(input.pdf ? { sourceFingerprint: createHash('sha256').update(input.pdf).digest('hex') } : {}),
    });
    if (!seeded.ok) throw seeded.error;
    monitor.record('directory', 'saved_outline', seeded.value);
    const existing = await repo.getTextbookAssetStats(documentId);
    if (!existing.ok) throw existing.error;
    const ready = new Set(input.forceOverwrite ? [] : existing.value.lessonDetails.filter(item => item.status === 'ready').map(item => item.lessonId));
    const pending = lessons.filter(lesson => !ready.has(lesson.id));
    for (const lesson of lessons.filter(item => ready.has(item.id))) {
      const stats = existing.value.lessonDetails.find(item => item.lessonId === lesson.id)!;
      successful++; completed++; emit(lesson.id, 'saved', { vocabCount: stats.vocabCount, grammarCount: stats.grammarCount, exerciseCount: stats.exerciseCount, hasPassage: stats.hasPassage });
    }
    if (pending.length) {
      const prepared: LessonExtractionJob[] = [];
      if (input.pdf) {
        const created = await PdfTaskWorkspace.create(input.pdf, controller.signal);
        if (!created.ok) throw created.error;
        workspace = created.value;
      }
      const supplied = new Map(input.lessonJobs?.map(job => [job.lessonId, job]) ?? []);
      if (input.lessonJobs && (supplied.size !== input.lessonJobs.length || input.lessonJobs.some(job => !lessons.some(lesson => lesson.id === job.lessonId)))) throw new BusinessError('E_TOC_SLOT_NOT_FOUND', '章节输入含重复或未知目录 ID', 'VALIDATION');
      // 先准备全部一级章节的文件；执行器由外部接入，文件保留到整个任务结束。
      for (const [index, lesson] of pending.entries()) {
        if (controller.signal.aborted) throw new BusinessError('E_CANCELLED', '教材处理已取消', 'TOOL_EXECUTION');
        const task = tasks.find(task => task.root.id === lesson.id)!;
        const base = { documentId, lessonId: lesson.id, title: lesson.title, language: input.language ?? 'ja', allowAiExercises: config.allowAiExercises, tocEntries: task.entries, tocPath: [], text: '' };
        if (workspace) {
          emit(lesson.id, 'preparing');
          const end = lesson.endPage ?? workspace.pageCount;
          if (!Number.isSafeInteger(end) || end < lesson.startPage || end > workspace.pageCount || lesson.startPage < 1 || lesson.startPage > workspace.pageCount) {
            fail(lesson.id, new BusinessError('E_PDF_PAGE_RANGE_INVALID', '章节页码超出教材范围，请核对目录', 'VALIDATION')); continue;
          }
          const pages = Array.from({ length: Math.max(0, end - lesson.startPage + 1) }, (_, offset) => lesson.startPage + offset);
          const sliced = await workspace.slice(`${index + 1}.pdf`, pages, controller.signal);
          if (!sliced.ok) { fail(lesson.id, sliced.error); continue; }
          prepared.push({ ...base, pdfFile: sliced.value });
          monitor.record('text', 'chapter_pdf', sliced.value, { nodeId: lesson.id });
        } else {
          const text = supplied.get(lesson.id)?.text.trim();
          if (!text) { fail(lesson.id, new BusinessError('E_CHAPTER_TEXT_EMPTY', '该章没有可用文字或 PDF', 'VALIDATION')); continue; }
          prepared.push({ ...base, text });
          monitor.record('text', 'ready', { text }, { nodeId: lesson.id });
        }
      }
      // 自研会话池已删除：文件已备好，等待外部执行器（agentpools+MCP 工具注入）接管。
      // 接入前本批章节显式失败，不静默挂起、不重试。
      for (const job of prepared) {
        emit(job.lessonId, 'queued');
        fail(job.lessonId, new BusinessError('E_TEXTBOOK_DRIVER_REMOVED', '自研提取驱动已移除，等待外部执行器接入后重跑本章', 'AGENT_RUNTIME', false));
      }
    }
    if (controller.signal.aborted) throw new BusinessError('E_CANCELLED', '教材提取已取消，已保存章节保留', 'TOOL_EXECUTION');
    const stats = await repo.getTextbookAssetStats(documentId);
    if (!stats.ok) throw stats.error;
    const allLessonsReady = errors.length === 0 && stats.value.lessons > 0 && stats.value.readyLessons === stats.value.lessons;
    const updated = await repo.updateImportTask(task.id, { status: allLessonsReady ? 'done' : 'failed', documentId, lessons: successful, ...(errors.length ? { error: errors.map(item => `${item.lessonId}: ${item.error}`).join('; ') } : {}) });
    if (!updated.ok) throw updated.error;
    return ok({ task: updated.value, documentId, title: input.title, lessonCount: lessons.length, allLessonsReady, successfulLessons: successful, failedLessons: errors.length, errors });
  } catch (cause) {
    const error = cause instanceof BusinessError ? cause : translateToBusinessError(cause, { category: 'TOOL_EXECUTION', fallbackMessage: '教材处理失败，已保存章节保留' });
    if (task) await repo.updateImportTask(task.id, { status: 'failed', documentId, error: error.userMessage });
    monitor.record('task', 'error', { code: error.code, message: error.userMessage });
    return err(error);
  } finally {
    controller.abort();
    await workspace?.close().catch(cause => logger.warn('章节临时 PDF 清理失败', { cause: String(cause) }));
    monitor.record('task', 'ended', { successful, errors, cancelled: input.signal?.aborted ?? false });
    await monitor.flush();
    input.signal?.removeEventListener('abort', cancel);
  }
}
