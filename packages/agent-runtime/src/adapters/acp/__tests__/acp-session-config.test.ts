import { describe, expect, it } from 'bun:test';
import { AcpAdapter, AcpAgentSession } from '../acp-adapter.js';
import type { AcpClientLike, AcpSessionHandleLike } from '../acp-adapter.js';

function trackHandle(configOptions: unknown, failIds: string[] = []): AcpSessionHandleLike & { calls: Array<{ id: string; value: string | boolean }> } {
  const calls: Array<{ id: string; value: string | boolean }> = [];
  return {
    sessionId: 'acp-sess-cfg',
    configOptions,
    prompt: async () => ({ ok: true as const, value: 'DONE' }),
    setConfigOption: async (id: string, value: string | boolean) => {
      calls.push({ id, value });
      if (failIds.includes(id)) return { ok: false as const, error: { code: 'E_UNKNOWN_OPTION', message: `unknown config option: ${id}` } };
      return { ok: true as const, value: 'ok' };
    },
    calls,
  };
}

function makeAdapter(handle: AcpSessionHandleLike, describeConfigIds?: (configOptions: unknown) => { model: string | null; effort: string | null }): AcpAdapter {
  const client: AcpClientLike = {
    connect: async () => ({ ok: true as const, value: {} }),
    createSession: async () => ({ ok: true as const, value: handle }),
    disconnect: async () => undefined,
  };
  return new AcpAdapter({
    createClient: () => client,
    buildMcpServers: () => [],
    ...(describeConfigIds ? { describeConfigIds } : {}),
  });
}

const SESSION_OPTS = { sessionId: 's1', userId: 'u1', model: 'm-x', effort: 'high' };

describe('AcpAdapter 建会话 configId 发现＋偏好降级', () => {
  it('用发现的真实 id 设置（连字符方言），成功无警告', async () => {
    const handle = trackHandle([{ configId: 'reasoning-effort', options: [{ value: 'high' }] }]);
    const adapter = makeAdapter(handle, () => ({ model: 'model', effort: 'reasoning-effort' }));
    const res = await adapter.createSession({ ...SESSION_OPTS });
    expect(res.ok).toBe(true);
    expect(handle.calls).toEqual([
      { id: 'model', value: 'm-x' },
      { id: 'reasoning-effort', value: 'high' },
    ]);
    if (res.ok) {
      expect((res.value as AcpAgentSession).drainSetupWarnings()).toEqual([]);
    }
    await adapter.shutdown('test');
  });

  it('无 effort 选项：跳过设置＋警告，会话照常建成（OpenCode 案）', async () => {
    const handle = trackHandle([{ configId: 'model', options: [{ value: 'm-x' }] }]);
    const adapter = makeAdapter(handle, () => ({ model: 'model', effort: null }));
    const res = await adapter.createSession({ ...SESSION_OPTS });
    expect(res.ok).toBe(true);
    expect(handle.calls).toEqual([{ id: 'model', value: 'm-x' }]);
    if (res.ok) {
      const warnings = (res.value as AcpAgentSession).drainSetupWarnings();
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain('high');
      expect((res.value as AcpAgentSession).drainSetupWarnings()).toEqual([]);
    }
    await adapter.shutdown('test');
  });

  it('设置被拒：降级警告，会话照常建成（不炸整轮）', async () => {
    const handle = trackHandle([], ['model', 'reasoning_effort']);
    const adapter = makeAdapter(handle);
    const res = await adapter.createSession({ ...SESSION_OPTS });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const warnings = (res.value as AcpAgentSession).drainSetupWarnings();
      expect(warnings.length).toBe(2);
      expect(warnings.some(w => w.includes('m-x'))).toBe(true);
      expect(warnings.some(w => w.includes('high'))).toBe(true);
    }
    await adapter.shutdown('test');
  });

  it('无注入器：回落 legacy id（model/reasoning_effort，旧单测行为不变）', async () => {
    const handle = trackHandle([]);
    const adapter = makeAdapter(handle);
    const res = await adapter.createSession({ ...SESSION_OPTS });
    expect(res.ok).toBe(true);
    expect(handle.calls).toEqual([
      { id: 'model', value: 'm-x' },
      { id: 'reasoning_effort', value: 'high' },
    ]);
    await adapter.shutdown('test');
  });
});
