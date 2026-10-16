import { Hono } from 'hono';
import { validator } from 'hono/validator';
import { isOk, BusinessError } from '@lexdistill/shared';
import { clearAcpProvider, getAcpProviderStatus, saveAcpProvider } from '@yitom/acp-client';
import { formatBusinessErrorResponse } from '../../errors/http-error-handler.js';
import type { GatewayDeps } from '../../composition/gateway-deps.js';
import { listAgentRuntimes, customRuntimeStatus } from '../../runtime/router/runtime-catalog.js';

/** Provider-neutral Agent management routes. */
export function createAgentRoutes(deps: GatewayDeps) {
  return new Hono()
  .get('/api/agent/status', async (c) => {
    const res = await deps.server.getAgentStatus();
    return c.json(res.value);
  })
  .get('/api/agent/sessions', async (c) => {
    const limit = Number(c.req.query('limit') || 40);
    const cursor = c.req.query('cursor') || undefined;
    const searchTerm = c.req.query('q') || undefined;
    const res = await deps.server.listAgentSessions({
      limit: Number.isFinite(limit) ? limit : 40,
      ...(cursor ? { cursor } : {}),
      ...(searchTerm ? { searchTerm } : {}),
    });
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'AGENT_SESSIONS');
    }
    return c.json(res.value);
  })
  .get('/api/agent/sessions/:sessionId/items', async (c) => {
    const sessionId = c.req.param('sessionId');
    const limit = Number(c.req.query('limit') || 80);
    const res = await deps.server.listAgentSessionItems({
      sessionId,
      limit: Number.isFinite(limit) ? limit : 80,
    });
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'AGENT_SESSION_ITEMS');
    }
    return c.json(res.value);
  })
  .post('/api/agent/sessions/:sessionId/name', async (c) => {
    const sessionId = c.req.param('sessionId');
    const body = (await c.req.json().catch(() => ({}))) as { name?: string };
    const name = String(body.name || '').trim();
    if (!name) {
      return formatBusinessErrorResponse(
        c,
        new BusinessError('E_INVALID_INPUT', '缺少会话名称', 'VALIDATION'),
        'AGENT_SESSION_NAME'
      );
    }
    const res = await deps.server.setAgentSessionName(sessionId, name);
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'AGENT_SESSION_NAME');
    }
    return c.json({ ok: true, sessionId, name });
  })
  .post('/api/agent/sessions/:sessionId/archive', async (c) => {
    const sessionId = c.req.param('sessionId');
    const res = await deps.server.archiveAgentSession(sessionId);
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'AGENT_SESSION_ARCHIVE');
    }
    return c.json({ ok: true, sessionId });
  })
  .post('/api/agent/sessions/:sessionId/compact', async (c) => {
    const sessionId = c.req.param('sessionId');
    const res = await deps.server.compactAgentSession(sessionId);
    return formatBusinessErrorResponse(c, res.error, 'AGENT_SESSION_COMPACT');
  })
  .post('/api/agent/sessions/:sessionId/fork', async (c) => {
    const sessionId = c.req.param('sessionId');
    const body = (await c.req.json().catch(() => ({}))) as {
      ephemeral?: boolean;
      model?: string;
    };
    const res = await deps.server.forkAgentSession({
      sessionId,
      ...(typeof body.ephemeral === 'boolean' ? { ephemeral: body.ephemeral } : {}),
      ...(body.model ? { model: body.model } : {}),
    });
    return formatBusinessErrorResponse(c, res.error, 'AGENT_SESSION_FORK');
  })
  .get('/api/agent/sessions/:sessionId/queue', async (c) => {
    const sessionId = c.req.param('sessionId');
    const limit = Number(c.req.query('limit') || 20);
    const res = await deps.server.listAgentQueue({
      sessionId,
      limit: Number.isFinite(limit) ? limit : 20,
    });
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'AGENT_QUEUE_LIST');
    }
    return c.json(res.value);
  })
  .post('/api/agent/sessions/:sessionId/queue', async (c) => {
    const sessionId = c.req.param('sessionId');
    const body = (await c.req.json().catch(() => ({}))) as { message?: string };
    const message = String(body.message || '').trim();
    if (!message) {
      return formatBusinessErrorResponse(
        c,
        new BusinessError('E_INVALID_INPUT', '队列消息不能为空', 'VALIDATION'),
        'AGENT_QUEUE_ADD'
      );
    }
    const res = await deps.server.queueAgentAdd({ sessionId, message });
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'AGENT_QUEUE_ADD');
    }
    return c.json(res.value);
  })
  .delete('/api/agent/sessions/:sessionId/queue/:queuedId', async (c) => {
    const sessionId = c.req.param('sessionId');
    const queuedSubmissionId = c.req.param('queuedId');
    const res = await deps.server.deleteAgentQueueItem({
      sessionId,
      queuedSubmissionId,
    });
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'AGENT_QUEUE_DELETE');
    }
    return c.json({ ok: true });
  })
  .post('/api/agent/sessions/:sessionId/queue/start', async (c) => {
    const sessionId = c.req.param('sessionId');
    const body = (await c.req.json().catch(() => ({}))) as {
      queuedSubmissionId?: string;
    };
    const res = await deps.server.startAgentQueue({
      sessionId,
      ...(body.queuedSubmissionId
        ? { queuedSubmissionId: body.queuedSubmissionId }
        : {}),
    });
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'AGENT_QUEUE_START');
    }
    return c.json({ ok: true });
  })
  .get('/api/agent/tools', (c) => {
    // 注册表工具名探测：前端固定任务发送前预检，缺失直接提示重启网关，不浪费模型轮次。
    return c.json({ tools: deps.server.toolRegistry.list().map(tool => tool.name) });
  })
  .get('/api/agent/runtimes', async (c) => {
    // Agent 运行时目录＋自定义供应商伪条目：id 与前端配置对齐。
    return c.json({ runtimes: [...listAgentRuntimes(), await customRuntimeStatus()] });
  })
  .get('/api/agent/runtimes/:id/options', async (c) => {
    // 运行时真实选项（模型/思考深度列表，10 分钟缓存；无凭证如实空＋error）。
    // codex-acp 同样走 ACP 会话读表（与 setConfigOption 同一 id 口径，不再猜）。
    // ?model= 按模型级联：部分 Agent 切模型后才动态下发 effort，探针先设再读。
    const id = c.req.param('id');
    if (!id) {
      return formatBusinessErrorResponse(c,
        new BusinessError('E_INVALID_INPUT', '缺少运行时 id', 'VALIDATION'), 'AGENT_RUNTIME_OPTIONS');
    }
    const model = c.req.query('model') || undefined;
    return c.json(await deps.server.acpAdapterPool.getRuntimeOptions(id, model ? { model } : undefined));
  })
  .get('/api/agent/provider', async (c) => {
    // 自定义供应商状态（脱敏：Key 永不回传）。
    return c.json({ provider: await getAcpProviderStatus() });
  })
  .post('/api/agent/provider', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string; baseUrl?: string; model?: string; apiKey?: string; wireApi?: string;
    };
    const saved = await saveAcpProvider({
      ...(typeof body.name === 'string' ? { name: body.name } : {}),
      baseUrl: String(body.baseUrl || ''),
      model: String(body.model || ''),
      apiKey: String(body.apiKey || ''),
      wireApi: body.wireApi === 'responses' ? 'responses' : 'chat',
    });
    if (!saved.ok) {
      return formatBusinessErrorResponse(c,
        new BusinessError('E_INVALID_INPUT', saved.error.message, 'VALIDATION'), 'AGENT_PROVIDER_SAVE');
    }
    return c.json({ provider: saved.value });
  })
  .delete('/api/agent/provider', async (c) => {
    await clearAcpProvider();
    return c.json({ ok: true });
  })
  .all('/mcp/session/:token', async (c) => {
    // 会话级工具 MCP 桥（ACP 会话挂载；token 未知即 404，不泄漏）。
    return deps.server.sessionToolBridge.handleRequest(c.req.param('token'), c.req.raw);
  })
;
}
