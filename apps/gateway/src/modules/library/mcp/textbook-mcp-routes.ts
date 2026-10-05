import { Hono } from 'hono';
import type { TextbookMcpRegistry } from './textbook-mcp-server.js';

/** 教材任务 MCP 端点：每个任务每 Worker 独立 URL；任务结束即 404。 */
export function createTextbookMcpRoutes(registry: TextbookMcpRegistry) {
  return new Hono().all('/mcp/textbook/:taskToken/w/:workerIndex', async (c) => {
    const taskToken = c.req.param('taskToken');
    const workerIndex = Number(c.req.param('workerIndex'));
    if (!taskToken || !Number.isInteger(workerIndex) || workerIndex < 0) {
      return Response.json({ error: '未知的教材任务端点' }, { status: 404 });
    }
    return registry.handleRequest(taskToken, workerIndex, c.req.raw);
  });
}
