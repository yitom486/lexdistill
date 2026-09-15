/**
 * Codex App Server JSON-RPC over stdio (JSONL)。
 * 官方：`codex app-server` 默认 `--listen stdio://`。
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import {
  ok,
  err,
  type Result,
  BusinessError,
  extractErrorText,
  logger,
  translateToBusinessError,
} from '@study-studio/shared';

const CODEX_CLOSE_TIMEOUT_MS = 15_000;

export type JsonRpcId = number | string;

export interface JsonRpcRequest {
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcErrorMessage {
  id: JsonRpcId | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcInbound =
  | JsonRpcSuccess
  | JsonRpcErrorMessage
  | JsonRpcNotification
  | (JsonRpcRequest & { method: string });

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: BusinessError) => void;
};

export interface StdioClientOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export class JsonRpcStdioClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private childExitPromise: Promise<void> | null = null;
  private closeAttempt: Promise<Result<void, BusinessError>> | null = null;
  private nextId = 1;
  private readonly pending = new Map<string, Pending>();
  private readonly notificationHandlers = new Set<(msg: JsonRpcNotification) => void>();
  private readonly serverRequestHandlers = new Set<
    (req: JsonRpcRequest) => Promise<unknown> | unknown
  >();
  private closed = false;

  public async start(options: StdioClientOptions): Promise<Result<void, BusinessError>> {
    if (this.child) {
      return err(
        new BusinessError('E_CODEX_ALREADY_STARTED', 'Codex App Server 进程已启动。', 'AGENT_RUNTIME')
      );
    }
    try {
      const child = spawn(options.command, options.args ?? ['app-server', '--listen', 'stdio://'], {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      this.child = child;
      this.closed = false;
      this.closeAttempt = null;
      this.childExitPromise = new Promise<void>((resolve) => {
        let settled = false;
        const settle = (): void => {
          if (settled) return;
          settled = true;
          resolve();
        };
        child.once('exit', settle);
        child.once('error', settle);
      });

      const rl = createInterface({ input: child.stdout });
      rl.on('line', (line) => {
        void this.onLine(line);
      });

      child.stderr.on('data', (buf: Buffer) => {
        const text = buf.toString('utf8').trim();
        if (text) {
          // stderr 常含启动日志；不中断会话（截断后走统一诊断通道）
          logger.warn('[codex-app-server]', { stderr: text.slice(0, 400) });
        }
      });

      child.on('exit', (code, signal) => {
        this.failAll(
          new BusinessError(
            'E_CODEX_PROCESS_EXIT',
            `Codex App Server 已退出（code=${code}, signal=${signal ?? 'none'}）。`,
            'AGENT_RUNTIME',
            true
          )
        );
        this.child = null;
      });

      child.on('error', (e) => {
        this.failAll(translateToBusinessError(e, 'CODEX_SPAWN'));
        this.child = null;
      });

      return ok(undefined);
    } catch (e) {
      return err(translateToBusinessError(e, 'CODEX_SPAWN'));
    }
  }

  public onNotification(handler: (msg: JsonRpcNotification) => void): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  public onServerRequest(
    handler: (req: JsonRpcRequest) => Promise<unknown> | unknown
  ): () => void {
    this.serverRequestHandlers.add(handler);
    return () => this.serverRequestHandlers.delete(handler);
  }

  public async request<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs = 120_000
  ): Promise<Result<T, BusinessError>> {
    if (!this.child?.stdin.writable) {
      return err(
        new BusinessError(
          'E_CODEX_NOT_CONNECTED',
          '尚未连接 Codex App Server，请确认本机已安装并登录 Codex CLI。',
          'AGENT_RUNTIME',
          true
        )
      );
    }
    const id = this.nextId++;
    const key = String(id);
    const payload = { id, method, ...(params !== undefined ? { params } : {}) };

    try {
      const result = await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(key);
          reject(
            new BusinessError(
              'E_CODEX_TIMEOUT',
              `Codex 请求超时：${method}`,
              'AGENT_RUNTIME',
              true
            )
          );
        }, timeoutMs);

        this.pending.set(key, {
          resolve: (v) => {
            clearTimeout(timer);
            resolve(v);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });

        this.write(payload);
      });
      return ok(result as T);
    } catch (e) {
      if (e instanceof BusinessError) return err(e);
      return err(translateToBusinessError(e, `CODEX_REQUEST:${method}`));
    }
  }

  public notify(method: string, params?: unknown): Result<void, BusinessError> {
    try {
      this.write({ method, ...(params !== undefined ? { params } : {}) });
      return ok(undefined);
    } catch (e) {
      return err(translateToBusinessError(e, 'CODEX_NOTIFY'));
    }
  }

  public respond(id: JsonRpcId, result: unknown): Result<void, BusinessError> {
    try {
      this.write({ id, result });
      return ok(undefined);
    } catch (e) {
      return err(translateToBusinessError(e, 'CODEX_RESPOND'));
    }
  }

  public respondError(
    id: JsonRpcId,
    code: number,
    message: string
  ): Result<void, BusinessError> {
    try {
      this.write({ id, error: { code, message } });
      return ok(undefined);
    } catch (e) {
      return err(translateToBusinessError(e, 'CODEX_RESPOND_ERROR'));
    }
  }

  public async close(): Promise<Result<void, BusinessError>> {
    if (this.closeAttempt) return this.closeAttempt;

    const attempt = this.closeInner();
    this.closeAttempt = attempt;
    attempt.then((result) => {
      if (!result.ok && this.closeAttempt === attempt) this.closeAttempt = null;
    });
    return attempt;
  }

  private async closeInner(): Promise<Result<void, BusinessError>> {
    this.closed = true;
    this.failAll(
      new BusinessError('E_CODEX_CLOSED', 'Codex App Server 连接已关闭。', 'AGENT_RUNTIME')
    );
    const child = this.child;
    if (!child) return ok(undefined);

    try {
      if (child.exitCode === null && child.signalCode === null) {
        if (child.stdin.writable) child.stdin.end();
        if (!child.killed) child.kill();
      }

      const exited = await this.waitForChildExit(child, CODEX_CLOSE_TIMEOUT_MS);
      if (!exited) {
        return err(
          new BusinessError(
            'E_CODEX_CLOSE_TIMEOUT',
            'Codex App Server 关闭超时，系统未继续启动新的连接，请稍后重试。',
            'AGENT_RUNTIME',
            true,
            { pid: child.pid }
          )
        );
      }
      if (this.child === child) this.child = null;
      return ok(undefined);
    } catch (e) {
      return err(translateToBusinessError(e, 'CODEX_CLOSE'));
    }
  }

  private async waitForChildExit(
    child: ChildProcessWithoutNullStreams,
    timeoutMs: number
  ): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) return true;
    const exitPromise = this.childExitPromise;
    if (!exitPromise) return true;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const exited = await Promise.race([exitPromise.then(() => true), timeout]);
    if (timer) clearTimeout(timer);
    return exited;
  }

  private write(obj: unknown): void {
    if (!this.child?.stdin.writable) {
      throw new BusinessError('E_CODEX_NOT_CONNECTED', 'Codex stdin 不可写。', 'AGENT_RUNTIME', true);
    }
    this.child.stdin.write(`${JSON.stringify(obj)}\n`);
  }

  private async onLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: unknown;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return;
    }

    if (msg && typeof msg === 'object' && 'id' in msg && 'method' in msg) {
      // Server → Client request
      const req = msg as JsonRpcRequest;
      for (const handler of this.serverRequestHandlers) {
        try {
          const result = await handler(req);
          this.respond(req.id, result ?? {});
          return;
        } catch (e) {
          const be =
            e instanceof BusinessError
              ? e
              : translateToBusinessError(e, `CODEX_SERVER_REQ:${req.method}`);
          this.respondError(req.id, -32000, be.userMessage || be.message);
          return;
        }
      }
      this.respondError(req.id, -32601, `Unhandled server request: ${req.method}`);
      return;
    }

    if (msg && typeof msg === 'object' && 'id' in msg && ('result' in msg || 'error' in msg)) {
      const key = String(msg.id);
      const pending = this.pending.get(key);
      if (!pending) return;
      this.pending.delete(key);
      if ('error' in msg && msg.error) {
        const rpcText = extractErrorText(msg.error);
        const rpcError = msg.error as { code?: unknown; data?: unknown };
        pending.reject(
          new BusinessError(
            'E_CODEX_RPC',
            rpcText ? `Codex RPC 失败：${rpcText}` : 'Codex RPC 调用失败。',
            'AGENT_RUNTIME',
            true,
            { code: rpcError.code, data: rpcError.data }
          )
        );
      } else {
        const rpcResult = (msg as { result?: unknown }).result;
        pending.resolve(rpcResult);
      }
      return;
    }

    if (msg && typeof msg === 'object' && 'method' in msg) {
      const note = msg as JsonRpcNotification;
      for (const h of this.notificationHandlers) h(note);
    }
  }

  private failAll(error: BusinessError): void {
    for (const [, p] of this.pending) p.reject(error);
    this.pending.clear();
  }

  public get isConnected(): boolean {
    return Boolean(this.child) && !this.closed;
  }
}
