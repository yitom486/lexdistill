import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { BusinessError, isOk, logger } from '@study-studio/shared';
import { PDFDocument } from 'pdf-lib';
import { formatBusinessErrorResponse } from '../../../errors/http-error-handler.js';
import { convertPdfToAst, appendPdfToDocument, mapPdfPages, MAX_PDF_BYTES } from '../application/pdf-import/pdf-import-service.js';
import { PdfTaskWorkspace, directoryWindow } from '../application/pdf-import/pdf-task-workspace.js';
import { extractTocWithLlm } from '../application/toc-extractor.js';
import { beginTocVisionTrace, listTocVisionTraces } from '../application/toc-vision-diagnostics.js';
import { LibraryProposeTocTool } from '../tools/library-propose-toc-tool.js';
import { type PdfInspectorLike } from '../../../infrastructure/pdf-runtime/pdf-runtime.js';
import { TocEntrySchema, TextbookPipelineSettingsSchema, SaveTextbookOutlineRequestSchema } from '@study-studio/document-model';
import { z } from 'zod';
import type { GatewayDeps } from '../../../composition/gateway-deps.js';
import type { TextbookPipelineInput } from '../application/textbook-pipeline.js';
import type { AgentAdapter } from '@study-studio/agent-runtime';
import { readLocalPdfFile } from '../application/pdf-import/local-file.js';
import { inspectTextbookImport } from '../application/textbook-inspector.js';
import { saveTextbookOutline } from '../application/textbook-outline.js';
import { createImportMonitorRoutes } from './import-monitor-routes.js';
import { ImportMonitor } from '../application/import-monitor.js';
import { TextbookMcpRegistry } from '../mcp/textbook-mcp-server.js';
import { createTextbookMcpRoutes } from '../mcp/textbook-mcp-routes.js';

const PipelineRequestSchema = TextbookPipelineSettingsSchema.extend({
  traceId: z.string().min(1).optional(),
  documentId: z.string().optional(),
  title: z.string().min(1),
  language: z.enum(['ja', 'en', 'ko']).optional(),
  filename: z.string().optional(),
  filePath: z.string().optional(),
  pdfBase64: z.string().optional(),
  model: z.string().optional(),
  effort: z.string().optional(),
  forceOverwrite: z.boolean().optional(),
  tocEntries: z.array(TocEntrySchema).min(1),
  lessonJobs: z.array(z.object({
    lessonId: z.string(),
    text: z.string(),
  })).optional(),
});

/**
 * PDF 导入路由：前端上传 PDF → 网关分类/提取/结构化 → 返回 TextbookAST。
 * 持久化复用前端既有 useImportTextbookMutation（POST /api/documents/:userId），
 * 目录确认可独立保存；正文流水线按章保存。
 *
 * 两种输入（二选一）：
 * - multipart：file(+startPage/endPage)——常规文件；
 * - JSON：{ filePath(+startPage/endPage) }——大文件本地直读。
 *   百 MB 级 PDF 走 multipart 会把网关进程 OOM 干崩（Hono parseBody 常驻缓冲，真机复现），
 *   同机网关（本机 dev / Tauri sidecar）请用 filePath 直读，零 HTTP 拷贝。
 */
