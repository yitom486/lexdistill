import { describe, expect, it } from 'bun:test';
import {
  BusinessError,
  err,
  isOk,
  ok,
  type Result,
} from '@study-studio/shared';
import type { CodexAppServerConnection } from '../app-server-client.js';
import { CodexConnectionManager } from '../codex-connection-manager.js';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

type FakeConnectionOptions = {
  connectGate?: Promise<void>;
  connectResult?: Result<void, BusinessError>;
  closeResult?: Result<void, BusinessError>;
};

class FakeConnection {
  public connectCalls = 0;
  public closeCalls = 0;

  private readonly connectGate: Promise<void> | null;
  private readonly connectResult: Result<void, BusinessError>;
  private readonly closeResult: Result<void, BusinessError>;

  public constructor(options: FakeConnectionOptions = {}) {
    this.connectGate = options.connectGate ?? null;
    this.connectResult = options.connectResult ?? ok(undefined);
    this.closeResult = options.closeResult ?? ok(undefined);
  }

  public async connect(): Promise<Result<void, BusinessError>> {
    this.connectCalls++;
    if (this.connectGate) await this.connectGate;
    return this.connectResult;
  }

  public async close(): Promise<Result<void, BusinessError>> {
    this.closeCalls++;
    return this.closeResult;
  }

  public asConnection(): CodexAppServerConnection {
    return this as unknown as CodexAppServerConnection;
  }
}

function connectionError(message: string): BusinessError {
  return new BusinessError('E_TEST_CONNECT', message, 'AGENT_RUNTIME', true);
}

