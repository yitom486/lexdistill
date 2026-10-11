import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import type { AgentAdapter, AgentPoolDriver } from '@study-studio/agent-runtime';
import { canonicalizeTocEntries, planTextbookTasks, validateTocPageOrder, TextbookPipelineSettingsSchema, type TextbookPipelineSettings, type TocEntry, type TextbookModelActivity } from '@study-studio/document-model';
import { BusinessError, ok, err, generateId, translateToBusinessError, logger, type Result } from '@study-studio/shared';
import type { ImportTask } from '@study-studio/storage-sqlite';
import type { ContentRepository } from '../ports.js';
import type { TextbookContentTools } from '../tools/textbook-content-tools.js';
import { type BatchExtractionProgress, type LessonStage } from './lesson-batch-extractor.js';
import { PdfTaskWorkspace, agentWorkspaceParent } from './pdf-import/pdf-task-workspace.js';
import type { LessonExtractionJob } from './lesson-batch-extractor.js';
import { ImportMonitor } from './import-monitor.js';
import type { TextbookMcpRegistry } from '../mcp/textbook-mcp-server.js';
import type { McpChapterScope } from '../mcp/textbook-mcp-scope.js';
import { bootAgentpoolChapters, runAgentpoolWorkers, closeAgentpoolChapters } from './agentpool-textbook-runner.js';

export interface TextbookPipelineInput extends Partial<TextbookPipelineSettings> {
  userId: string; documentId?: string | undefined; title: string;
  language?: string | undefined; filename?: string | undefined;
  tocEntries: readonly TocEntry[];
  lessonJobs?: Array<{ lessonId: string; text: string }> | undefined;
  pdf?: Uint8Array | undefined;
  forceOverwrite?: boolean | undefined;
  model?: string | undefined; effort?: string | undefined;
  traceId?: string | undefined; jobId?: string | undefined;
  onProgress?: ((progress: BatchExtractionProgress) => void) | undefined; signal?: AbortSignal | undefined;
  /** agentpools 执行所需：MCP 注册表（与 HTTP 挂载共用实例）与网关自寻址。缺省即本轮不执行模型提炼。 */
  mcpRegistry?: TextbookMcpRegistry | undefined;
  gatewayBaseUrl?: string | undefined;
  codexBinary?: string | undefined;
  /** 测试注入：池驱动与确定性 scope 脚本；生产不传。 */
  poolDriver?: AgentPoolDriver | undefined;
  onChapterScope?: (scope: McpChapterScope, job: LessonExtractionJob, attempt: number) => void | Promise<void>;
}export interface TextbookPipelineOutput {
  task: ImportTask; documentId: string; title: string; lessonCount: number;
  allLessonsReady: boolean; successfulLessons: number; failedLessons: number;
  errors: Array<{ lessonId: string; error: string }>;
}

