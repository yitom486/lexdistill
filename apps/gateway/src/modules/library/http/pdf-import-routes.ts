import { Hono } from 'hono';
import { BusinessError, isOk } from '@study-studio/shared';
import { formatBusinessErrorResponse } from '../../../errors/http-error-handler.js';
import { convertPdfToAst, appendPdfToDocument, mapPdfPages, MAX_PDF_BYTES } from '../application/pdf-import/pdf-import-service.js';
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
export function createPdfImportRoutes(deps: GatewayDeps) {
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
        });
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'mapPdfDocument');
      }
    })
    .post('/api/documents/:userId/:documentId/append-pdf', async (c) => {
      // 接力追加：新页段的课接在已有教材后面（大书分段导入）。
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
  /** Azure 云 OCR 凭据（内存态透传，网关不落盘） */
  azure?: { endpoint: string; apiKey: string };
}

/** 字符串字段收窄（Key/endpoint 随请求来，用完即弃）。 */
function strField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function azureField(source: Record<string, unknown>): { endpoint: string; apiKey: string } | undefined {
  const endpoint = strField(source['azureEndpoint']);
  const apiKey = strField(source['azureKey']);
  if (endpoint && apiKey) return { endpoint, apiKey };
  return undefined;
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
    return {
      ok: true,
      value: {
        filename: read.value.filename,
        bytes: read.value.bytes,
        ...(pages ? { pages } : {}),
        ...(azure ? { azure } : {}),
      },
    };
  }
  let file: File | null = null;
  let startPage: number | undefined;
  let endPage: number | undefined;
  let azure: { endpoint: string; apiKey: string } | undefined;
  try {
    const body = await c.req.parseBody();
    const candidate = body['file'];
    if (candidate instanceof File) file = candidate;
    startPage = numField(body['startPage']);
    endPage = numField(body['endPage']);
    azure = azureField(body as Record<string, unknown>);
  } catch {
    return fail('上传体不是合法 multipart，请用 file 字段上传 PDF');
  }
  if (!file) return fail('未收到 PDF 文件（file 字段为空）');
  if (file.size === 0 || file.size > MAX_PDF_BYTES) {
    return fail('PDF 文件过大（上传上限 200MB；更大请用本地路径直读）');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pages = pageRange(startPage, endPage);
  return {
    ok: true,
    value: {
      filename: file.name || 'upload.pdf',
      bytes,
      ...(pages ? { pages } : {}),
      ...(azure ? { azure } : {}),
    },
  };
}