export function createPdfImportRoutes(
  deps: GatewayDeps,
  pdfOverrides?: {
    loadInspector?: () => Promise<PdfInspectorLike>;
    runtimeDir?: string;
    adapter?: AgentAdapter | undefined;
    poolDriver?: TextbookPipelineInput['poolDriver'];
    onChapterScope?: TextbookPipelineInput['onChapterScope'];
  }
) {
  const mcpRegistry = new TextbookMcpRegistry({ repo: deps.repo });
  return new Hono()
    .route('', createImportMonitorRoutes(deps.repo))
    .route('', createTextbookMcpRoutes(mcpRegistry))
    .use('/api/documents/:userId/*', async (c, next) => {
      const traceId = c.req.header('X-Textbook-Trace');
      const monitored = ['map-pdf', 'extract-toc-llm', 'textbook-outline'].includes(c.req.path.split('/').at(-1) ?? '');
      if (!traceId || !monitored) { await next(); return; }
      const monitor = new ImportMonitor(deps.repo, c.req.param('userId')!, traceId);
      const operation = c.req.path.split('/').at(-1)!;
      monitor.record('directory', `${operation}_started`);
      await next();
      monitor.record('directory', `${operation}_result`, { status: c.res.status, result: await c.res.clone().json().catch(() => null) });
      await monitor.flush();
    })
    .post('/api/documents/:userId/import-pdf', async (c) => {
      const input = await readPdfInput(c);
      if (!input.ok) return formatBusinessErrorResponse(c, input.error);
      try {
        const userId = c.req.param('userId');
        if (!userId) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '缺少用户标识', 'VALIDATION')
          );
        }
        const res = await convertPdfToAst(
          {},
          {
            userId,
            filename: input.value.filename,
            bytes: input.value.bytes,
            ...(input.value.pages ? { pages: input.value.pages } : {}),
            ...(input.value.classes !== undefined ? { classes: input.value.classes } : {}),
          }
        );
        if (!isOk(res)) return formatBusinessErrorResponse(c, res.error);
        return c.json({
          book: res.value.book,
          classification: res.value.classification,
          stats: res.value.stats,
        });
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'importPdfDocument');
      }
    })
    .post('/api/documents/:userId/inspect-import', async (c) => {
      // 服务端权威预检：根据教材文件名与文件元数据，查询 SQLite 是否已收录且完全就绪
      try {
        const userId = c.req.param('userId');
        if (!userId) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '缺少用户标识', 'VALIDATION')
          );
        }
        const parsed = z.object({ filename: z.string().trim().min(1), filePath: z.string().trim().min(1) })
          .safeParse(await c.req.json().catch(() => null));
        if (!parsed.success) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '缺少待诊断文件名 filename', 'VALIDATION')
          );
        }
        const body = parsed.data;
        const res = await inspectTextbookImport(deps.repo, {
          userId,
          filename: body.filename.trim(),
          filePath: body.filePath,
        });

        if (!isOk(res)) return formatBusinessErrorResponse(c, res.error, 'inspectTextbookImport');
        return c.json(res.value);
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'inspectTextbookImport');
      }
    })
    .post('/api/documents/:userId/textbook-outline', async (c) => {
      try {
        const parsed = SaveTextbookOutlineRequestSchema.safeParse(await c.req.json().catch(() => null));
        if (!parsed.success) return formatBusinessErrorResponse(c, new BusinessError('E_INVALID_INPUT', '目录或 PDF 页码不完整，请核对后保存', 'VALIDATION'));
        const result = await saveTextbookOutline(deps.repo, c.req.param('userId'), parsed.data);
        return result.ok ? c.json(result.value) : formatBusinessErrorResponse(c, result.error);
      } catch (cause) { return formatBusinessErrorResponse(c, cause, 'saveTextbookOutline'); }
    })
    .post('/api/documents/:userId/map-pdf', async (c) => {      // 结构预览（目录感知第一步）：扫一个窗口页，返回每页标题 + 目录条目；
      // 调用方按标题页选范围，再调 import-pdf 精确导入。
      const input = await readPdfInput(c);
      if (!input.ok) return formatBusinessErrorResponse(c, input.error);
      try {
        const userId = c.req.param('userId');
        if (!userId) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '缺少用户标识', 'VALIDATION')
          );
        }
        const res = await mapPdfPages(
          {},
          {
            userId,
            filename: input.value.filename,
            bytes: input.value.bytes,
            ...(input.value.pages ? { pages: input.value.pages } : {}),
          }
        );
        if (!isOk(res)) return formatBusinessErrorResponse(c, res.error);
        return c.json({
          classification: res.value.classification,
          window: res.value.window,
          headings: res.value.headings,
          tocEntries: res.value.tocEntries,
          outlineSource: res.value.outlineSource,
          embeddedOutline: res.value.embeddedOutline,
          detectedTocRange: res.value.detectedTocRange,
        });
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'mapPdfDocument');
      }
    })
    .get('/api/toc-vision/:userId/traces', (c) =>
      c.json({ traces: listTocVisionTraces(c.req.param('userId')) })
    )
    .post('/api/documents/:userId/extract-toc-llm', async (c) => {
      const userId = c.req.param('userId');
      const trace = beginTocVisionTrace(userId);
      c.header('X-Toc-Trace-Id', trace.id);
      let workspace: PdfTaskWorkspace | undefined;
      const reject = (error: BusinessError) => { trace.finish('failed', { code: error.code }); return formatBusinessErrorResponse(c, error); };
      try {
        const input = await readPdfInput(c);
        if (!input.ok) return reject(input.error);
        const proposalTool = deps.server.toolRegistry.get('library.propose_toc');
        if (!(proposalTool instanceof LibraryProposeTocTool)) throw new BusinessError('E_TOOL_NOT_FOUND', '目录工具尚未就绪，请重启网关', 'TOOL_EXECUTION');
        const created = await PdfTaskWorkspace.create(input.value.bytes, c.req.raw.signal);
        if (!created.ok) return reject(created.error);
        workspace = created.value;
        const bookmarkPage = workspace.findDirectoryPage();
        const pages = input.value.pages ?? (bookmarkPage === null
          ? Array.from({ length: Math.min(30, workspace.pageCount) }, (_, i) => i + 1)
          : directoryWindow(workspace.pageCount, bookmarkPage));
        const file = await workspace.slice('0.pdf', pages, c.req.raw.signal);
        if (!file.ok) return reject(file.error);
        // 扫描版在这里备图（目录范围小，毫秒到秒级），再开模型轮。
        const materialized = await workspace.prepareImages(file.value, c.req.raw.signal);
        if (!materialized.ok) return reject(materialized.error);
        trace.record('request_accepted', { pdfPages: pages, source: 'local-pdf-file', model: input.value.model ?? 'default' });
        const importTraceId = c.req.header('X-Textbook-Trace');
        if (importTraceId) {
          const preMonitor = new ImportMonitor(deps.repo, userId, importTraceId);
          preMonitor.record('directory', 'pages_prepared', {
            pageCount: pages.length,
            startPage: pages[0],
            endPage: pages.at(-1),
            totalDocPages: workspace.pageCount,
          });
          void preMonitor.flush();
        }
        const batch = typeof deps.server.resolveBatchAdapter === 'function'
          ? deps.server.resolveBatchAdapter(input.value.runtimeId, 'toc')
          : { adapter: deps.server.agentAdapter, batchLane: false };
        let embeddedText: Array<{ originalPage: number; text: string }> | undefined;
        if (batch.batchLane) {
          const checked = await deps.server.checkBatchModelEffort(
            input.value.runtimeId!, input.value.model, input.value.effort);
          if (checked.dropModel || checked.dropEffort) {
            const message = checked.warnings.join('；');
            trace.finish('failed', { code: 'E_TOC_MODEL_MISMATCH' });
            return formatBusinessErrorResponse(c,
              new BusinessError('E_TOC_MODEL_MISMATCH', `${message}（请重选该运行时的模型/档位）`, 'VALIDATION'), '目录识别');
          }
          if (materialized.value.images.length > 0) {
            trace.finish('failed', { code: 'E_TOC_SCANNED_ACP' });
            return formatBusinessErrorResponse(c,
              new BusinessError('E_TOC_SCANNED_ACP', '扫描版目录识别暂需多模态通道读图（ACP 暂不支持图片输入），请切换多模态运行时通道', 'VALIDATION'), '目录识别');
          }
          const texts = workspace.extractOriginalPageTexts(materialized.value.originalPages);
          const paired = materialized.value.originalPages.map((page, index) => ({
            originalPage: page, text: (texts?.[index] ?? '').trim(),
          })).filter(entry => entry.text);
          if (paired.length === 0) {
            trace.finish('failed', { code: 'E_TOC_NO_TEXT' });
            return formatBusinessErrorResponse(c,
              new BusinessError('E_TOC_NO_TEXT', '本轮取不到可内嵌文字（请更新 PDF 组件后重试，或走 Codex 通道）', 'TOOL_EXECUTION'), '目录识别');
          }
          embeddedText = paired;
        }
        const res = await extractTocWithLlm({ userId, title: input.value.filename.replace(/\.[^/.]+$/, ''), language: input.value.language ?? 'ja',
          pdfFile: materialized.value, adapter: pdfOverrides?.adapter ?? batch.adapter, proposalTool, traceId: trace.id, onDiagnostic: trace.record,
          signal: c.req.raw.signal,
          ...(embeddedText ? { fileAccess: 'embedded-text' as const, embeddedText } : {}),
          ...(c.req.header('X-Textbook-Trace') ? { monitor: new ImportMonitor(deps.repo, userId, c.req.header('X-Textbook-Trace')!) } : {}),
          ...(input.value.model ? { model: input.value.model } : {}), ...(input.value.effort ? { effort: input.value.effort } : {}),
        });
        if (!res.ok) { trace.finish('failed', { code: res.error.code }); return formatBusinessErrorResponse(c, res.error); }
        trace.finish('completed', { entryCount: res.value.entries.length });
        return c.json(res.value);
      } catch (cause) {
        trace.finish('failed', { code: cause instanceof BusinessError ? cause.code : 'E_UNEXPECTED' });
        return formatBusinessErrorResponse(c, cause, '目录识别');
      } finally { await workspace?.close().catch(cause => logger.warn('TOC PDF cleanup failed', { cause: String(cause) })); }
    })
    .post('/api/documents/:userId/execute-textbook-pipeline', async (c) => {
      // AI-Native 教材一条龙导入流水线：Phase 0 骨架建槽 + Phase 1&2 Worker并发提炼与白名单回填
      try {
        const userId = c.req.param('userId');
        if (!userId) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '缺少用户标识', 'VALIDATION')
          );
        }
        const parsed = PipelineRequestSchema.safeParse(await c.req.json().catch(() => null));
        if (!parsed.success) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '请求体格式不正确，缺少 title 或 tocEntries', 'VALIDATION')
          );
        }
        const body = parsed.data;

        let pdfBytes: Uint8Array | undefined = undefined;
        if (body.filePath) {
          const fileRes = await readLocalPdfFile(body.filePath);
          if (!fileRes.ok) {
            return formatBusinessErrorResponse(c, fileRes.error, 'readLocalPdfFile');
          }
          pdfBytes = fileRes.value.bytes;
        } else if (body.pdfBase64) {
          try {
            pdfBytes = new Uint8Array(Buffer.from(body.pdfBase64, 'base64'));
          } catch (e) {
            return formatBusinessErrorResponse(
              c,
              new BusinessError('E_INVALID_INPUT', '提供的 pdfBase64 无法正常解码为二进制数据', 'VALIDATION')
            );
          }
        }

        if ((!Array.isArray(body.lessonJobs) || body.lessonJobs.length === 0) && !pdfBytes) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError(
              'E_INVALID_INPUT',
              '请提供章节文本切片 (lessonJobs) 或教材文件 (filePath / pdfBase64)',
              'VALIDATION'
            )
          );
        }

        const pipelineInput: TextbookPipelineInput = {
          userId,
          ...(body.traceId ? { traceId: body.traceId } : {}),
          ...(body.documentId ? { documentId: body.documentId } : {}),
          title: body.title.trim(),
          ...(body.language ? { language: body.language } : {}),
          ...(body.filename ? { filename: body.filename } : {}),
          tocEntries: body.tocEntries,
          ...(body.lessonJobs ? { lessonJobs: body.lessonJobs } : {}),
          ...(pdfBytes ? { pdf: pdfBytes } : {}),
          ...(body.forceOverwrite !== undefined ? { forceOverwrite: Boolean(body.forceOverwrite) } : {}),
          ...(body.model ? { model: body.model } : {}),
          ...(body.poolSize ? { poolSize: body.poolSize } : {}),
          ...(body.effort ? { effort: body.effort } : {}),
          ...TextbookPipelineSettingsSchema.parse(body),
          mcpRegistry,
          gatewayBaseUrl: `http://127.0.0.1:${deps.port}`,
          ...(pdfOverrides?.poolDriver ? { poolDriver: pdfOverrides.poolDriver } : {}),
          ...(pdfOverrides?.onChapterScope ? { onChapterScope: pdfOverrides.onChapterScope } : {}),
        };

        const res = await deps.repo.executeTextbookPipeline(pipelineInput);
        if (!isOk(res)) return formatBusinessErrorResponse(c, res.error, 'executeTextbookPipeline');
        return c.json(res.value);
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'executeTextbookPipeline');
      }
    })
    .post('/api/documents/:userId/textbook-pipeline-jobs', async (c) => {
      // 启动 AI-Native 教材一条龙提炼后台任务（非阻塞，支持 SSE 流式推模式与全局进度监控）
      try {
        const userId = c.req.param('userId');
        if (!userId) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '缺少用户标识', 'VALIDATION')
          );
        }
        const parsed = PipelineRequestSchema.safeParse(await c.req.json().catch(() => null));
        if (!parsed.success) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '请求体格式不正确，缺少 title 或 tocEntries', 'VALIDATION')
          );
        }
        const body = parsed.data;

        let pdfBytes: Uint8Array | undefined = undefined;
        if (body.filePath) {
          const fileRes = await readLocalPdfFile(body.filePath);
          if (!fileRes.ok) {
            return formatBusinessErrorResponse(c, fileRes.error, 'readLocalPdfFile');
          }
          pdfBytes = fileRes.value.bytes;
        } else if (body.pdfBase64) {
          try {
            pdfBytes = new Uint8Array(Buffer.from(body.pdfBase64, 'base64'));
          } catch (e) {
            return formatBusinessErrorResponse(
              c,
              new BusinessError('E_INVALID_INPUT', '提供的 pdfBase64 无法正常解码为二进制数据', 'VALIDATION')
            );
          }
        }

        if ((!Array.isArray(body.lessonJobs) || body.lessonJobs.length === 0) && !pdfBytes) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError(
              'E_INVALID_INPUT',
              '请提供章节文本切片 (lessonJobs) 或教材文件 (filePath / pdfBase64)',
              'VALIDATION'
            )
          );
        }

        const pipelineInput: TextbookPipelineInput = {
          userId,
          ...(body.traceId ? { traceId: body.traceId } : {}),
          ...(body.documentId ? { documentId: body.documentId } : {}),
          title: body.title.trim(),
          ...(body.language ? { language: body.language } : {}),
          ...(body.filename ? { filename: body.filename } : {}),
          tocEntries: body.tocEntries,
          ...(body.lessonJobs ? { lessonJobs: body.lessonJobs } : {}),
          ...(pdfBytes ? { pdf: pdfBytes } : {}),
          ...(body.forceOverwrite !== undefined ? { forceOverwrite: Boolean(body.forceOverwrite) } : {}),
          ...(body.model ? { model: body.model } : {}),
          ...(body.poolSize ? { poolSize: body.poolSize } : {}),
          ...(body.effort ? { effort: body.effort } : {}),
          ...TextbookPipelineSettingsSchema.parse(body),
          mcpRegistry,
          gatewayBaseUrl: `http://127.0.0.1:${deps.port}`,
          ...(pdfOverrides?.poolDriver ? { poolDriver: pdfOverrides.poolDriver } : {}),
          ...(pdfOverrides?.onChapterScope ? { onChapterScope: pdfOverrides.onChapterScope } : {}),
        };

        const res = deps.server.pipelineJobs.start(deps.repo, pipelineInput);

        if (!isOk(res)) return formatBusinessErrorResponse(c, res.error, 'startTextbookPipelineJob');
        return c.json(res.value, 202);
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'startTextbookPipelineJob');
      }
    })
    .get('/api/documents/:userId/textbook-pipeline-jobs/active', (c) => {
      const userId = c.req.param('userId');
      const activeJob = deps.server.pipelineJobs.getActive(userId);
      return c.json({ activeJob });
    })
    .get('/api/documents/:userId/textbook-pipeline-jobs/:jobId', (c) => {
      const jobId = c.req.param('jobId');
      const job = deps.server.pipelineJobs.get(jobId);
      if (!job || job.userId !== c.req.param('userId')) {
        return formatBusinessErrorResponse(
          c,
          new BusinessError('E_NOT_FOUND', '未找到指定的提炼任务', 'LEARNER_STATE')
        );
      }
      return c.json(job);
    })
    .get('/api/documents/:userId/textbook-pipeline-jobs/:jobId/events', (c) => {
      const jobId = c.req.param('jobId');
      const job = deps.server.pipelineJobs.get(jobId);
      if (!job || job.userId !== c.req.param('userId')) {
        return formatBusinessErrorResponse(
          c,
          new BusinessError('E_NOT_FOUND', '未找到指定的提炼任务', 'LEARNER_STATE')
        );
      }

      return streamSSE(c, async (stream) => {
        // 挂载时立即推送当前内存快照
        await stream.writeSSE({
          event: 'pipeline.snapshot',
          data: JSON.stringify(job),
        });

        if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') {
          return;
        }

        const unsubscribe = deps.server.pipelineJobs.subscribe(jobId, async (snapshot) => {
          try {
            await stream.writeSSE({
              event: snapshot.status === 'running' ? 'pipeline.progress' : 'pipeline.snapshot',
              data: JSON.stringify(snapshot),
            });
            if (snapshot.status !== 'running') {
              unsubscribe();
            }
          } catch {
            unsubscribe();
          }
        });

        stream.onAbort(() => {
          unsubscribe();
        });

        // 维持连接直至任务结束或客户端断开
        while (true) {
          const current = deps.server.pipelineJobs.get(jobId);
          if (!current || current.status !== 'running') break;
          await stream.sleep(2000);
        }
      });
    })
    .post('/api/documents/:userId/textbook-pipeline-jobs/:jobId/cancel', (c) => {
      const jobId = c.req.param('jobId');
      if (deps.server.pipelineJobs.get(jobId)?.userId !== c.req.param('userId')) return formatBusinessErrorResponse(c, new BusinessError('E_NOT_FOUND', '未找到指定的提炼任务', 'LEARNER_STATE'));
      const res = deps.server.pipelineJobs.cancel(jobId);
      if (!isOk(res)) return formatBusinessErrorResponse(c, res.error, 'cancelPipelineJob');
      return c.json(res.value);
    })
    .get('/api/documents/:userId/textbook-lessons/:documentId', async (c) => {
      try {
        const documentId = c.req.param('documentId');
        if (!documentId) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '缺少文档标识 documentId', 'VALIDATION')
          );
        }
        const res = await deps.repo.listTextbookLessonSlots(documentId);
        if (!isOk(res)) return formatBusinessErrorResponse(c, res.error, 'listTextbookLessonSlots');
        return c.json({ slots: res.value });
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'listTextbookLessonSlots');
      }
    })
    .post('/api/documents/:userId/:documentId/append-pdf', async (c) => {      // 接力追加：新页段的课接在已有教材后面（大书分段导入）。
      const input = await readPdfInput(c);
      if (!input.ok) return formatBusinessErrorResponse(c, input.error);
      try {
        const userId = c.req.param('userId');
        const documentId = c.req.param('documentId');
        if (!userId || !documentId) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '缺少用户或文档标识', 'VALIDATION')
          );
        }
        const res = await appendPdfToDocument(
          {
            saveDocument: (doc) => deps.repo.saveDocument(doc),
            // 唯一 canonical 写入口（AST + shred 同一事务；失败整体回滚并 err）。
            saveCanonicalAst: (docBase, book) => deps.repo.saveCanonicalAst(docBase, book),
            getDocument: (id) => deps.repo.getDocumentById(id),
            // P2-2a：提交后显式 lines 投影。
            projectLinesSegments: (userId, documentId) =>
              deps.repo.projectLinesSegments(userId, documentId),
          },
          {
            userId,
            documentId,
            filename: input.value.filename,
            bytes: input.value.bytes,
            ...(input.value.pages ? { pages: input.value.pages } : {}),
          }
        );
        if (!isOk(res)) return formatBusinessErrorResponse(c, res.error, 'appendPdfDocument');
        return c.json({
          documentId: res.value.document.id,
          addedLessons: res.value.addedLessons,
          addedDialogues: res.value.addedDialogues,
          totalLessons: res.value.totalLessons,
        });
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'appendPdfDocument');
      }
    });
}

