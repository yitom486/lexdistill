import { describe, expect, it } from 'bun:test';
import {
  BusinessError,
  err,
  isOk,
  ok,
  type Result,
} from '@study-studio/shared';
import { CodexAdapter } from '../codex-adapter.js';
import type { CodexAppServerConnection } from '../app-server-client.js';
import type { CodexModelInfo } from '../app-server-protocol.js';

/**
 * 启动期并发竞态回归（Codex 模型刷新超时根因）。
 *
 * 聊天面板挂载时 status/models/threads/collab/skills/rateLimits/mcp 多路
 * 并发进入 ensureConnection：旧实现每路各 new 一个连接 → N 个 Codex 子进程
 * 同时刷新模型（failed to refresh available models / timeout waiting for
 * child process to exit）。本文件锁定：并发只 spawn 一次、失败不缓存且
 * 关半启动连接、getAccountStatus 失败零 spawn。
 */

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

class CountingConn {
  connectCalls = 0;
  closeCalls = 0;
  listCalls = 0;
  gate: Promise<void> | null = null;
  connectError: BusinessError | null = null;

  async connect(): Promise<Result<void, BusinessError>> {
    this.connectCalls++;
    if (this.gate) await this.gate;
    if (this.connectError) return err(this.connectError);
    return ok(undefined);
  }

  async close(): Promise<Result<void, BusinessError>> {
    this.closeCalls++;
    return ok(undefined);
  }

  async listModels(): Promise<Result<CodexModelInfo[], BusinessError>> {
    this.listCalls++;
    return ok([]);
  }

  asConnection(): CodexAppServerConnection {
    return this as unknown as CodexAppServerConnection;
  }
}

class SingleflightAdapter extends CodexAdapter {
  createCalls = 0;

  constructor(private readonly conn: CountingConn) {
    super({});
  }

  protected override createConnection(): CodexAppServerConnection {
    this.createCalls++;
    return this.conn.asConnection();
  }
}

describe('CodexAdapter ensureConnection single-flight', () => {
  it('10 路并发 listModels 只 connect 一次且共享同一连接', async () => {
    const conn = new CountingConn();
    const gate = deferred();
    conn.gate = gate.promise;
    const adapter = new SingleflightAdapter(conn);

    const pending = Array.from({ length: 10 }, () => adapter.listModels());
    // 放行前让 10 路全部进入 ensureConnection（首路已在门后等待）。
    await new Promise((r) => setTimeout(r, 10));
    expect(conn.connectCalls).toBe(1);
    expect(adapter.createCalls).toBe(1);

    gate.resolve();
    const results = await Promise.all(pending);
    for (const res of results) {
      expect(isOk(res)).toBe(true);
    }
    expect(conn.listCalls).toBe(10);
    // 连接已回填：后续调用不再 create/connect。
    const again = await adapter.listModels();
    expect(isOk(again)).toBe(true);
    expect(conn.connectCalls).toBe(1);
    expect(adapter.createCalls).toBe(1);
  });

  it('connect 失败不缓存：半启动连接被关闭，下次调用重新尝试', async () => {
    const conn = new CountingConn();
    conn.connectError = new BusinessError(
      'E_TEST_CONNECT',
      '测试用连接失败',
      'AGENT_RUNTIME',
      true
    );
    const adapter = new SingleflightAdapter(conn);

    const first = await adapter.listModels();
    expect(isOk(first)).toBe(false);
    const second = await adapter.listModels();
    expect(isOk(second)).toBe(false);
    expect(conn.connectCalls).toBe(2);
    expect(adapter.createCalls).toBe(2);
    // 每次失败的半启动连接都被就地关闭，不留孤儿。
    expect(conn.closeCalls).toBe(2);
  });

  it('getAccountStatus 连接失败时零 spawn：直接返回未联动状态', async () => {
    const conn = new CountingConn();
    conn.connectError = new BusinessError(
      'E_TEST_CONNECT',
      '测试用连接失败',
      'AGENT_RUNTIME',
      true
    );
    const adapter = new SingleflightAdapter(conn);

    const res = await adapter.getAccountStatus();
    expect(isOk(res)).toBe(true);
    if (isOk(res)) {
      expect(res.value.linked).toBe(false);
      expect(res.value.requiresOpenaiAuth).toBe(true);
      expect(res.value.message).toContain('测试用连接失败');
    }
    // 只有 ensureConnection 的一次尝试：旧 fallback 的第二个连接已消除。
    expect(adapter.createCalls).toBe(1);
    expect(conn.closeCalls).toBe(1);
  });
});
