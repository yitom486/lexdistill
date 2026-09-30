import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { TextbookASTSchema } from '@study-studio/document-model';
import { BusinessError } from '@study-studio/shared';
import type { ContentRepository } from '../ports.js';
import { getImportMonitorWarning, IMPORT_MONITOR_REFRESH_MS } from '../application/import-monitor.js';
import { formatBusinessErrorResponse } from '../../../errors/http-error-handler.js';

const cursorSchema = z.coerce.number().int().nonnegative();
export function createImportMonitorRoutes(repo: ContentRepository) {
  return new Hono()
    .get('/api/documents/:userId/textbook-imports/:traceId', async c => {
      const parsed = cursorSchema.safeParse(c.req.query('after') ?? 0);
      if (!parsed.success) return formatBusinessErrorResponse(c, new BusinessError('E_INVALID_INPUT', '交互记录游标无效', 'VALIDATION'));
      const userId = c.req.param('userId'), traceId = c.req.param('traceId');
      const result = await repo.listImportEvents({ userId, traceId, after: parsed.data, limit: 200 });
      if (!result.ok) return formatBusinessErrorResponse(c, result.error);
      const warning = getImportMonitorWarning(userId, traceId);
      return c.json({ events: result.value, cursor: result.value.at(-1)?.sequence ?? parsed.data, ...(warning ? { warning } : {}) });
    })
    .get('/api/documents/:userId/textbook-imports/:traceId/details/:sequence', async c => {
      const parsed = cursorSchema.safeParse(c.req.param('sequence'));
      if (!parsed.success) return formatBusinessErrorResponse(c, new BusinessError('E_INVALID_INPUT', '交互记录编号无效', 'VALIDATION'));
      const result = await repo.getImportEvent(c.req.param('userId'), c.req.param('traceId'), parsed.data);
      if (!result.ok) return formatBusinessErrorResponse(c, result.error);
      return result.value ? c.json(result.value) : formatBusinessErrorResponse(c, new BusinessError('E_NOT_FOUND', '未找到本次交互记录', 'LEARNER_STATE'));
    })
    .get('/api/documents/:userId/textbook-imports/:traceId/events', c => {
      const parsed = cursorSchema.safeParse(c.req.header('Last-Event-ID') ?? c.req.query('after') ?? 0);
      if (!parsed.success) return formatBusinessErrorResponse(c, new BusinessError('E_INVALID_INPUT', '交互记录游标无效', 'VALIDATION'));
      const userId = c.req.param('userId'), traceId = c.req.param('traceId');
      return streamSSE(c, async stream => {
        let cursor = parsed.data;
        while (!stream.aborted) {
          const result = await repo.listImportEvents({ userId, traceId, after: cursor, limit: 200 });
          const warning = getImportMonitorWarning(userId, traceId);
          if (!result.ok || warning) await stream.writeSSE({ event: 'monitor.warning', data: JSON.stringify({ warning: warning ?? '监视记录读取失败，请重开弹窗后核对' }) });
          if (result.ok) for (const event of result.value) {
            await stream.writeSSE({ event: 'monitor.event', id: String(event.sequence), data: JSON.stringify(event) });
            cursor = event.sequence;
          }
          await stream.sleep(IMPORT_MONITOR_REFRESH_MS);
        }
      });
    })
    .get('/api/documents/:userId/textbook-saved/:documentId/:nodeId', async c => {
      const document = await repo.getDocumentById(c.req.param('documentId'));
      if (!document.ok) return formatBusinessErrorResponse(c, document.error);
      if (!document.value || document.value.userId !== c.req.param('userId')) return formatBusinessErrorResponse(c, new BusinessError('E_NOT_FOUND', '未找到当前用户的教材', 'LEARNER_STATE'));
      let stored: unknown = null;
      try { stored = JSON.parse(document.value.astJson ?? 'null'); } catch { /* 下方统一返回业务错误。 */ }
      const ast = TextbookASTSchema.safeParse(stored);
      if (!ast.success) return formatBusinessErrorResponse(c, new BusinessError('E_INVALID_TEXTBOOK_AST', '教材保存底稿无法读取', 'VALIDATION'));
      const node = ast.data.lessons.find(item => item.id === c.req.param('nodeId'));
      if (!node) return formatBusinessErrorResponse(c, new BusinessError('E_NOT_FOUND', '未找到保存的目录节点', 'LEARNER_STATE'));
      return c.json({ documentId: document.value.id, nodeId: node.id, readAt: new Date().toISOString(), status: node.status, content: node.content ?? null });
    });
}
