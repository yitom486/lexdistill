import { describe, expect, it } from 'bun:test';
import { isOk } from '@lexdistill/shared';
import { resolveAcpPoolAgent } from '../acp-pool-agent.js';

describe('resolveAcpPoolAgent（只读 acp-client 决议，不分支厂商）', () => {
  it('未知运行时直接判停，不触达 spawn', async () => {
    const res = await resolveAcpPoolAgent('nope', { cwd: process.cwd() });
    expect(isOk(res)).toBe(false);
    if (!isOk(res)) expect(res.error.code).toBe('E_ACP_RUNTIME_UNKNOWN');
  });

  it('codex-acp 走本地 pin（与聊天池同一发行版）', async () => {
    const res = await resolveAcpPoolAgent('codex-acp', { cwd: process.cwd(), model: 'm-x' });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.program.length).toBeGreaterThan(0);
    expect(res.value.args.length).toBeGreaterThan(0);
    expect(res.value.args[0]).toMatch(/codex-acp/);
    expect(res.value.cwd).toBe(process.cwd());
    expect(res.value.model).toBe('m-x');
    expect(typeof res.value.env).toBe('object');
  });

  it('opencode 决议出可执行启动信息（不拉进程）', async () => {
    const res = await resolveAcpPoolAgent('opencode', { cwd: process.cwd() });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.program.length).toBeGreaterThan(0);
    expect(res.value.args.length).toBeGreaterThan(0);
  });
});
