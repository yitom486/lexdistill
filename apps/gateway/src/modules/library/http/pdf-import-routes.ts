import { Hono } from 'hono';
import { BusinessError, isOk } from '@study-studio/shared';
import { formatBusinessErrorResponse } from '../../../errors/http-error-handler.js';
import { convertPdfToAst, appendPdfToDocument, mapPdfPages, MAX_PDF_BYTES } from '../application/pdf-import/pdf-import-service.js';
import { discoverTocPages } from '../application/pdf-import/toc-discovery.js';
import {
  discoverTocPagesStream,
  discoverTocPagesStreamFromFile,
  type TocDiscoveryFileReader,
  type TocDiscoveryStreamEvent,
} from '../application/pdf-import/toc-discovery-stream.js';
import type { PdfInspectorLike } from '../application/pdf-import/pdf-runtime.js';
import { extractTocBaseline } from '../application/pdf-import/toc-baseline.js';
import { reviewTocWithAgent } from '../application/pdf-import/toc-review-agent.js';
import { extractFolioCandidates } from '../application/pdf-import/toc-folio-candidates.js';
import { planTocSegments } from '../application/pdf-import/toc-segment-plan.js';
import { importTocLesson } from '../application/pdf-import/toc-lesson-import.js';
import { prepareTocImport } from '../application/pdf-import/toc-import-prepare.js';
import { executeTocImportFirst } from '../application/pdf-import/toc-import-execute.js';
import { executeTocImportNext } from '../application/pdf-import/toc-import-execute-next.js';
import { toTocImportSessionView } from '../persistence/toc-import-sessions.js';
import type { GatewayDeps } from '../../../transport/http/gateway-deps.js';
import { readLocalPdfFile } from '../application/pdf-import/local-file.js';

