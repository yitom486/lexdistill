import { Hono } from 'hono';
import { validator } from 'hono/validator';
import { isOk, BusinessError } from '@lexdistill/shared';
import { formatBusinessErrorResponse } from '../../errors/http-error-handler.js';
import type { GatewayDeps } from '../../composition/gateway-deps.js';

/**
 * 跨域兼容入口：`learning.content` / `learning.assess` 只做 Tool 委托，
 * 不持有业务规则（G2 迁移，行为不变）。
 */
export function createLearningCompatRoutes(deps: GatewayDeps) {
  return new Hono()
  // 10. 参数化学习内容引擎 (learning.content)
  .post(
    '/api/learning/content/:userId',
    validator('json', (value) => value as Record<string, unknown>),
    async (c) => {
      try {
        const userId = c.req.param('userId');
        const body = c.req.valid('json') as Record<string, unknown>;
        const tool = deps.server.toolRegistry.get('learning.content');
        if (!tool) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_TOOL_MISSING', 'learning.content 未注册', 'TOOL_EXECUTION')
          );
        }
        const res = await tool.execute(body, { userId, sessionId: 'http_content' });
        if (isOk(res)) return c.json(res.value);
        return formatBusinessErrorResponse(c, res.error);
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'learningContent');
      }
    }
  )
  .post(
    '/api/learning/assess/:userId',
    validator('json', (value) => value as Record<string, unknown>),
    async (c) => {
      try {
        const userId = c.req.param('userId');
        const body = c.req.valid('json') as Record<string, unknown>;
        const tool = deps.server.toolRegistry.get('learning.assess');
        if (!tool) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_TOOL_MISSING', 'learning.assess 未注册', 'TOOL_EXECUTION')
          );
        }
        const res = await tool.execute(body, { userId, sessionId: 'http_assess' });
        if (isOk(res)) return c.json(res.value);
        return formatBusinessErrorResponse(c, res.error);
      } catch (e) {
        return formatBusinessErrorResponse(c, e, 'learningAssess');
      }
    }
  );
}
