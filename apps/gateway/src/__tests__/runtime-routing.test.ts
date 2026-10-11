import { describe, expect, it } from 'bun:test';
import { listAgentRuntimes, resolveSessionAdapterId, runtimeSupportsSessionTools } from '../runtime/router/runtime-catalog.js';
import { SessionToolBridge } from '../runtime/mcp/session-tool-bridge.js';
import { AcpAdapterPool } from '../infrastructure/acp/acp-adapter-pool.js';
import { ok } from '@study-studio/shared';

describe('resolveSessionAdapterId', () => {
  it('缺席/未知/留守 id 走 Codex；codex-acp 与已知运行时＋custom 走 ACP', () => {
    expect(resolveSessionAdapterId(undefined)).toBe('codex');
    expect(resolveSessionAdapterId('')).toBe('codex');
    expect(resolveSessionAdapterId('nope')).toBe('codex');
    expect(resolveSessionAdapterId('codex-appserver')).toBe('codex');
    expect(resolveSessionAdapterId('codex-acp')).toBe('acp');
    expect(resolveSessionAdapterId('deepseek')).toBe('acp');
    expect(resolveSessionAdapterId('claude')).toBe('acp');
    expect(resolveSessionAdapterId('custom')).toBe('acp');
  });
});

describe('listAgentRuntimes', () => {
  it('8 运行时齐全；codex 配置态为布尔', () => {
    const runtimes = listAgentRuntimes();
    expect(runtimes.map(entry => entry.id)).toEqual(
      ['codex-acp', 'claude', 'gemini', 'copilot', 'opencode', 'cursor-cli', 'deepseek', 'agy']);
    expect(typeof runtimes.find(entry => entry.id === 'codex-acp')?.configured).toBe('boolean');
  });

  it('能力开关：codex-acp 模型/思考深度走 ACP 探针（与会话同口径），其余 ACP 运行时全探针', () => {
    const runtimes = listAgentRuntimes();
    // codex-acp 会话跑在 ACP 上：App Server model/list 是另一套旧目录（曾漏 gpt-6.1-sol），
    // 故模型/思考深度必须取探针；Codex 原生面板（Skills/MCP/用量）无 ACP 对应物，不开；
    // 历史/队列走网关台账。配额类全协议无对应物（额度芯片仅逃生口径保留）。
    expect(runtimes.find(entry => entry.id === 'codex-acp')?.capabilities)
      .toEqual({ supportsModelPicker: false, supportsEffort: false, supportsThreads: false, supportsUsage: false, supportsHistory: true, supportsSessionTools: true });
    expect(runtimes.find(entry => entry.id === 'opencode')?.capabilities)
      .toEqual({ supportsModelPicker: false, supportsEffort: false, supportsThreads: false, supportsUsage: false, supportsHistory: true, supportsSessionTools: true });
    for (const entry of runtimes.filter(item => item.id !== 'codex-acp' && item.id !== 'opencode')) {
      expect(entry.capabilities).toEqual({ supportsModelPicker: false, supportsEffort: false, supportsThreads: false, supportsUsage: false, supportsHistory: true, supportsSessionTools: false });
    }
  });

  it('固定工具任务门禁：codex-acp/opencode 放行；agy/未知/custom/缺席一律拦截', () => {
    expect(runtimeSupportsSessionTools('codex-acp')).toBe(true);
    expect(runtimeSupportsSessionTools('opencode')).toBe(true);
    expect(runtimeSupportsSessionTools('agy')).toBe(false);
    expect(runtimeSupportsSessionTools('claude')).toBe(false);
    expect(runtimeSupportsSessionTools('custom')).toBe(false);
    expect(runtimeSupportsSessionTools('nope')).toBe(false);
    expect(runtimeSupportsSessionTools(undefined)).toBe(false);
    expect(runtimeSupportsSessionTools('')).toBe(false);
  });
});

describe('AcpAdapterPool', () => {
  it('同 runtime 单例复用；异 runtime 隔离；custom 可建（连接前不读钥）；closeAll 可重复调用', async () => {
    const bridge = new SessionToolBridge({
      execute: async () => ok(null),
      resolveBaseUrl: () => 'http://127.0.0.1:9',
    });
    const pool = new AcpAdapterPool({ bridge, workspaceRoot: process.cwd() });
    expect(pool.get('deepseek')).toBe(pool.get('deepseek'));
    expect(pool.get('deepseek')).not.toBe(pool.get('claude'));
    expect(pool.get('custom')).toBe(pool.get('custom'));
    await pool.closeAll('test');
    await pool.closeAll('test');
  });
});