/**
 * PDF 导入路由：前端上传 PDF → 网关分类/提取/结构化 → 返回 TextbookAST。
 * 持久化复用前端既有 useImportTextbookMutation（POST /api/documents/:userId），
 * 本路由只做 PDF→AST（无状态转换），不直接写库。
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
    readLocalFile?: TocDiscoveryFileReader;
  }
) {
  return new Hono()
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
            ...(input.value.azure ? { azure: input.value.azure } : {}),
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
            ...(input.value.azure ? { azure: input.value.azure } : {}),
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
        });
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'mapPdfDocument');
      }
    })
    .post('/api/documents/:userId/discover-toc', async (c) => {
      // 目录页发现（只读）：无 embedded outline 时，用受限 OCR 前窗找疑似目录页范围，
      // 返回 found / ambiguous / not-found 供调用方确认。不写库、不落 AST、不自动导入。
      // 输入复用 readPdfInput（filePath 直读或 multipart 上传）；选页/azure 忽略，
      // 恒扫前窗、恒走本地链路。
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
        const res = await discoverTocPages(
          {
            ...(pdfOverrides?.loadInspector ? { loadInspector: pdfOverrides.loadInspector } : {}),
            ...(pdfOverrides?.runtimeDir ? { runtimeDir: pdfOverrides.runtimeDir } : {}),
          },
          { userId, filename: input.value.filename, bytes: input.value.bytes }
        );
        if (!isOk(res)) return formatBusinessErrorResponse(c, res.error);
        return c.json(res.value);
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'discoverTocPages');
      }
    })
    .post('/api/documents/:userId/discover-toc-stream', async (c) => {
      // CMD-LINGUA-P2.1/P2.1a 目录探测流式版（只读 NDJSON）：与 discover-toc
      // 同语义、同评分、同只读铁律，差别只是把前窗 OCR 拆成 5 页批次逐批上报
      // 真实进度。旧 JSON 端点原样保留；取消靠浏览器 AbortController →
      // request signal，批间停扫，只发 cancelled 永不补 completed。
      // P2.1a：JSON filePath 只解析小 JSON 与 path 形状即建流，真正的文件 IO
      // 在 producer 内分块进行（首事件先于读取，abort 在分块间停读）；
      // multipart 上传体到达网关前无读取进度可言，不伪造 input_read 事件。
      // 事件白名单见 TocDiscoveryStreamEvent（阶段/页数·字节数/批次范围/
      // 耗时/错误码，无任何正文与标识）。
      const userId = c.req.param('userId');
      if (!userId) {
        return formatBusinessErrorResponse(
          c,
          new BusinessError('E_INVALID_INPUT', '缺少用户标识', 'VALIDATION')
        );
      }
      const signal = c.req.raw.signal;
      const streamDeps = {
        ...(pdfOverrides?.loadInspector ? { loadInspector: pdfOverrides.loadInspector } : {}),
        ...(pdfOverrides?.runtimeDir ? { runtimeDir: pdfOverrides.runtimeDir } : {}),
        ...(pdfOverrides?.readLocalFile ? { readLocalFile: pdfOverrides.readLocalFile } : {}),
      };
      const encoder = new TextEncoder();
      const serveStream = (produce: (emit: (event: TocDiscoveryStreamEvent) => void) => Promise<unknown>): Response => {
        const body = new ReadableStream<Uint8Array>({
          async start(controller) {
            const emit = (event: TocDiscoveryStreamEvent): void => {
              try {
                controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
              } catch {
                // 客户端已断开：写流失败即停，不抛回调用栈（取消由 signal 驱动停扫）。
              }
            };
            try {
              await produce(emit);
            } catch (e) {
              const biz =
                e instanceof BusinessError
                  ? e
                  : new BusinessError('E_PDF_PARSE', '目录页探测失败，请稍后重试', 'TOOL_EXECUTION');
              emit({ type: 'failed', elapsedMs: 0, code: biz.code, userMessage: biz.userMessage });
            } finally {
              try {
                controller.close();
              } catch {
                // 客户端已断开，关闭失败可忽略。
              }
            }
          },
        });
        return new Response(body, {
          headers: {
            'Content-Type': 'application/x-ndjson; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Accel-Buffering': 'no',
          },
        });
      };
      const contentType = c.req.header('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const body = (await c.req.json().catch(() => null)) as { filePath?: unknown } | null;
        const filePath = typeof body?.filePath === 'string' && body.filePath ? body.filePath : undefined;
        if (!filePath) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', 'JSON 模式请提供 filePath（本机 PDF 绝对路径）', 'VALIDATION')
          );
        }
        return serveStream((emit) =>
          discoverTocPagesStreamFromFile(streamDeps, { userId, filePath }, { emit, signal })
        );
      }
      const input = await readPdfInput(c);
      if (!input.ok) return formatBusinessErrorResponse(c, input.error);
      const filename = input.value.filename;
      const bytes = input.value.bytes;
      return serveStream((emit) =>
        discoverTocPagesStream(streamDeps, { userId, filename, bytes }, { emit, signal })
      );
    })
        .post('/api/documents/:userId/extract-toc', async (c) => {
      // 目录基线 OCR（只读草稿）：调用方已确认 fromPage/toPage（经 startPage/endPage 传入），
      // 对该范围做本地 OCR 产出 title/printedPage/level/source/kind。不写库、不落 AST、不切课。
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
        const pages = input.value.pages;
        const fromPage = pages?.[0];
        const toPage = pages?.[pages.length - 1];
        if (fromPage === undefined || toPage === undefined) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '请提供已确认的目录页范围（startPage/endPage）', 'VALIDATION')
          );
        }
        const res = await extractTocBaseline(
          {},
          { userId, filename: input.value.filename, bytes: input.value.bytes, fromPage, toPage }
        );
        if (!isOk(res)) return formatBusinessErrorResponse(c, res.error);
        return c.json(res.value);
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'extractTocBaseline');
      }
    })
    .post('/api/documents/:userId/review-toc', async (c) => {
      // AI 目录审核草稿（只读）：P3 OCR 基线 + P4A-2 目录页 PNG，同一次 AgentInput。
      // embedded 命中时零 Agent；结果只经 HTTP 返回，绝不写 documents/AST/textbook_*/cache。
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
        const pages = input.value.pages;
        const fromPage = pages?.[0];
        const toPage = pages?.[pages.length - 1];
        if (fromPage === undefined || toPage === undefined) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '请提供已确认的目录页范围（startPage/endPage）', 'VALIDATION')
          );
        }
        const res = await reviewTocWithAgent(
          { adapter: deps.server.agentAdapter },
          { userId, filename: input.value.filename, bytes: input.value.bytes, fromPage, toPage }
        );
        if (!isOk(res)) return formatBusinessErrorResponse(c, res.error);
        return c.json(res.value);
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'reviewTocWithAgent');
      }
    })
    .post('/api/documents/:userId/folio-candidates', async (c) => {
      // P5-B folio 候选（只读弱证据）：调用方给出显式物理页号（pages 数组），
      // 返回每页页眉/页脚的孤立页码候选。绝不产出 anchor，不触发导入。
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
        const pageNumbers = input.value.pageNumbers;
        if (!pageNumbers) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '请提供要查看的 PDF 物理页号（pages 非空数组）', 'VALIDATION')
          );
        }
        const res = await extractFolioCandidates(
          {},
          { userId, filename: input.value.filename, bytes: input.value.bytes, pageNumbers }
        );
        if (!isOk(res)) return formatBusinessErrorResponse(c, res.error);
        return c.json(res.value);
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'extractFolioCandidates');
      }
    })
    .post('/api/documents/:userId/preview-toc-segments', async (c) => {
      // P5-C 分段预览（只读）：P4C 已确认条目 + 用户显式确认 anchors，
      // 仅以 [1] 探 pageCount 后调 P5-A 纯函数。不调 OCR/Agent/render，
      // 不写 DB/AST/cache；无效输入走 BusinessError.userMessage。
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
        if (input.value.entries === undefined || input.value.anchors === undefined) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '请提供已确认目录条目（entries）与用户确认 anchors（anchors）', 'VALIDATION')
          );
        }
        const res = await planTocSegments(
          {},
          {
            userId,
            filename: input.value.filename,
            bytes: input.value.bytes,
            entries: input.value.entries,
            anchors: input.value.anchors,
          }
        );
        if (!isOk(res)) return formatBusinessErrorResponse(c, res.error);
        return c.json(res.value);
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'planTocSegments');
      }
    })
    .post('/api/documents/:userId/prepare-toc-import', async (c) => {
      // P5-D2A 整书导入准备（只建 session，不执行导入）：
      // 探页数 → 重跑 preview → 指纹核验 → 全绿 gate → 幂等持久化 prepared chunks。
      // 不调 OCR/Agent/render/convert，不建 document；重复同请求复用同一 session。
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
        if (
          input.value.entries === undefined ||
          input.value.anchors === undefined ||
          input.value.fingerprint === undefined
        ) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '请提供已确认条目、anchors 与预览指纹', 'VALIDATION')
          );
        }
        const res = await prepareTocImport(
          {
            prepareSession: (prepared) => deps.repo.prepareTocImportSession(prepared),
          },
          {
            userId,
            filename: input.value.filename,
            bytes: input.value.bytes,
            entries: input.value.entries,
            anchors: input.value.anchors,
            fingerprint: input.value.fingerprint,
            ...(input.value.docTitle !== undefined ? { docTitle: input.value.docTitle } : {}),
          }
        );
        if (!isOk(res)) return formatBusinessErrorResponse(c, res.error, 'prepareTocImport');
        return c.json(res.value);
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'prepareTocImport');
      }
    })
    .get('/api/documents/:userId/toc-import-sessions/:sessionId', async (c) => {
      // P5-D2D 会话只读摘要：纯 DB 读，不碰 PDF/运行时/Agent/写路径。
      // 白名单字段（无 PDF/AST/folio/anchor/指纹原文）；owner 不符即 E_NOT_FOUND。
      try {
        const userId = c.req.param('userId');
        const sessionId = c.req.param('sessionId');
        if (!userId || !sessionId) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '缺少用户或会话标识', 'VALIDATION')
          );
        }
        const found = await deps.repo.getTocImportSessionById(sessionId);
        if (!found || found.session.userId !== userId) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_NOT_FOUND', '未找到指定的导入会话', 'LEARNER_STATE')
          );
        }
        return c.json(toTocImportSessionView(found.session, found.chunks));
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'getTocImportSession');
      }
    })
    .post('/api/documents/:userId/toc-import-sessions/:sessionId/execute-first', async (c) => {
      // P5-D2B 首 chunk 执行（只许 ordinal=0）：重验 gate → 精确窗 convert →
      // 单事务提交（建文档 + shred + 绑定 + 状态流转，含 completed 幂等读档）。
      // 禁止第二个 chunk、禁止 append；失败零残留（converter 失败只记 chunk 计数）。
      const input = await readPdfInput(c);
      if (!input.ok) return formatBusinessErrorResponse(c, input.error);
      try {
        const userId = c.req.param('userId');
        const sessionId = c.req.param('sessionId');
        if (!userId || !sessionId) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '缺少用户或会话标识', 'VALIDATION')
          );
        }
        if (
          input.value.entries === undefined ||
          input.value.anchors === undefined ||
          input.value.fingerprint === undefined
        ) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '请提供已确认条目、anchors 与预览指纹', 'VALIDATION')
          );
        }
        const res = await executeTocImportFirst(
          {
            getSession: async (uid, sid) => {
              const found = await deps.repo.getTocImportSessionById(sid);
              if (!found || found.session.userId !== uid) return undefined;
              return found;
            },
            getDocument: (id) => deps.repo.getDocumentById(id),
            commitFirstChunk: (committed) => deps.repo.commitTocFirstChunk(committed),
            recordChunkFailure: (failure) => deps.repo.recordTocChunkFailure(failure),
          },
          {
            userId,
            sessionId,
            filename: input.value.filename,
            bytes: input.value.bytes,
            entries: input.value.entries,
            anchors: input.value.anchors,
            fingerprint: input.value.fingerprint,
            ...(input.value.docTitle !== undefined ? { docTitle: input.value.docTitle } : {}),
          }
        );
        if (!isOk(res)) return formatBusinessErrorResponse(c, res.error, 'executeTocImportFirst');
        return c.json(res.value);
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'executeTocImportFirst');
      }
    })
    .post('/api/documents/:userId/toc-import-sessions/:sessionId/execute-next', async (c) => {
      // P5-D2C 下一个 chunk 追加（只许最小 prepared 即上一个 completed 的直接后继）：
      // 重验 gate → 精确窗 convert → 单事务提交（合并 AST + shred + 指纹 + 状态）。
      // 禁止整书循环、禁止跳过、禁止长课跨 chunk；失败零残留（converter 失败只记计数）。
      const input = await readPdfInput(c);
      if (!input.ok) return formatBusinessErrorResponse(c, input.error);
      try {
        const userId = c.req.param('userId');
        const sessionId = c.req.param('sessionId');
        if (!userId || !sessionId) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '缺少用户或会话标识', 'VALIDATION')
          );
        }
        if (
          input.value.entries === undefined ||
          input.value.anchors === undefined ||
          input.value.fingerprint === undefined
        ) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '请提供已确认条目、anchors 与预览指纹', 'VALIDATION')
          );
        }
        const res = await executeTocImportNext(
          {
            getSession: async (uid, sid) => {
              const found = await deps.repo.getTocImportSessionById(sid);
              if (!found || found.session.userId !== uid) return undefined;
              return found;
            },
            getDocument: (id) => deps.repo.getDocumentById(id),
            commitAppendChunk: (committed) => deps.repo.commitTocAppendChunk(committed),
            recordChunkFailure: (failure) => deps.repo.recordTocChunkFailure(failure),
          },
          {
            userId,
            sessionId,
            filename: input.value.filename,
            bytes: input.value.bytes,
            entries: input.value.entries,
            anchors: input.value.anchors,
            fingerprint: input.value.fingerprint,
          }
        );
        if (!isOk(res)) return formatBusinessErrorResponse(c, res.error, 'executeTocImportNext');
        return c.json(res.value);
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'executeTocImportNext');
      }
    })
    .post('/api/documents/:userId/import-toc-lesson', async (c) => {
      // P5-D1 单课导入（本轮唯一写入口）：用户选定一课 + 指纹一致 + 最终确认后，
      // 把该课完整 verified range 交给既有 convert 路径，恰一课才 canonical 落库。
      // 禁止整书/多课/append/任意页范围；失败零残留。
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
        if (
          input.value.entries === undefined ||
          input.value.anchors === undefined ||
          input.value.lessonIndex === undefined ||
          input.value.fingerprint === undefined
        ) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '请提供已确认条目、anchors、所选课与预览指纹', 'VALIDATION')
          );
        }
        const res = await importTocLesson(
          {
            // 唯一写能力：canonical 入口（id 服务端生成，不读他人文档，不调普通保存）。
            saveCanonicalAst: (docBase, book) => deps.repo.saveCanonicalAst(docBase, book),
          },
          {
            userId,
            filename: input.value.filename,
            bytes: input.value.bytes,
            entries: input.value.entries,
            anchors: input.value.anchors,
            lessonIndex: input.value.lessonIndex,
            fingerprint: input.value.fingerprint,
            ...(input.value.docTitle !== undefined ? { docTitle: input.value.docTitle } : {}),
          }
        );
        if (!isOk(res)) return formatBusinessErrorResponse(c, res.error, 'importTocLesson');
        return c.json(res.value);
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'importTocLesson');
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
          },
          {
            userId,
            documentId,
            filename: input.value.filename,
            bytes: input.value.bytes,
            ...(input.value.pages ? { pages: input.value.pages } : {}),
            ...(input.value.azure ? { azure: input.value.azure } : {}),
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
  /** Azure 云 OCR 凭据（内存态透传，网关不落盘） */
  azure?: { endpoint: string; apiKey: string };
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

function azureField(source: Record<string, unknown>): { endpoint: string; apiKey: string } | undefined {
  const endpoint = strField(source['azureEndpoint']);
  const apiKey = strField(source['azureKey']);
  if (endpoint && apiKey) return { endpoint, apiKey };
  return undefined;
}

/**
 * P5-B：显式物理页号集解析（纯函数）。
 * - 缺席 → undefined（旧行为；folio 端点会报“请提供”）；
 * - 数组 → 逐项正整数校验，非法项整体 'invalid'（fail-closed，不猜）；
 * - 字符串 → 先试 JSON 数组，失败再按逗号切分（`3,5,7`）。
 */
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

function pageRange(startPage?: number, endPage?: number): number[] | undefined {
  if (startPage !== undefined && endPage !== undefined && startPage >= 1 && endPage >= startPage) {
    const pages: number[] = [];
    for (let p = startPage; p <= endPage; p++) pages.push(p);
    return pages;
  }
  return undefined;
}

function numField(value: unknown): number | undefined {
  return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : undefined;
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
      azureEndpoint?: unknown;
      azureKey?: unknown;
    } | null;
    if (typeof body?.filePath !== 'string' || !body.filePath) {
      return fail('JSON 模式请提供 filePath（本机 PDF 绝对路径）');
    }
    const startPage = typeof body.startPage === 'number' ? body.startPage : undefined;
    const endPage = typeof body.endPage === 'number' ? body.endPage : undefined;
    const read = await readLocalPdfFile(body.filePath);
    if (!read.ok) return { ok: false, error: read.error };
    const pages = pageRange(startPage, endPage);
    const azure = azureField(body as Record<string, unknown>);
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
        ...(azure ? { azure } : {}),
        ...(classes !== undefined ? { classes } : {}),
      },
    };
  }
  let file: File | null = null;
  let startPage: number | undefined;
  let endPage: number | undefined;
  let azure: { endpoint: string; apiKey: string } | undefined;
  let classesRaw: unknown;
  let pagesRaw: unknown;
  let entriesRaw: unknown;
  let anchorsRaw: unknown;
  let lessonIndexRaw: unknown;
  let fingerprintRaw: unknown;
  let docTitleRaw: unknown;
  try {
    const body = await c.req.parseBody();
    const candidate = body['file'];
    if (candidate instanceof File) file = candidate;
    startPage = numField(body['startPage']);
    endPage = numField(body['endPage']);
    azure = azureField(body as Record<string, unknown>);
    classesRaw = body['classes'];
    pagesRaw = body['pages'];
    entriesRaw = body['entries'];
    anchorsRaw = body['anchors'];
    lessonIndexRaw = body['lessonIndex'];
    fingerprintRaw = body['fingerprint'];
    docTitleRaw = body['docTitle'];
  } catch {
    return fail('上传体不是合法 multipart，请用 file 字段上传 PDF');
  }
  if (!file) return fail('未收到 PDF 文件（file 字段为空）');
  if (file.size === 0 || file.size > MAX_PDF_BYTES) {
    return fail('PDF 文件过大（上传上限 200MB；更大请用本地路径直读）');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pages = pageRange(startPage, endPage);
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
      ...(azure ? { azure } : {}),
      ...(classes !== undefined ? { classes } : {}),
    },
  };
}
