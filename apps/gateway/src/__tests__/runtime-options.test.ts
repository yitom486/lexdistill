import { describe, expect, it } from 'bun:test';
import type { AcpClient } from '@yitom/acp-client';
import { clearRuntimeOptionsCacheForTest, getAgentRuntimeOptions } from '../runtime/router/runtime-options.js';
import { SessionToolBridge } from '../runtime/mcp/session-tool-bridge.js';
import { AcpAdapterPool, acpClientHonorsCustomEnv } from '../infrastructure/acp/acp-adapter-pool.js';
import { ok } from '@study-studio/shared';

describe('getAgentRuntimeOptions', () => {
  it('未知运行时如实返回空＋error，不抛；二次命中缓存', async () => {
    clearRuntimeOptionsCacheForTest();
    const first = await getAgentRuntimeOptions('no-such-runtime', {
      createClient: () => { throw new Error('未知或未注册的 ACP 运行时模板'); },
    });
    expect(first.models).toEqual([]);
    expect(first.efforts).toEqual([]);
    expect(typeof first.error).toBe('string');
    const second = await getAgentRuntimeOptions('no-such-runtime', {
      createClient: () => { throw new Error('不应第二次创建客户端'); },
    });
    expect(second).toEqual(first);
  });
});

describe('getAgentRuntimeOptions 方言委托', () => {
  const fakeClient = (configOptions: unknown): AcpClient => ({
    connect: async () => ({ ok: true as const, value: { status: 'connected', init: {} } }),
    createSession: async () => ({
      ok: true as const,
      value: { sessionId: 'probe', configOptions },
    }),
    disconnect: async () => undefined,
  }) as unknown as AcpClient;

  it('configId＋连字符 effort 方言命中（旧手搓 id 精确匹配会漏）', async () => {
    clearRuntimeOptionsCacheForTest();
    const result = await getAgentRuntimeOptions('dialect-a', {
      createClient: () => fakeClient([
        { configId: 'model', name: 'Model', options: [{ value: '6.1 Sol', name: '6.1 Sol' }] },
        { configId: 'reasoning-effort', name: 'Effort', options: [{ value: 'xhigh', name: 'Xhigh' }] },
      ]),
    });
    expect(result.models).toEqual([{ value: '6.1 Sol', label: '6.1 Sol' }]);
    expect(result.efforts).toEqual(['xhigh']);
    expect(result.error).toBeUndefined();
  });

  it('id 字段变体＋category 定位命中', async () => {
    clearRuntimeOptionsCacheForTest();
    const result = await getAgentRuntimeOptions('dialect-b', {
      createClient: () => fakeClient([
        { id: 'model', options: [{ value: 'm1' }] },
        { configId: 'picker', category: 'model', options: [{ value: 'm2', name: 'M2' }] },
      ]),
    });
    // category 优先于 configId 命中（SDK 规则），取到 M2
    expect(result.models).toEqual([{ value: 'm2', label: 'M2' }]);
  });

  it('空 configOptions 如实回空列表（非失败，无 error）', async () => {
    clearRuntimeOptionsCacheForTest();
    const result = await getAgentRuntimeOptions('dialect-c', {
      createClient: () => fakeClient([]),
    });
    expect(result.models).toEqual([]);
    expect(result.efforts).toEqual([]);
    expect(result.error).toBeUndefined();
  });
});

describe('acpClientHonorsCustomEnv', () => {  it('0.1.0 忽略 env→false；0.1.1 起→true；未知/非法版本不拦', () => {
    expect(acpClientHonorsCustomEnv('0.1.0')).toBe(false);
    expect(acpClientHonorsCustomEnv('0.1.1')).toBe(true);
    expect(acpClientHonorsCustomEnv('0.2.0')).toBe(true);
    expect(acpClientHonorsCustomEnv('1.0.0')).toBe(true);
    expect(acpClientHonorsCustomEnv(null)).toBe(true);
    expect(acpClientHonorsCustomEnv('dev')).toBe(true);
  });
});

describe('AcpAdapterPool.getRuntimeOptions custom', () => {
  it('未配置/旧 SDK 时如实回空＋error，不 spawn（离线可跑）', async () => {
    clearRuntimeOptionsCacheForTest();
    const bridge = new SessionToolBridge({
      execute: async () => ok(null),
      resolveBaseUrl: () => 'http://127.0.0.1:9',
    });
    const pool = new AcpAdapterPool({ bridge, workspaceRoot: process.cwd() });
    const result = await pool.getRuntimeOptions('custom');
    expect(result.models).toEqual([]);
    expect(result.efforts).toEqual([]);
    expect(typeof result.error).toBe('string');
    await pool.closeAll('test');
  });
});
