import { Hono } from 'hono';
import { validator } from 'hono/validator';
import { BusinessError, isOk } from '@lexdistill/shared';
import { formatBusinessErrorResponse } from '../../../errors/http-error-handler.js';
import type { GatewayDeps } from '../../../composition/gateway-deps.js';

/**
 * 文档结构保存与读取（一文档一行）：
 * - POST /api/documents/:userId/:documentId/structure：保存已验分类；
 * - GET 同路径：读回（无记录返回 null）。
 */
export function createDocumentStructureRoutes(deps: GatewayDeps) {
  return (
    new Hono()
      .post(
        '/api/documents/:userId/:documentId/structure',
        validator('json', (value) => value as Record<string, unknown>),
        async (c) => {
          try {
            const userId = c.req.param('userId');
            const documentId = c.req.param('documentId');
            const body = c.req.valid('json');
            const headings = (Array.isArray(body.headings) ? body.headings : [])
              .filter(
                (h): h is Record<string, unknown> => !!h && typeof h === 'object'
              )
              .map((h) => ({
                page: typeof h.page === 'number' ? h.page : 0,
                text: typeof h.text === 'string' ? h.text : '',
              }))
              .filter((h) => h.text && h.page > 0)
              .slice(0, 200);
            const classes = (Array.isArray(body.classes) ? body.classes : [])
              .filter(
                (x): x is Record<string, unknown> => !!x && typeof x === 'object'
              )
              .map((x) => ({
                text: typeof x.text === 'string' ? x.text : '',
                page: typeof x.page === 'number' ? x.page : 0,
                kind:
                  x.kind === 'lesson' || x.kind === 'section' || x.kind === 'toc' || x.kind === 'noise'
                    ? (x.kind as 'lesson' | 'section' | 'toc' | 'noise')
                    : ('noise' as const),
                lessonNo: typeof x.lessonNo === 'string' ? x.lessonNo : null,
                skillId: typeof x.skillId === 'string' ? x.skillId : null,
              }))
              .filter((x) => x.text);
            const res = await deps.repo.saveDocumentStructure(userId, documentId, {
              headings,
              classes,
              model: typeof body.model === 'string' ? body.model : '',
              effort: typeof body.effort === 'string' ? body.effort : '',
              dropped: typeof body.dropped === 'number' ? body.dropped : 0,
            });
            if (isOk(res)) return c.json(res.value);
            return formatBusinessErrorResponse(c, res.error, 'saveDocumentStructure');
          } catch (e) {
            return formatBusinessErrorResponse(c, e, 'saveDocumentStructure');
          }
        }
      )
      .get('/api/documents/:userId/:documentId/structure', async (c) => {
        try {
          const res = await deps.repo.getDocumentStructure(
            c.req.param('userId'),
            c.req.param('documentId')
          );
          if (isOk(res)) return c.json(res.value);
          return formatBusinessErrorResponse(c, res.error, 'getDocumentStructure');
        } catch (e) {
          return formatBusinessErrorResponse(c, e, 'getDocumentStructure');
        }
      })
  );
}