interface PdfRouteInput {
  filename: string;
  bytes: Uint8Array;
  pages?: number[];
  /** P5-B：显式物理页号集（folio-candidates 专用；与起止范围互斥使用）。 */
  pageNumbers?: number[];
  /** P5-C：已确认目录条目 + 用户确认 anchors（preview-toc-segments 专用，原样透传，服务侧严格校验）。 */
  entries?: unknown;
  anchors?: unknown;
  /** P5-D1：所选课下标 + 预览指纹 + 新文档标题（import-toc-lesson 专用）。 */
  lessonIndex?: number;
  fingerprint?: string;
  docTitle?: string;
  /** CMD-01：已确认结构分类（原样透传，convert 侧 zod 校验后驱动切课） */
  classes?: unknown;
  /** 专精大模型标识（空=服务端默认/轻量推荐） */
  model?: string;
  effort?: string;
  /** 目标语种（空=服务端默认） */
  language?: string;
  /** Agent 运行时 id（空=Codex 原通路；指名 ACP 运行时即走该运行时池） */
  runtimeId?: string;
}

/**
 * P5-D1：所选课下标解析（纯函数）。
 * - 缺席 → undefined（import 端点会报“请提供”）；
 * - 数字非负整数 → 原样；数字字符串（multipart）→ 转换；
 * - 其余一律 'invalid'（fail-closed）。
 */
