import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { GatewayServer } from '../runtime/gateway-runtime.js';
import { createAgentRoutes } from '../transport/http/agent-routes.js';
import { SessionToolBridge } from '../runtime/mcp/session-tool-bridge.js';
import { DictionaryLookupTool } from '../modules/dictionary/tools/dictionary-lookup-tool.js';

/** 前端目录 id 契约（apps/web/src/config/agent-runtimes.ts）：后端 id 必须与之一致，改一处必改另一处。 */
const FRONTEND_RUNTIME_IDS = ['codex-acp', 'claude', 'gemini', 'copilot', 'opencode', 'opencode-v2', 'cursor-cli', 'deepseek', 'agy'];

const repos: DrizzleLearnerRepository[] = [];

async function rpc(bridge: SessionToolBridge, token: string, method: string, params: unknown, sessionId?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const res = await bridge.handleRequest(token, new Request('http://127.0.0.1/mcp', {
    method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }));
  const text = await res.text();
  const payload = text.startsWith('event:') && text.includes('data: ')
    ? JSON.parse(text.split('data: ')[1]!.split('\n')[0]!)
    : JSON.parse(text || '{}');
  return { res, payload, sessionId: res.headers.get('mcp-session-id') ?? sessionId };
}

describe('SessionToolBridge', () => {
  it('建端点→挂载工具→调用→撤销：未知 token 404，TTL sweep 可清', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    repos.push(repo);
    const server = new GatewayServer(repo);
    const bridge = server.sessionToolBridge;
    const created = bridge.create('u1', 'sess-1', [new DictionaryLookupTool(repo)]);
    expect(created.token.startsWith('st-')).toBe(true);
    expect(created.spec.type).toBe('http');
    expect(created.spec.headers).toEqual([]);
    expect(created.spec.url).toContain(`/mcp/session/${created.token}`);

    const unknown = await bridge.handleRequest('st-nope', new Request('http://127.0.0.1/mcp'));
    expect(unknown.status).toBe(404);

    const init = await rpc(bridge, created.token, 'initialize',
      { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    expect(init.res.status).toBe(200);
    const listed = await rpc(bridge, created.token, 'tools/list', {}, init.sessionId);
    expect(listed.res.status).toBe(200);
    expect(JSON.stringify(listed.payload)).toContain('dictionary.lookup');

    const badCall = await rpc(bridge, created.token, 'tools/call',
      { name: 'dictionary.lookup', arguments: {} }, init.sessionId);
    expect(badCall.res.status).toBe(200);
    expect(JSON.stringify(badCall.payload)).toContain('isError');

    expect(bridge.revoke(created.token)).toBe(true);
    expect(bridge.revoke(created.token)).toBe(false);
    const after = await bridge.handleRequest(created.token, new Request('http://127.0.0.1/mcp'));
    expect(after.status).toBe(404);

    const second = bridge.create('u1', 'sess-2', [new DictionaryLookupTool(repo)]);
    expect(bridge.sweep(Date.now() + 31 * 60 * 1000)).toBe(1);
    expect(bridge.sweep()).toBe(0);
    void second;
    for (const item of repos.splice(0)) item.getRawDb().close();
  });
});

describe('GET /api/agent/runtimes', () => {
  it('id 与前端目录一致（＋custom 伪条目）；codex 配置态为布尔', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    try {
      const app = new Hono().route('/', createAgentRoutes({ repo, server: new GatewayServer(repo), port: 0 }));
      const res = await app.request('/api/agent/runtimes');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { runtimes: Array<{ id: string; label: string; hint: string; configured: boolean | null }> };
      expect(body.runtimes.map(entry => entry.id)).toEqual([...FRONTEND_RUNTIME_IDS, 'custom']);
      const codex = body.runtimes.find(entry => entry.id === 'codex-acp');
      expect(typeof codex?.configured).toBe('boolean');
      expect(typeof codex?.label).toBe('string');
      const custom = body.runtimes.find(entry => entry.id === 'custom');
      expect(custom?.label).toBe('自定义 API');
      expect(typeof custom?.configured).toBe('boolean');
    } finally {
      repo.getRawDb().close();
    }
  });

  it('provider 状态脱敏；非法保存 400 且不写盘', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    try {
      const app = new Hono().route('/', createAgentRoutes({ repo, server: new GatewayServer(repo), port: 0 }));
      const status = await app.request('/api/agent/provider');
      expect(status.status).toBe(200);
      const body = (await status.json()) as { provider: { configured?: boolean; hasApiKey?: boolean; apiKey?: string } };
      expect(typeof body.provider.configured).toBe('boolean');
      expect(body.provider.apiKey).toBeUndefined();
      expect(body.provider.hasApiKey).not.toBe(true);
      const bad = await app.request('/api/agent/provider', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: 'not-a-url', model: '', apiKey: '' }),
      });
      expect(bad.status).toBe(400);
    } finally {
      repo.getRawDb().close();
    }
  });
});
