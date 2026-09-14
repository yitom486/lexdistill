import { Hono } from 'hono';
import { isOk } from '@study-studio/shared';
import { formatBusinessErrorResponse } from '../../../errors/http-error-handler.js';
import {
  DOCUMENT_SOURCE_KINDS,
  guessSourceKind,
  type DocumentSourceKind,
} from '@study-studio/content';
import { readDocumentFileBytes } from '../application/document-import/document-import-service.js';
import type { GatewayDeps } from '../../../composition/gateway-deps.js';

/**
 * 文档统一导入路由（PDF/EPUB/文本同一命令；任务落库可轮询）。
 * 既有 PDF 专线路由保持不变（行为不变），新来源走本统一入口。
 */
export function createDocumentImportRoutes(deps: GatewayDeps) {
  return (
    new Hono()
      .post('/api/library/import', async (c) => {
        try {
          const body = (await c.req.json().catch(() => null)) as {
            userId?: unknown;
            kind?: unknown;
            filename?: unknown;
            filePath?: unknown;
            text?: unknown;
            url?: unknown;
          } | null;
          const kind: DocumentSourceKind =
            (typeof body?.kind === 'string' &&
            (DOCUMENT_SOURCE_KINDS as string[]).includes(body.kind)
              ? (body.kind as DocumentSourceKind)
              : undefined) ??
            (typeof body?.filePath === 'string' ? guessSourceKind(body.filePath) : undefined) ??
            (typeof body?.url === 'string' ? 'url' : undefined) ??
            'text';
          const filename =
            typeof body?.filename === 'string' && body.filename
              ? body.filename.slice(0, 256)
              : typeof body?.filePath === 'string'
                ? (body.filePath.split(/[\\/]/).pop() ?? `未命名.${kind === 'pdf' ? 'pdf' : kind === 'epub' ? 'epub' : 'txt'}`)
                : typeof body?.url === 'string'
                  ? `网页-${new URL(body.url).hostname}`
                  : `未命名.txt`;
          let bytes: Uint8Array | null = null;
          let url: string | undefined;
          if (typeof body?.filePath === 'string' && body.filePath) {
            const read = await readDocumentFileBytes(body.filePath, kind);
            if (!isOk(read)) return formatBusinessErrorResponse(c, read.error, 'libraryImport');
            bytes = read.value;
          } else if (kind === 'text' && typeof body?.text === 'string' && body.text) {
            bytes = new TextEncoder().encode(body.text.slice(0, 5 * 1024 * 1024));
          } else if (kind === 'url' && typeof body?.url === 'string' && body.url) {
            url = body.url;
          } else {
            return formatBusinessErrorResponse(
              c,
              new Error('请提供本机文档绝对路径（filePath）、直传文本（text）或网址（url）'),
              'libraryImport'
            );
          }
          const res = await deps.repo.importDocumentFile({
            userId: typeof body?.userId === 'string' && body.userId ? body.userId : 'default_user',
            kind,
            filename,
            ...(bytes ? { bytes } : {}),
            ...(url ? { url } : {}),
          });
          if (!isOk(res)) return formatBusinessErrorResponse(c, res.error, 'libraryImport');
          return c.json({
            task: res.value.task,
            documentId: res.value.document.id,
            title: res.value.document.title,
            lessons: res.value.lessons,
            toc: res.value.toc,
          });
        } catch (e) {
          return formatBusinessErrorResponse(c, e, 'libraryImport');
        }
      })
      .get('/api/library/imports/:id', async (c) => {
        const task = await deps.repo.getImportTask(c.req.param('id'));
        if (!task) {
          return formatBusinessErrorResponse(c, new Error('导入任务不存在'), 'libraryImportStatus');
        }
        return c.json({ task });
      })
  );
}