export function parseLessonIndexField(raw: unknown): number | undefined | 'invalid' {
  if (raw === undefined) return undefined;
  if (typeof raw === 'number') {
    return Number.isSafeInteger(raw) && raw >= 0 ? raw : 'invalid';
  }
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
    const value = Number(raw.trim());
    return Number.isSafeInteger(value) ? value : 'invalid';
  }
  return 'invalid';
}

/** 字符串字段收窄（Key/endpoint 随请求来，用完即弃）。 */
function strField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * CMD-01：从 JSON / multipart 请求体提取已确认结构分类（纯函数，可单测）。
 * - 缺席 → undefined（旧行为）；数组 → 原样透传（convert 侧 zod 校验）；
 * - 字符串 → 尝试 JSON 解析，解析失败则原样透传（convert 侧报友好错，不在此抛）。
 */
export function extractRequestClasses(source: Record<string, unknown>): unknown {
  const raw = source['classes'];
  if (raw === undefined) return undefined;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }
  return raw;
}

export function explicitPageNumbers(source: Record<string, unknown>): number[] | undefined | 'invalid' {
  const raw = source['pages'];
  if (raw === undefined) return undefined;
  const list: unknown = typeof raw === 'string' ? parsePagesField(raw) : raw;
  if (!Array.isArray(list)) return 'invalid';
  const pages: number[] = [];
  for (const item of list) {
    if (typeof item !== 'number' || !Number.isSafeInteger(item) || item < 1) return 'invalid';
    if (!pages.includes(item)) pages.push(item);
  }
  pages.sort((a, b) => a - b);
  return pages;
}