describe('CodexConnectionManager lifecycle', () => {
  it('10 路并发 getOrConnect 只创建并连接一次，且共享同一连接', async () => {
    const gate = deferred<void>();
    const connection = new FakeConnection({ connectGate: gate.promise });
    let factoryCalls = 0;
    const manager = new CodexConnectionManager({
      createConnection: () => {
        factoryCalls++;
        return connection.asConnection();
      },
    });

    const pending = Array.from({ length: 10 }, () => manager.getOrConnect());

    expect(factoryCalls).toBe(1);
    expect(connection.connectCalls).toBe(1);
    expect(pending.every((result) => result === pending[0])).toBe(true);

    gate.resolve(undefined);
    const results = await Promise.all(pending);

    for (const result of results) {
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.value).toBe(connection.asConnection());
    }
    expect(factoryCalls).toBe(1);
    expect(connection.connectCalls).toBe(1);
  });

  it('连接失败由并发调用共享、不缓存，并关闭失败连接', async () => {
    const gate = deferred<void>();
    const failed = new FakeConnection({
      connectGate: gate.promise,
      connectResult: err(connectionError('连接失败')),
    });
    const recovered = new FakeConnection();
    const connections = [failed, recovered];
    let factoryCalls = 0;
    const manager = new CodexConnectionManager({
      createConnection: () => {
        factoryCalls++;
        const next = connections.shift();
        if (!next) throw new Error('unexpected extra connection');
        return next.asConnection();
      },
    });

    const pending = Array.from({ length: 10 }, () => manager.getOrConnect());
    expect(factoryCalls).toBe(1);
    expect(failed.connectCalls).toBe(1);

    gate.resolve(undefined);
    const failedResults = await Promise.all(pending);
    for (const result of failedResults) {
      expect(isOk(result)).toBe(false);
      if (!isOk(result)) expect(result.error.code).toBe('E_TEST_CONNECT');
    }
    expect(failed.closeCalls).toBe(1);

    const retry = await manager.getOrConnect();
    expect(isOk(retry)).toBe(true);
    expect(factoryCalls).toBe(2);
    expect(recovered.connectCalls).toBe(1);
    expect(recovered.closeCalls).toBe(0);
  });

  it('shutdown 与在途 connect 交错时旧代不回填，返回前 candidate 已关闭', async () => {
    const gate = deferred<void>();
    const candidate = new FakeConnection({ connectGate: gate.promise });
    const manager = new CodexConnectionManager({
      createConnection: () => candidate.asConnection(),
    });

    const oldConnection = manager.getOrConnect();
    const shutdown = manager.shutdown();
    const duringShutdown = await manager.getOrConnect();

    expect(isOk(duringShutdown)).toBe(false);
    if (!isOk(duringShutdown)) expect(duringShutdown.error.code).toBe('E_CODEX_CLOSED');
    expect(candidate.closeCalls).toBe(1);

    gate.resolve(undefined);
    const [oldResult, shutdownResult] = await Promise.all([oldConnection, shutdown]);

    expect(isOk(oldResult)).toBe(false);
    if (!isOk(oldResult)) expect(oldResult.error.code).toBe('E_CODEX_CLOSED');
    expect(isOk(shutdownResult)).toBe(true);
    expect(candidate.closeCalls).toBe(1);
  });

  it('shutdown 完成后允许建立新代，且新请求不复用旧 candidate', async () => {
    const gate = deferred<void>();
    const oldConnection = new FakeConnection({ connectGate: gate.promise });
    const newConnection = new FakeConnection();
    const connections = [oldConnection, newConnection];
    let factoryCalls = 0;
    const manager = new CodexConnectionManager({
      createConnection: () => {
        factoryCalls++;
        const next = connections.shift();
        if (!next) throw new Error('unexpected extra connection');
        return next.asConnection();
      },
    });

    const oldResultPromise = manager.getOrConnect();
    const shutdown = manager.shutdown();
    gate.resolve(undefined);
    await Promise.all([oldResultPromise, shutdown]);

    const newResult = await manager.getOrConnect();
    expect(isOk(newResult)).toBe(true);
    if (isOk(newResult)) expect(newResult.value).toBe(newConnection.asConnection());
    expect(factoryCalls).toBe(2);
    expect(oldConnection.closeCalls).toBe(1);
    expect(newConnection.connectCalls).toBe(1);
  });

  it('并发 shutdown 共享同一 Promise，且同一连接只 close 一次', async () => {
    const connection = new FakeConnection();
    const manager = new CodexConnectionManager({
      createConnection: () => {
        throw new Error('factory must not be used');
      },
      initialConnection: connection.asConnection(),
    });

    const first = manager.shutdown();
    const second = manager.shutdown();

    expect(second).toBe(first);
    const results = await Promise.all([first, second]);
    expect(results.every(isOk)).toBe(true);
    expect(connection.closeCalls).toBe(1);
  });

  it('A→B 重连使用不同的物理连接身份', async () => {
    const first = new FakeConnection();
    const second = new FakeConnection();
    const connections = [first, second];
    const manager = new CodexConnectionManager({
      createConnection: () => {
        const next = connections.shift();
        if (!next) throw new Error('unexpected extra connection');
        return next.asConnection();
      },
    });

    const firstResult = await manager.getOrConnect();
    expect(isOk(firstResult)).toBe(true);
    await manager.shutdown();
    const secondResult = await manager.getOrConnect();

    expect(isOk(secondResult)).toBe(true);
    if (isOk(firstResult) && isOk(secondResult)) {
      expect(firstResult.value).toBe(first.asConnection());
      expect(secondResult.value).toBe(second.asConnection());
      expect(secondResult.value).not.toBe(firstResult.value);
    }
    expect(first.closeCalls).toBe(1);
    expect(second.connectCalls).toBe(1);
  });

  it('注入 initialConnection 不调用 factory，也不触发 connect/spawn', async () => {
    const initial = new FakeConnection();
    let factoryCalls = 0;
    const manager = new CodexConnectionManager({
      createConnection: () => {
        factoryCalls++;
        return new FakeConnection().asConnection();
      },
      initialConnection: initial.asConnection(),
    });

    const result = await manager.getOrConnect();

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value).toBe(initial.asConnection());
    expect(factoryCalls).toBe(0);
    expect(initial.connectCalls).toBe(0);
  });

  it('createConnection 抛异常时返回翻译后的 BusinessError', async () => {
    const manager = new CodexConnectionManager({
      createConnection: () => {
        throw new Error('factory exploded');
      },
    });

    const result = await manager.getOrConnect();

    expect(isOk(result)).toBe(false);
    if (!isOk(result)) {
      expect(result.error).toBeInstanceOf(BusinessError);
      expect(result.error.code).toBe('E_UNKNOWN_INTERNAL');
      expect(result.error.category).toBe('INTERNAL');
      expect(result.error.userMessage).toContain('factory exploded');
    }
  });

  it('close 失败时阻止新的 factory/spawn，直到后续 shutdown 重试', async () => {
    const closeError = new BusinessError(
      'E_TEST_CLOSE',
      'close failed',
      'AGENT_RUNTIME',
      true
    );
    const initial = new FakeConnection({ closeResult: err(closeError) });
    let factoryCalls = 0;
    const manager = new CodexConnectionManager({
      createConnection: () => {
        factoryCalls++;
        return new FakeConnection().asConnection();
      },
      initialConnection: initial.asConnection(),
    });

    const shutdown = await manager.shutdown();
    expect(isOk(shutdown)).toBe(false);
    expect(initial.closeCalls).toBe(1);

    const blocked = await manager.getOrConnect();
    expect(isOk(blocked)).toBe(false);
    if (!isOk(blocked)) expect(blocked.error.code).toBe('E_TEST_CLOSE');
    expect(factoryCalls).toBe(0);
  });
});