/** 调度器拥有阶段重试；模型发送、输入生产、校验提交和存储各自分工。 */
export async function executeTextbookPipeline(repo: ContentRepository, input: TextbookPipelineInput): Promise<Result<TextbookPipelineOutput, BusinessError>> {
  const settings = TextbookPipelineSettingsSchema.safeParse(input);
  if (!settings.success) return err(new BusinessError('E_INVALID_INPUT', '教材提取配置尚未就绪', 'VALIDATION'));
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
  // 池关闭失败意味着活动会话可能还在读文件：置位后 finally 保留临时目录。
  let driverCloseFailed = false;
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
      // 池子和装载/切分同时起：拉进程的几秒不再干等。Agent cwd 必须先存在。
      const poolCwd = input.pdf ? agentWorkspaceParent() : process.cwd();
      if (input.pdf) await mkdir(poolCwd, { recursive: true });
      const poolSize = Math.max(1, Math.min(config.poolSize, pending.length));
      const boot = input.mcpRegistry && input.gatewayBaseUrl
        ? bootAgentpoolChapters({
          registry: input.mcpRegistry,
          gatewayBaseUrl: input.gatewayBaseUrl,
          userId: input.userId,
          documentId,
          workingDirectory: poolCwd,
          ...(input.model ? { model: input.model } : {}),
          ...(input.effort ? { effort: input.effort } : {}),
          ...(input.codexBinary ? { codexBinary: input.codexBinary } : {}),
          // 教材正文执行：沙箱 workspace-write（线程级字段，官方三档之一），
          // 否则沙箱写不进任务目录。审批保持默认 never，MCP 工具免问靠服务端
          // 条目预授权（default_tools_approval_mode + 按工具覆盖，真机已验证）。
          // 只作用于本任务 Worker，不改用户全局 Codex 配置。
          codexArgs: ['app-server', '--listen', 'stdio://'],
          sandbox: 'workspace-write',
          ...(input.poolDriver ? { driver: input.poolDriver } : {}),
        }, poolSize)
        : null;
      // 装载/切分中途失败或取消：已起来的池子必须收走，不留孤儿进程。
      const settleBoot = async (): Promise<void> => {
        if (!boot || !input.mcpRegistry) return;
        const started = await boot.catch(() => null);
        if (started) await closeAgentpoolChapters({ registry: input.mcpRegistry, monitor }, started).catch(() => undefined);
      };
      try {
        if (input.pdf) {
          const created = await PdfTaskWorkspace.create(input.pdf, controller.signal);
          if (!created.ok) throw created.error;
          workspace = created.value;
        }
        const supplied = new Map(input.lessonJobs?.map(job => [job.lessonId, job]) ?? []);
        if (input.lessonJobs && (supplied.size !== input.lessonJobs.length || input.lessonJobs.some(job => !lessons.some(lesson => lesson.id === job.lessonId)))) throw new BusinessError('E_TOC_SLOT_NOT_FOUND', '章节输入含重复或未知目录 ID', 'VALIDATION');
        // 切分是毫秒级、章节按目录逐个切；烘图不在这里（开工时各 Worker 并发备图）。
        for (const [index, lesson] of pending.entries()) {
          if (controller.signal.aborted) throw new BusinessError('E_CANCELLED', '教材处理已取消', 'TOOL_EXECUTION');
          const task = tasks.find(task => task.root.id === lesson.id)!;
          const base = { documentId, lessonId: lesson.id, title: lesson.title, language: input.language ?? 'ja', allowAiExercises: config.allowAiExercises, tocEntries: task.entries, tocPath: task.ancestors, text: '' };
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
      } catch (cause) {
        await settleBoot();
        throw cause;
      }
      // agentpools 执行：MCP 注册表与网关自寻址由调用方注入；缺省则本批章节显式失败。
      // 池子在上面已经提前起好，这里只等它就绪（装载切分的时间盖住了拉进程）。
      if (!boot || !input.mcpRegistry || !input.gatewayBaseUrl) {
        for (const job of prepared) {
          emit(job.lessonId, 'queued');
          fail(job.lessonId, new BusinessError('E_TEXTBOOK_DRIVER_MISSING', '教材执行器未接线，无法提炼本章', 'AGENT_RUNTIME', false));
        }
      } else {
        const started = await boot;
        if (!prepared.length) {
          ({ driverCloseFailed } = await closeAgentpoolChapters({ registry: input.mcpRegistry, monitor }, started));
        } else {
          // 扫描版烘图推迟到章节开工（执行循环内），与模型轮次重叠。
          const activeWorkspace = workspace;
          await runAgentpoolWorkers({
            registry: input.mcpRegistry,
            gatewayBaseUrl: input.gatewayBaseUrl,
            userId: input.userId,
            documentId,
            jobs: prepared,
            poolSize: config.poolSize,
            ...(input.model ? { model: input.model } : {}),
            ...(input.effort ? { effort: input.effort } : {}),
            ...(input.codexBinary ? { codexBinary: input.codexBinary } : {}),
            codexArgs: ['app-server', '--listen', 'stdio://'],
            sandbox: 'workspace-write',
            ...(input.onChapterScope ? { onChapterScope: input.onChapterScope } : {}),
            workingDirectory: workspace?.workingDirectory ?? process.cwd(),
            allowAiExercises: config.allowAiExercises,
            ...(input.forceOverwrite ? { forceOverwrite: true } : {}),
            ...(activeWorkspace ? { prepareChapter: async (job: LessonExtractionJob) => {
              if (!job.pdfFile) return ok(job);
              const ready = await activeWorkspace.prepareImages(job.pdfFile, controller.signal);
              if (!ready.ok) return err(ready.error);
              return ok({ ...job, pdfFile: ready.value });
            } } : {}),
            firstResponseTimeoutMs: config.firstResponseTimeoutMs,
            stallTimeoutMs: config.stallTimeoutMs,
            wallTimeoutMs: config.wallTimeoutMs,
            toolRepairRetries: config.toolRepairRetries,
            modelRetries: config.modelRetries,
            storageRetries: config.storageRetries,
            signal: controller.signal,
            monitor,
            emit,
            fail,
            markSaved: (lessonId, stats, receipt) => {
              successful++;
              completed++;
              emit(lessonId, 'saved', stats, undefined, receipt.allLessonsReady);
            },
          }, started);
          ({ driverCloseFailed } = await closeAgentpoolChapters({ registry: input.mcpRegistry, monitor }, started));
        }
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
    if (driverCloseFailed) {
      logger.error('会话池关闭未完成，保留本次临时 PDF 目录待查');
      monitor.record('task', 'error', { code: 'E_AGENTPOOL_CLOSE', message: '会话池关闭未完成，临时文件已保留待查' });
    } else {
      await workspace?.close().catch(cause => logger.warn('章节临时 PDF 清理失败', { cause: String(cause) }));
    }
    monitor.record('task', 'ended', { successful, errors, cancelled: input.signal?.aborted ?? false });
    await monitor.flush();
    input.signal?.removeEventListener('abort', cancel);
  }
}