/**
 * P5-C：结构化负载透传（entries/anchors；纯函数，与 classes 同口径）。
 * - 缺席 → undefined（preview 端点会报“请提供”）；
 * - 字符串 → 尝试 JSON 解析，失败原样透传（服务侧报友好错）；
 * - 其他 → 原样透传（服务侧严格校验）。
 */
export function extractStructuredField(source: Record<string, unknown>, key: string): unknown {
  const raw = source[key];
  if (raw === undefined) return undefined;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }
  return raw;
}

function parsePagesField(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return 'invalid';
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // 非 JSON 则按逗号切分
  }
  return trimmed.split(',').map((part) => {
    const token = part.trim();
    if (!/^\d+$/.test(token)) return token;
    return Number(token);
  });
}

async function pageRange(startRaw: unknown, endRaw: unknown, bytes: Uint8Array): Promise<number[] | undefined | 'invalid'> {
  if (startRaw === undefined && endRaw === undefined) return undefined;
  const parse = (raw: unknown) => typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  const start = parse(startRaw), end = parse(endRaw);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) return 'invalid';
  // Check the actual file before allocating the range; malformed or huge page numbers never become an array.
  try {
    const pdf = await PDFDocument.load(bytes);
    if (end > pdf.getPageCount()) return 'invalid';
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  } catch { return 'invalid'; }
}

