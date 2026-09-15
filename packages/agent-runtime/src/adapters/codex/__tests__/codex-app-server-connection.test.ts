import { describe, expect, it } from 'bun:test';
import {
  BusinessError,
  err,
  isOk,
  ok,
  type Result,
} from '@study-studio/shared';
import { CodexAppServerConnection } from '../app-server-client.js';
import {
  JsonRpcStdioClient,
  type JsonRpcRequest,
  type StdioClientOptions,
} from '../jsonrpc-stdio.js';

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

/**
 * Test-only transport double. It extends the production client so the
 * connection still exercises its real lifecycle and handler wiring logic;
 * only the OS process and JSONL transport are replaced.
 */
class FakeRpcClient extends JsonRpcStdioClient {
  public startCalls = 0;
  public initializeCalls = 0;
  public notifyCalls = 0;
  public closeCalls = 0;
  public serverRequestRegistrations = 0;
  public startGate: Promise<void> | null = null;
  public initializeError: BusinessError | null = null;
  public notifyError: BusinessError | null = null;

  private connected = false;
  private readonly registeredHandlers: Array<
    (request: JsonRpcRequest) => Promise<unknown> | unknown
  > = [];

  public override get isConnected(): boolean {
    return this.connected;
  }

  public override async start(
    _options: StdioClientOptions
  ): Promise<Result<void, BusinessError>> {
    this.startCalls++;
    if (this.startGate) await this.startGate;
    this.connected = true;
    return ok(undefined);
  }

  public override async request<T = unknown>(
    method: string,
    _params?: unknown,
    _timeoutMs?: number
  ): Promise<Result<T, BusinessError>> {
    if (method !== 'initialize') return ok(undefined as T);
    this.initializeCalls++;
    if (this.initializeError) return err(this.initializeError);
    return ok({} as T);
  }

  public override notify(
    _method: string,
    _params?: unknown
  ): Result<void, BusinessError> {
    this.notifyCalls++;
    if (this.notifyError) return err(this.notifyError);
    return ok(undefined);
  }

  public override onServerRequest(
    handler: (request: JsonRpcRequest) => Promise<unknown> | unknown
  ): () => void {
    this.serverRequestRegistrations++;
    this.registeredHandlers.push(handler);
    return () => undefined;
  }

  public override async close(): Promise<Result<void, BusinessError>> {
    this.closeCalls++;
    this.connected = false;
    return ok(undefined);
  }

  public get registeredServerRequestHandlerCount(): number {
    return this.registeredHandlers.length;
  }

  public get isTransportConnected(): boolean {
    return this.connected;
  }
}

function createConnection(rpc: FakeRpcClient): CodexAppServerConnection {
  const connection = new CodexAppServerConnection({ enabled: true, command: 'test-codex' });

  // `rpc` is an intentional @internal test seam exposed by the production
  // class for query modules. Replacing the concrete transport here keeps the
  // test type-safe without spawning a real Codex process or changing runtime code.
  Object.defineProperty(connection, 'rpc', { configurable: true, value: rpc });
  return connection;
}

function connectError(message: string): BusinessError {
  return new BusinessError('E_TEST_CONNECT', message, 'AGENT_RUNTIME', true);
}

describe('CodexAppServerConnection lifecycle', () => {
  it('coalesces concurrent connect calls into one start and initialize', async () => {
    const rpc = new FakeRpcClient();
    const gate = deferred<void>();
    rpc.startGate = gate.promise;
    const connection = createConnection(rpc);

    const pending = Array.from({ length: 10 }, () => connection.connect());
    await Promise.resolve();

    expect(rpc.startCalls).toBe(1);
    expect(rpc.initializeCalls).toBe(0);

    gate.resolve(undefined);
    const results = await Promise.all(pending);

    expect(results.every(isOk)).toBe(true);
    expect(rpc.startCalls).toBe(1);
    expect(rpc.initializeCalls).toBe(1);
    expect(rpc.notifyCalls).toBe(1);
    expect(rpc.serverRequestRegistrations).toBe(1);
    expect(rpc.registeredServerRequestHandlerCount).toBe(1);

    await connection.close();
  });

  it('does not install the server request handler again after initialize retry', async () => {
    const rpc = new FakeRpcClient();
    rpc.initializeError = connectError('initialize failed');
    const connection = createConnection(rpc);

    const first = await connection.connect();
    expect(isOk(first)).toBe(false);
    expect(rpc.closeCalls).toBe(1);
    expect(rpc.isTransportConnected).toBe(false);

    rpc.initializeError = null;
    const second = await connection.connect();

    expect(isOk(second)).toBe(true);
    expect(rpc.startCalls).toBe(2);
    expect(rpc.initializeCalls).toBe(2);
    expect(rpc.serverRequestRegistrations).toBe(1);
    expect(rpc.registeredServerRequestHandlerCount).toBe(1);

    await connection.close();
  });

  it('closes the transport when initialize fails', async () => {
    const rpc = new FakeRpcClient();
    rpc.initializeError = connectError('initialize failed');
    const connection = createConnection(rpc);

    const result = await connection.connect();

    expect(isOk(result)).toBe(false);
    expect(rpc.closeCalls).toBe(1);
    expect(rpc.isTransportConnected).toBe(false);
  });

  it('closes the transport when initialized notification fails', async () => {
    const rpc = new FakeRpcClient();
    rpc.notifyError = connectError('initialized notification failed');
    const connection = createConnection(rpc);

    const result = await connection.connect();

    expect(isOk(result)).toBe(false);
    expect(rpc.closeCalls).toBe(1);
    expect(rpc.isTransportConnected).toBe(false);
  });
});
