import {
  err,
  isOk,
  ok,
  BusinessError,
  translateToBusinessError,
  type Result,
} from '@study-studio/shared';
import type { CodexAppServerConnection } from './app-server-client.js';

/**
 * Codex 连接生命周期的内部拥有者。
 *
 * Session、Thread/Turn 和工具/审批路由仍由 CodexAdapter 负责；这里仅
 * 管理物理连接的创建、代际、single-flight 以及关闭时序。
 */
export class CodexConnectionManager {
  private currentConnection: CodexAppServerConnection | null;
  private connectAttempt: Promise<Result<CodexAppServerConnection, BusinessError>> | null = null;
  private connectCandidate: CodexAppServerConnection | null = null;
  private shutdownAttempt: Promise<Result<void, BusinessError>> | null = null;
  /** 同一物理连接的所有关闭请求共享同一个逻辑清理。 */
  private readonly closeAttempts = new WeakMap<
    CodexAppServerConnection,
    Promise<Result<void, BusinessError>>
  >();
  /** close 失败时保留连接引用，阻止新代 spawn，直到显式 shutdown 重试成功。 */
  private readonly blockedConnections = new Set<CodexAppServerConnection>();
  private closeBlockError: BusinessError | null = null;
  private epoch = 0;
  private closing = false;

  public constructor(options: {
    createConnection: () => CodexAppServerConnection;
    initialConnection?: CodexAppServerConnection;
  }) {
    this.createConnection = options.createConnection;
    this.currentConnection = options.initialConnection ?? null;
  }

  private readonly createConnection: () => CodexAppServerConnection;

  /** 获取当前连接，或共享同一次连接初始化。 */
  public getOrConnect(): Promise<Result<CodexAppServerConnection, BusinessError>> {
    if (this.closing) {
      return Promise.resolve(err(this.closedError()));
    }
    if (this.blockedConnections.size > 0) {
      return Promise.resolve(err(this.closeBlockedError()));
    }
    if (this.currentConnection) return Promise.resolve(ok(this.currentConnection));
    if (this.connectAttempt) return this.connectAttempt;

    const attempt = this.connectOnce(this.epoch);
    this.connectAttempt = attempt;
    const clear = (): void => {
      if (this.connectAttempt === attempt) this.connectAttempt = null;
    };
    attempt.then(clear, clear);
    return attempt;
  }

  /**
   * 关闭当前代及在途候选连接。关闭期间不允许创建新连接；完成后回到
   * idle，下一次 getOrConnect() 可以启动新的代际。
   */
  public shutdown(): Promise<Result<void, BusinessError>> {
    if (this.shutdownAttempt) return this.shutdownAttempt;

    const attempt = this.shutdownOnce();
    this.shutdownAttempt = attempt;
    const clear = (): void => {
      if (this.shutdownAttempt === attempt) this.shutdownAttempt = null;
    };
    attempt.then(clear, clear);
    return attempt;
  }

  private async connectOnce(
    attemptEpoch: number
  ): Promise<Result<CodexAppServerConnection, BusinessError>> {
    let candidate: CodexAppServerConnection;
    try {
      candidate = this.createConnection();
    } catch (raw) {
      return err(translateToBusinessError(raw, 'CODEX_CONNECTION_CREATE'));
    }

    this.connectCandidate = candidate;
    try {
      let ready: Result<void, BusinessError>;
      try {
        ready = await candidate.connect();
      } catch (raw) {
        ready = err(translateToBusinessError(raw, 'CODEX_CONNECTION_CONNECT'));
      }

      if (!isOk(ready)) {
        // connect() 可能已经启动了半个进程；失败连接永不缓存。
        const closeResult = await this.closeConnection(candidate);
        if (isOk(closeResult)) this.releaseClosedConnection(candidate);
        return ready;
      }

      if (this.closing || attemptEpoch !== this.epoch || this.currentConnection) {
        const closeResult = await this.closeConnection(candidate);
        if (!isOk(closeResult)) {
          return err(
            new BusinessError(
              'E_CODEX_CLOSED',
              'Codex 连接在初始化期间被关闭，请重试。',
              'AGENT_RUNTIME',
              true,
              { closeError: closeResult.error }
            )
          );
        }
        this.releaseClosedConnection(candidate);
        return err(this.closedError());
      }

      this.currentConnection = candidate;
      return ok(candidate);
    } catch (raw) {
      const closeResult = await this.closeConnection(candidate);
      if (isOk(closeResult)) this.releaseClosedConnection(candidate);
      return err(translateToBusinessError(raw, 'CODEX_CONNECTION_CONNECT'));
    } finally {
      if (this.connectCandidate === candidate) this.connectCandidate = null;
    }
  }

