import { describe, expect, it } from 'bun:test';
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

describe('acpClientHonorsCustomEnv', () => {
  it('0.1.0 忽略 env→false；0.1.1 起→true；未知/非法版本不拦', () => {
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