type RouteContext = {
  req: {
    header(name: string): string | undefined;
    parseBody(): Promise<Record<string, string | File>>;
    json(): Promise<unknown>;
  };
};

/** multipart 文件上传 或 JSON 本地路径（二选一，统一为字节 + 选页）。 */
async function readPdfInput(
  c: RouteContext
): Promise<{ ok: true; value: PdfRouteInput } | { ok: false; error: BusinessError }> {
  const fail = (msg: string) =>
    ({ ok: false as const, error: new BusinessError('E_INVALID_INPUT', msg, 'VALIDATION' as const) });
  const contentType = c.req.header('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = (await c.req.json().catch(() => null)) as {
      filePath?: unknown;
      startPage?: unknown;
      endPage?: unknown;
    } | null;
    if (typeof body?.filePath !== 'string' || !body.filePath) {
      return fail('JSON 模式请提供 filePath（本机 PDF 绝对路径）');
    }
    const read = await readLocalPdfFile(body.filePath);
    if (!read.ok) return { ok: false, error: read.error };
    const pages = await pageRange(body.startPage, body.endPage, read.value.bytes);
    if (pages === 'invalid') return fail('请填写完整、递增且不超出 PDF 的正整数页码范围；留空时使用前 30 页');
    const classes = extractRequestClasses(body as Record<string, unknown>);
    const pageNumbers = explicitPageNumbers(body as Record<string, unknown>);
    if (pageNumbers === 'invalid') {
      return fail('pages 须为正整数页号数组（如 [3,5,7]）');
    }
    const entries = extractStructuredField(body as Record<string, unknown>, 'entries');
    const anchors = extractStructuredField(body as Record<string, unknown>, 'anchors');
    const lessonIndex = parseLessonIndexField((body as Record<string, unknown>)['lessonIndex']);
    if (lessonIndex === 'invalid') {
      return fail('lessonIndex 须为非负整数（所选课下标）');
    }
    const fingerprint = strField((body as Record<string, unknown>)['fingerprint']);
    const docTitle = strField((body as Record<string, unknown>)['docTitle']);
    const model = strField((body as Record<string, unknown>)['model']);
    const effort = strField((body as Record<string, unknown>)['effort']);
    const language = strField((body as Record<string, unknown>)['language']);
    const runtimeId = strField((body as Record<string, unknown>)['runtimeId']);
    return {
      ok: true,
      value: {
        filename: read.value.filename,
        bytes: read.value.bytes,
        ...(pages ? { pages } : {}),
        ...(pageNumbers ? { pageNumbers } : {}),
        ...(entries !== undefined ? { entries } : {}),
        ...(anchors !== undefined ? { anchors } : {}),
        ...(lessonIndex !== undefined ? { lessonIndex } : {}),
        ...(fingerprint ? { fingerprint } : {}),
        ...(docTitle ? { docTitle } : {}),
        ...(classes !== undefined ? { classes } : {}),
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
        ...(language ? { language } : {}),
        ...(runtimeId ? { runtimeId } : {}),
      },
    };
  }
  let file: File | null = null;
  let startPage: unknown;
  let endPage: unknown;
  let classesRaw: unknown;
  let pagesRaw: unknown;
  let entriesRaw: unknown;
  let anchorsRaw: unknown;
  let lessonIndexRaw: unknown;
  let fingerprintRaw: unknown;
  let docTitleRaw: unknown;
  let modelRaw: unknown;
  let effortRaw: unknown;
  let languageRaw: unknown;
  let runtimeIdRaw: unknown;
  try {
    const body = await c.req.parseBody();
    const candidate = body['file'];
    if (candidate instanceof File) file = candidate;
    startPage = body['startPage'];
    endPage = body['endPage'];
    classesRaw = body['classes'];
    pagesRaw = body['pages'];
    entriesRaw = body['entries'];
    anchorsRaw = body['anchors'];
    lessonIndexRaw = body['lessonIndex'];
    fingerprintRaw = body['fingerprint'];
    docTitleRaw = body['docTitle'];
    modelRaw = body['model'];
    effortRaw = body['effort'];
    languageRaw = body['language'];
    runtimeIdRaw = body['runtimeId'];
  } catch {
    return fail('上传体不是合法 multipart，请用 file 字段上传 PDF');
  }
  if (!file) return fail('未收到 PDF 文件（file 字段为空）');
  if (file.size === 0 || file.size > MAX_PDF_BYTES) {
    return fail('PDF 文件过大（上传上限 200MB；更大请用本地路径直读）');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pages = await pageRange(startPage, endPage, bytes);
  if (pages === 'invalid') return fail('请填写完整、递增且不超出 PDF 的正整数页码范围；留空时使用前 30 页');
  const classes = extractRequestClasses({ classes: classesRaw });
  const pageNumbers = pagesRaw === undefined ? undefined : explicitPageNumbers({ pages: pagesRaw });
  if (pageNumbers === 'invalid') {
    return fail('pages 须为正整数页号数组（如 [3,5,7]）');
  }
  const entries = entriesRaw === undefined ? undefined : extractStructuredField({ entries: entriesRaw }, 'entries');
  const anchors = anchorsRaw === undefined ? undefined : extractStructuredField({ anchors: anchorsRaw }, 'anchors');
  const lessonIndex = lessonIndexRaw === undefined ? undefined : parseLessonIndexField(lessonIndexRaw);
  if (lessonIndex === 'invalid') {
    return fail('lessonIndex 须为非负整数（所选课下标）');
  }
  const fingerprint = fingerprintRaw === undefined ? undefined : strField(fingerprintRaw);
  const docTitle = docTitleRaw === undefined ? undefined : strField(docTitleRaw);
  const model = strField(modelRaw);
  const effort = strField(effortRaw);
  const language = strField(languageRaw);
  const runtimeId = strField(runtimeIdRaw);
  return {
    ok: true,
    value: {
      filename: file.name || 'upload.pdf',
      bytes,
      ...(pages ? { pages } : {}),
      ...(pageNumbers ? { pageNumbers } : {}),
      ...(entries !== undefined ? { entries } : {}),
      ...(anchors !== undefined ? { anchors } : {}),
      ...(lessonIndex !== undefined ? { lessonIndex } : {}),
      ...(fingerprint ? { fingerprint } : {}),
      ...(docTitle ? { docTitle } : {}),
      ...(classes !== undefined ? { classes } : {}),
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(language ? { language } : {}),
      ...(runtimeId ? { runtimeId } : {}),
    },
  };
}
