import { afterEach, describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { GatewayServer } from '../runtime/gateway-runtime.js';
import { createAgentRoutes } from '../transport/http/agent-routes.js';

describe('GET /api/agent/tools', () => {
  it('返回注册表工具名：含词汇任务双工具，可被前端预检', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    try {
      const app = new Hono().route('/', createAgentRoutes({ repo, server: new GatewayServer(repo), port: 0 }));
      const res = await app.request('/api/agent/tools');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { tools?: unknown };
      expect(Array.isArray(body.tools)).toBe(true);
      const names = (body.tools ?? []) as string[];
      for (const name of ['dictionary.lookup', 'vocabulary.learning.context', 'vocabulary.learning.submit']) {
        expect(names.includes(name)).toBe(true);
      }
    } finally {
      repo.getRawDb().close();
    }
  });
});