  private async shutdownOnce(): Promise<Result<void, BusinessError>> {
    this.closing = true;
    this.epoch += 1;

    const active = this.currentConnection;
    const candidate = this.connectCandidate;
    const inFlight = this.connectAttempt;
    this.currentConnection = null;

    let firstError: BusinessError | null = null;
    try {
      const targets = new Set<CodexAppServerConnection>();
      if (active) targets.add(active);
      if (candidate) targets.add(candidate);
      for (const blocked of this.blockedConnections) targets.add(blocked);

      const closeResults = await Promise.all(
        [...targets].map((connection) =>
          this.closeConnection(connection, this.blockedConnections.has(connection))
        )
      );
      for (const result of closeResults) {
        if (!isOk(result)) {
          firstError = result.error;
          break;
        }
      }

      // 先发起 candidate close，再等待 connect settle，确保旧代不能在
      // shutdown 返回后继续运行或回填 currentConnection。
      if (inFlight) await inFlight;
      if (this.currentConnection) {
        const lateConnection = this.currentConnection;
        this.currentConnection = null;
        const lateClose = await this.closeConnection(lateConnection);
        if (!isOk(lateClose) && !firstError) firstError = lateClose.error;
      }
    } finally {
      this.closing = false;
    }

    return firstError ? err(firstError) : ok(undefined);
  }

  private async closeConnection(
    connection: CodexAppServerConnection,
    retryFailed = false
  ): Promise<Result<void, BusinessError>> {
    if (retryFailed) this.closeAttempts.delete(connection);
    const existing = this.closeAttempts.get(connection);
    if (existing) return existing;

    const attempt = this.closeConnectionOnce(connection);
    this.closeAttempts.set(connection, attempt);
    attempt.then((result) => {
      if (isOk(result)) {
        this.blockedConnections.delete(connection);
        if (this.blockedConnections.size === 0) this.closeBlockError = null;
      } else {
        this.blockedConnections.add(connection);
        this.closeBlockError ??= result.error;
      }
    });
    return attempt;
  }

  private async closeConnectionOnce(
    connection: CodexAppServerConnection
  ): Promise<Result<void, BusinessError>> {
    try {
      return await connection.close();
    } catch (raw) {
      return err(translateToBusinessError(raw, 'CODEX_CONNECTION_CLOSE'));
    }
  }

  private releaseClosedConnection(connection: CodexAppServerConnection): void {
    if (!this.blockedConnections.has(connection)) this.closeAttempts.delete(connection);
  }

  private closedError(): BusinessError {
    return new BusinessError(
      'E_CODEX_CLOSED',
      'Codex 连接正在关闭，请稍后重试。',
      'AGENT_RUNTIME',
      true
    );
  }

  private closeBlockedError(): BusinessError {
    return (
      this.closeBlockError ??
      new BusinessError(
        'E_CODEX_CLOSE_FAILED',
        '上一次 Codex 连接尚未完成关闭，系统暂不启动新的连接，请稍后重试。',
        'AGENT_RUNTIME',
        true
      )
    );
  }
}
