import { createHash } from 'node:crypto';
import type { AgentAdapter, AgentImageAttachment } from '@study-studio/agent-runtime';
import { canonicalizeTocEntries, planTextbookTasks, TextbookPipelineSettingsSchema, type ChapterSource, type TextbookPipelineSettings, type TocEntry } from '@study-studio/document-model';
import { BusinessError, ok, err, generateId, translateToBusinessError, type Result } from '@study-studio/shared';
import type { ImportTask } from '@study-studio/storage-sqlite';
import type { ContentRepository } from '../ports.js';
import type { PdfInspectorLike, RenderedPagePng } from '../../../infrastructure/pdf-runtime/pdf-runtime.js';
import type { LibraryLessonCommitTool } from '../tools/library-lesson-commit-tool.js';
import { ChapterSessionPool, LessonInputQueue, type BatchExtractionProgress, type LessonStage } from './lesson-batch-extractor.js';
import { producePdfLessons } from './pdf-import/lesson-content-slicer.js';
import { ImportMonitor } from './import-monitor.js';
import type { ChapterParser } from '../../../infrastructure/mineru/parser.js';

export interface TextbookPipelineInput extends Partial<TextbookPipelineSettings> {
  userId: string; documentId?: string | undefined; title: string;
  language?: string | undefined; filename?: string | undefined;
  tocEntries: readonly TocEntry[];
  lessonJobs?: Array<{ lessonId: string; text: string; source?: ChapterSource }> | undefined;
  chapterParser?: ChapterParser | undefined;
  pdf?: Uint8Array | undefined; inspector?: PdfInspectorLike | undefined;
  forceOverwrite?: boolean | undefined;
  adapter?: AgentAdapter | undefined; submissionTool?: LibraryLessonCommitTool | undefined;
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
  const queue = new LessonInputQueue(config.queueCapacity);
  const stopQueue = () => queue.end(new BusinessError('E_CANCELLED', '教材提取已取消，已保存章节保留', 'TOOL_EXECUTION'));
  controller.signal.addEventListener('abort', stopQueue, { once: true });
  let pool: ChapterSessionPool | undefined;
  let fatalError: BusinessError | undefined;
  let task: ImportTask | undefined;
  const errors: TextbookPipelineOutput['errors'] = [];
  let successful = 0, completed = 0;
  const lessons = tasks.map(task => task.root);
  const emptyStats = { vocabCount: 0, grammarCount: 0, exerciseCount: 0, hasPassage: false };
  const emit = (lessonId: string, stage: LessonStage, stats = emptyStats, error?: string, allLessonsReady = false) => {
    monitor.record('task', stage, { stats, error: error ?? null }, { nodeId: lessonId });
    input.onProgress?.({
    documentId, lessonId, stage, completedCount: completed, successfulCount: successful, totalCount: lessons.length,
    stats, allLessonsReady, ...(error ? { error } : {}),
    });
  };
  const fail = (lessonId: string, error: BusinessError) => { completed++; errors.push({ lessonId, error: error.userMessage }); emit(lessonId, 'failed', emptyStats, error.userMessage); };
  try {
    monitor.record('task', 'started', { title: input.title, directory: toc, settings: config, model: input.model ?? null, effort: input.effort ?? null });
    if (controller.signal.aborted) throw new BusinessError('E_CANCELLED', '教材提取已取消', 'TOOL_EXECUTION');
    const created = await repo.createImportTask({ userId: input.userId, sourceKind: 'pdf', filename: input.filename ?? `${input.title}.pdf` });
    if (!created.ok) return created;
    task = created.value;
    const seeded = await repo.seedTextbookTocSkeleton({ documentId, userId: input.userId, title: input.title, language: input.language ?? 'ja', entries: toc, forceOverwrite: input.forceOverwrite,
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
      const tool = input.submissionTool;
      pool = new ChapterSessionPool({ userId: input.userId, adapter: input.adapter, tool, poolSize: config.poolSize, model: input.model, effort: input.effort, signal: controller.signal, monitor, firstResponseTimeoutMs: config.firstResponseTimeoutMs, stallTimeoutMs: config.stallTimeoutMs });
      const activePool = pool;
      const onText = async (lesson: TocEntry, text: string, source?: ChapterSource) => {
        const task = tasks.find(task => task.root.id === lesson.id)!;
        let attachments: AgentImageAttachment[] = [];
        const visualPages = [...new Set(source?.blocks.filter(block => block.kind === 'TABLE' || block.kind === 'IMAGE').map(block => block.page) ?? [])];
        if (visualPages.length && input.pdf && input.inspector) {
          try {
            if (!input.inspector.renderPdfPages || input.adapter?.supportsImageInput?.() !== true) throw new BusinessError('E_AGENT_CAPABILITY', '当前章节含表格或图片，需要 PDF 页渲染与支持图片的模型通道', 'AGENT_RUNTIME');
            // Pinned pdf-inspector permits at most 8 pages per native call; keep every requested page.
            const rendered: RenderedPagePng[] = [];
            for (let offset = 0; offset < visualPages.length; offset += 8) {
              if (controller.signal.aborted) throw new BusinessError('E_CANCELLED', '教材提取已取消', 'TOOL_EXECUTION');
              rendered.push(...await input.inspector.renderPdfPages(input.pdf, visualPages.slice(offset, offset + 8)));
            }
            if (rendered.length !== visualPages.length || visualPages.some(page => !rendered.some(image => image.pageNumber === page && image.png.length))) throw new BusinessError('E_PARSE_IMAGE_INVALID', '章节原页图片不完整，请检查 PDF 渲染运行时', 'VALIDATION', true);
            attachments = rendered.map(image => ({ label: `原书 PDF 第 ${image.pageNumber} 页`, png: image.png, width: image.width, height: image.height }));
          } catch (cause) { fail(lesson.id, cause instanceof BusinessError ? cause : new BusinessError('E_PDF_RENDER_FAILED', '章节原页图片准备失败，请检查 PDF 渲染运行时后重试本章', 'TOOL_EXECUTION', true)); return; }
        }
        monitor.record('text', 'ready', { text, source: source ?? null, startPage: lesson.startPage, endPage: lesson.endPage ?? null }, { nodeId: lesson.id });
        emit(lesson.id, 'queued');
        await queue.put({ documentId, lessonId: lesson.id, title: lesson.title, language: input.language ?? 'ja', allowAiExercises: config.allowAiExercises, tocEntries: task.entries, tocPath: task.ancestors, text, ...(source ? { source } : {}), ...(attachments.length ? { attachments } : {}) });
        monitor.record('queue', 'enqueued', { size: queue.size }, { nodeId: lesson.id });
      };
      const produce = async () => {
        if (input.lessonJobs?.length) {
          const supplied = new Map(input.lessonJobs.map(job => [job.lessonId, job]));
          if (supplied.size !== input.lessonJobs.length || input.lessonJobs.some(job => !lessons.some(lesson => lesson.id === job.lessonId))) throw new BusinessError('E_TOC_SLOT_NOT_FOUND', '章节输入含重复或未知目录 ID', 'VALIDATION');
          for (const lesson of pending) {
            if (controller.signal.aborted) return;
            const text = supplied.get(lesson.id)?.text.trim();
            if (!text) { fail(lesson.id, new BusinessError('E_CHAPTER_TEXT_EMPTY', '该章没有可用文字', 'VALIDATION')); continue; }
            await onText(lesson, text, supplied.get(lesson.id)?.source);
          }
        } else if (input.pdf && input.inspector) {
          await producePdfLessons({ pdf: input.pdf, inspector: input.inspector, lessons: pending, concurrency: config.parseConcurrency, retries: config.parseRetries, signal: controller.signal,
            settings: config, ...(input.chapterParser ? { parser: input.chapterParser } : {}),
            onDiagnostic: (lesson, name, detail) => monitor.record('text', name, detail, { nodeId: lesson.id }),
            onStart: lesson => emit(lesson.id, 'parsing'), onText, onFailure: (lesson, error) => {
              monitor.record('text', 'failed', { code: error.code, message: error.userMessage, retryable: error.retryable, details: error.internalDetails }, { nodeId: lesson.id });
              fail(lesson.id, error);
            },
          });
        } else throw new BusinessError('E_INVALID_INPUT', '请选择教材 PDF 或提供章节文字', 'VALIDATION');
        queue.end();
      };
      const consume = async () => {
        await activePool.initialize();
        await activePool.consume(queue, async (worker, job) => {
          monitor.record('queue', 'dequeued', undefined, { nodeId: job.lessonId, sessionId: worker.session.sessionId });
          let lastError: BusinessError | undefined;
          for (let attempt = 0; attempt <= config.modelRetries && !controller.signal.aborted; attempt++) {
            try { worker.session = await activePool.recover(worker.session); }
            catch (cause) { lastError = translateToBusinessError(cause, { category: 'AGENT_RUNTIME', fallbackMessage: '本章会话恢复失败，其他章节继续处理' }); break; }
            const session = worker.session;
            const assignmentId = generateId('chapter_attempt');
            const turnController = new AbortController();
            const cancelTurn = () => turnController.abort();
            controller.signal.addEventListener('abort', cancelTurn, { once: true });
            const binding = { nodeId: job.lessonId, sessionId: session.sessionId, ...(session.threadId ? { threadId: session.threadId } : {}), attemptId: assignmentId };
            monitor.record('session', 'bound', { attempt: attempt + 1 }, binding);
            if (attempt) { emit(job.lessonId, 'model_retrying'); monitor.record('model', 'retry', { previousError: lastError?.userMessage, attempt: attempt + 1 }, binding); }
            const submission = tool.bind(session.sessionId, { userId: input.userId, documentId, lessonId: job.lessonId, assignmentId, tocEntries: job.tocEntries, signal: controller.signal, allowAiExercises: config.allowAiExercises,
              ...(job.source ? { sourceBlocks: job.source.blocks } : {}),
              monitor, sessionId: session.sessionId, turnSignal: turnController.signal,
              onStage: stage => {
                if (stage === 'saved' && submission.receipt) { successful++; completed++; emit(job.lessonId, stage, submission.receipt.stats, undefined, submission.receipt.allLessonsReady); }
                else emit(job.lessonId, stage);
              },
            });
            try {
              emit(job.lessonId, 'extracting');
              const correction = lastError ? `${lastError.userMessage}${lastError.category === 'VALIDATION' && lastError.internalDetails ? `\n具体校验问题：${JSON.stringify(lastError.internalDetails)}` : ''}` : undefined;
              const sent = await activePool.send(session, job, assignmentId, turnController, correction);
              if (submission.receipt) return;
              if (submission.candidate) {
                for (let retry = 0; retry < config.storageRetries && !controller.signal.aborted && submission.error?.retryable; retry++) {
                  emit(job.lessonId, 'storage_retrying');
                  monitor.record('storage', 'retry', { retry: retry + 1, error: submission.error.userMessage }, binding);
                  const saved = await submission.persist(); if (saved.ok) return;
                }
                // 有效候选只重试保存，不能再次生成。
                lastError = submission.error ?? new BusinessError('E_INTERNAL', '章节未能保存', 'DATABASE');
                break;
              }
              lastError = !sent.ok ? sent.error : submission.error ?? new BusinessError('E_LESSON_SUBMISSION_MISSING', '模型未通过工具提交有效内容', 'AGENT_RUNTIME', true);
              if (!lastError.retryable) break;
            } catch (cause) {
              lastError = translateToBusinessError(cause, { category: 'AGENT_RUNTIME', fallbackMessage: '本章模型处理失败' });
            } finally { turnController.abort(); controller.signal.removeEventListener('abort', cancelTurn); tool.end(session.sessionId); monitor.record('session', 'unbound', undefined, binding); }
          }
          if (!controller.signal.aborted) fail(job.lessonId, lastError ?? new BusinessError('E_INTERNAL', '本章提取未完成', 'TOOL_EXECUTION'));
        }, (job, error) => fail(job.lessonId, error));
      };
      const guard = async (run: () => Promise<void>) => { try { await run(); } catch (cause) { const error = cause instanceof BusinessError ? cause : translateToBusinessError(cause, '教材流水线'); fatalError ??= error; queue.end(error); controller.abort(); throw error; } };
      // 两侧同时启动；settled 保证原生任务和会话收尾后才退出。
      const results = await Promise.allSettled([guard(produce), guard(consume)]);
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw fatalError ?? failed.reason;
    }
    if (controller.signal.aborted) throw new BusinessError('E_CANCELLED', '教材提取已取消，已保存章节保留', 'TOOL_EXECUTION');
    const stats = await repo.getTextbookAssetStats(documentId);
    if (!stats.ok) throw stats.error;
    const allLessonsReady = stats.value.lessons > 0 && stats.value.readyLessons === stats.value.lessons;
    const updated = await repo.updateImportTask(task.id, { status: allLessonsReady ? 'done' : 'failed', documentId, lessons: successful, ...(errors.length ? { error: errors.map(item => `${item.lessonId}: ${item.error}`).join('; ') } : {}) });
    if (!updated.ok) throw updated.error;
    return ok({ task: updated.value, documentId, title: input.title, lessonCount: lessons.length, allLessonsReady, successfulLessons: successful, failedLessons: errors.length, errors });
  } catch (cause) {
    const error = cause instanceof BusinessError ? cause : translateToBusinessError(cause, { category: 'TOOL_EXECUTION', fallbackMessage: '教材处理失败，已保存章节保留' });
    if (task) await repo.updateImportTask(task.id, { status: 'failed', documentId, error: error.userMessage });
    monitor.record('task', 'error', { code: error.code, message: error.userMessage });
    return err(error);
  } finally {
    controller.abort(); await pool?.close();
    monitor.record('task', 'ended', { successful, errors, cancelled: input.signal?.aborted ?? false });
    await monitor.flush();
    input.signal?.removeEventListener('abort', cancel); controller.signal.removeEventListener('abort', stopQueue);
  }
}
