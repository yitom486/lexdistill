import { describe, expect, it } from 'bun:test';
import { listAgentRuntimes, resolveSessionAdapterId } from '../runtime/router/runtime-catalog.js';
import { SessionToolBridge } from '../runtime/mcp/session-tool-bridge.js';
import { AcpAdapterPool } from '../infrastructure/acp/acp-adapter-pool.js';
import { ok } from '@study-studio/shared';

describe('resolveSessionAdapterId', () => {
  it('缺席/codex-acp/未知走 Codex（默认行为不变）；已知其他＋custom 走 ACP', () => {
    expect(resolveSessionAdapterId(undefined)).toBe('codex');
    expect(resolveSessionAdapterId('')).toBe('codex');
    expect(resolveSessionAdapterId('codex-acp')).toBe('codex');
    expect(resolveSessionAdapterId('nope')).toBe('codex');
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

  it('能力开关：codex 全开，其余关闭（无硬编码特例，统一走开关）', () => {
    const runtimes = listAgentRuntimes();
    expect(runtimes.find(entry => entry.id === 'codex-acp')?.capabilities)
      .toEqual({ supportsModelPicker: true, supportsEffort: true });
    for (const entry of runtimes.filter(item => item.id !== 'codex-acp')) {
      expect(entry.capabilities).toEqual({ supportsModelPicker: false, supportsEffort: false });
    }
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
