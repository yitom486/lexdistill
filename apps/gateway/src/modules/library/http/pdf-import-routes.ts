import { Hono } from 'hono';
import { BusinessError, isOk } from '@study-studio/shared';
import { formatBusinessErrorResponse } from '../../../errors/http-error-handler.js';
import { convertPdfToAst, appendPdfToDocument, mapPdfPages, MAX_PDF_BYTES } from '../application/pdf-import/pdf-import-service.js';
import { extractTocWithLlm } from '../application/toc-extractor.js';
import { beginTocVisionTrace, listTocVisionTraces } from '../application/toc-vision-diagnostics.js';
import { LibraryProposeTocTool } from '../tools/library-propose-toc-tool.js';
import { ensurePdfRuntime, type PdfInspectorLike } from '../../../infrastructure/pdf-runtime/pdf-runtime.js';
import type { TocEntry } from '@study-studio/document-model';
import type { GatewayDeps } from '../../../composition/gateway-deps.js';
import type { TextbookPipelineInput } from '../application/textbook-pipeline.js';
import { createDefaultAgentPool } from '../application/lesson-batch-extractor.js';
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
      // 目录定位完成后，只将选中 PDF 页渲染为图片交给视觉会话；不生成或传入 OCR 文本。
      const userId = c.req.param('userId');
      const trace = beginTocVisionTrace(userId);
      c.header('X-Toc-Trace-Id', trace.id);
      const input = await readPdfInput(c);
      if (!input.ok) {
        trace.finish('failed', { code: input.error.code });
        return formatBusinessErrorResponse(c, input.error);
      }
      try {
        if (!userId) {
          trace.finish('failed', { code: 'E_INVALID_INPUT' });
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '缺少用户标识', 'VALIDATION')
          );
        }
        if (!input.value.pages || input.value.pages.length === 0) {
          trace.finish('failed', { code: 'E_INVALID_INPUT' });
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '请指定教材目次所在的起始与结束页码', 'VALIDATION')
          );
        }
        if (input.value.pages.length > 8) {
          trace.finish('failed', { code: 'E_INVALID_INPUT' });
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '一次最多识别 8 张目录页图片，请缩小范围', 'VALIDATION')
          );
        }
        trace.record('request_accepted', {
          pdfPages: input.value.pages,
          model: input.value.model ?? 'default',
          source: 'pdf-page-images',
        });
        const proposalTool = deps.server.toolRegistry.get('library.propose_toc');
        if (!(proposalTool instanceof LibraryProposeTocTool)) {
          trace.finish('failed', { code: 'E_TOOL_NOT_FOUND' });
          return formatBusinessErrorResponse(c, new BusinessError(
            'E_TOOL_NOT_FOUND', '目录草稿工具尚未就绪，请重启网关后重试', 'TOOL_EXECUTION'
          ));
        }
        trace.record('runtime_starting');
        const runtime = await ensurePdfRuntime({ needPdfium: true, ...pdfOverrides });
        trace.record('runtime_ready');
        if (!runtime.inspector.renderPdfPages) {
          trace.finish('failed', { code: 'E_PDF_RENDER_UNAVAILABLE' });
          return formatBusinessErrorResponse(c, new BusinessError(
            'E_PDF_RENDER_UNAVAILABLE', 'PDF 页面渲染功能尚未就绪，请重启网关后重试', 'TOOL_EXECUTION'
          ));
        }
        trace.record('render_starting');
        const rendered = await runtime.inspector.renderPdfPages(input.value.bytes, input.value.pages);
        if (rendered.length !== input.value.pages.length || rendered.some((page, index) =>
          page.pageNumber !== input.value.pages![index] || page.png.length === 0
        )) {
          trace.finish('failed', { code: 'E_PDF_RENDER_INVALID' });
          return formatBusinessErrorResponse(c, new BusinessError(
            'E_PDF_RENDER_INVALID', '目录页图片生成不完整，请核对页码并重试', 'TOOL_EXECUTION'
          ));
        }
        trace.record('render_completed', {
          imageCount: rendered.length,
          imageBytes: rendered.reduce((total, page) => total + page.png.length, 0),
          imageWidths: rendered.map((page) => page.width),
        });
        const res = await extractTocWithLlm({
          userId,
          title: input.value.filename.replace(/\.[^/.]+$/, ''),
          language: input.value.language || 'ja',
          pageNumbers: input.value.pages,
          pageImages: rendered.map((page) => ({ png: page.png, label: `PDF 第 ${page.pageNumber} 页` })),
          adapter: deps.server.agentAdapter,
          proposalTool,
          traceId: trace.id,
          onDiagnostic: trace.record,
          ...(input.value.model ? { model: input.value.model } : {}),
        });

        if (!isOk(res)) {
          trace.finish('failed', { code: res.error.code });
          return formatBusinessErrorResponse(c, res.error, 'extractTocWithLlm');
        }
        trace.finish('completed', {
          entryCount: res.value.entries.length,
          firstPrintedPage: res.value.entries[0]?.startPage ?? 0,
        });
        return c.json(res.value);
      } catch (e) {
        trace.finish('failed', { code: e instanceof BusinessError ? e.code : 'E_UNEXPECTED' });
        return formatBusinessErrorResponse(c, e, 'extractTocWithLlm');
      }
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
        const body = (await c.req.json().catch(() => null)) as {
          documentId?: string;
          title?: string;
          language?: string;
          filename?: string;
          filePath?: string;
          model?: string;
          poolSize?: number;
          forceOverwrite?: boolean;
          tocEntries?: TocEntry[];
          lessonJobs?: Array<{
            lessonId: string;
            ocrText: string;
            title?: string;
          }>;
        } | null;

        if (!body || !body.title?.trim() || !Array.isArray(body.tocEntries)) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '请求体格式不正确，缺少 title 或 tocEntries', 'VALIDATION')
          );
        }

        let pdfBytes: Uint8Array | undefined = undefined;
        let inspector: PdfInspectorLike | undefined = undefined;
        if (body.filePath) {
          const fileRes = await readLocalPdfFile(body.filePath);
          if (fileRes.ok) {
            pdfBytes = fileRes.value.bytes;
            const runtime = await ensurePdfRuntime({ needPdfium: true, ...pdfOverrides });
            inspector = runtime.inspector;
          }
        }

        if ((!Array.isArray(body.lessonJobs) || body.lessonJobs.length === 0) && !pdfBytes) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '请提供章节文本切片 (lessonJobs) 或有效的教材本地路径 (filePath)', 'VALIDATION')
          );
        }

        const pool = body.model || body.poolSize
          ? createDefaultAgentPool({
              ...(body.model ? { model: body.model } : {}),
              ...(body.poolSize ? { poolSize: body.poolSize } : {}),
            })
          : undefined;

        const pipelineInput: TextbookPipelineInput = {
          userId,
          ...(body.documentId ? { documentId: body.documentId } : {}),
          title: body.title.trim(),
          ...(body.language ? { language: body.language } : {}),
          ...(body.filename ? { filename: body.filename } : {}),
          tocEntries: body.tocEntries,
          ...(body.lessonJobs ? { lessonJobs: body.lessonJobs } : {}),
          ...(pdfBytes ? { pdf: pdfBytes } : {}),
          ...(inspector ? { inspector } : {}),
          ...(body.forceOverwrite !== undefined ? { forceOverwrite: Boolean(body.forceOverwrite) } : {}),
          ...(pool ? { pool } : {}),
        };

        const res = await deps.repo.executeTextbookPipeline(pipelineInput);
        if (!isOk(res)) return formatBusinessErrorResponse(c, res.error, 'executeTextbookPipeline');
        return c.json(res.value);
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'executeTextbookPipeline');
      }
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
  /** 专精大模型标识（空=服务端默认/轻量推荐） */
  model?: string;
  /** 目标语种（空=服务端默认） */
  language?: string;
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
    const model = strField((body as Record<string, unknown>)['model']);
    const language = strField((body as Record<string, unknown>)['language']);
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
        ...(model ? { model } : {}),
        ...(language ? { language } : {}),
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
  let modelRaw: unknown;
  let languageRaw: unknown;
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
    modelRaw = body['model'];
    languageRaw = body['language'];
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
  const model = strField(modelRaw);
  const language = strField(languageRaw);
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
      ...(model ? { model } : {}),
      ...(language ? { language } : {}),
    },
  };
}
