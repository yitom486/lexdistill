/**
 * agentpools 池驱动（网关基础设施层；包边界要求业务包不得直引厂商/引擎包）。
 *
 * 实现 agent-runtime 的 AgentPoolDriver 契约，把 npm `agentpools`
 *（API v2 + sharedProcess）的租约模型翻译过来：连续会话、协作取消、
 * 活动标记、effort/mcpServers 透传。codex 二进制缺省自动解析本机最新安装。
 */
import type {
  AgentPoolActivityEvent,
  AgentPoolAskResult,
  AgentPoolDriver,
  AgentPoolDriverOptions,
  AgentPoolLease,
} from '@study-studio/agent-runtime';
import { resolveCodexBinary, backgroundCodexArgs } from '@study-studio/agent-runtime';

interface AgentpoolsLeaseLike {
  readonly agentIndex: number;
  ask(prompt: string | { content: unknown[] }): Promise<{ text: string; stopReason: string }>;
  cancel(): void;
  drainEvents(): AgentPoolActivityEvent[];
  finish(): Promise<void>;
}

interface AgentpoolsPoolLike {
  acquire(workerIndex?: number): Promise<AgentpoolsLeaseLike>;
  status(): { queued: number; active: number; closed: boolean };
  close(options?: { drain?: boolean }): Promise<unknown>;
}

interface AgentpoolsModule {
  AgentPool: new (options: Record<string, unknown>) => AgentpoolsPoolLike;
}

function mcpServersFor(
  config: GatewayAgentpoolConfig,
  workerIndex: number,
): { mcpServers?: readonly unknown[] } {
  if (config.mcpServersForWorker) {
    const servers = config.mcpServersForWorker(workerIndex);
    return servers.length ? { mcpServers: [...servers] } : {};
  }
  return config.mcpServers?.length ? { mcpServers: [...config.mcpServers] } : {};
}

async function loadAgentpools(): Promise<AgentpoolsModule> {  try {
    return (await import('agentpools')) as unknown as AgentpoolsModule;
  } catch (cause) {
    throw new Error(
      `agentpools 运行时不可用（请确认依赖已安装且原生包匹配平台）：${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

export interface GatewayAgentpoolConfig extends AgentPoolDriverOptions {
  /** codex 可执行文件；缺省自动解析本机最新安装。 */
  readonly codexBinary?: string | undefined;
  /** 透传给 codex 进程的固定启动参数（如 Windows 沙箱开关）。 */
  readonly codexArgs?: readonly string[];
  /**
   * 按 Worker 下发 MCP 服务（每 Worker 只配自己的端点）。
   * 缺席时所有 Worker 共用 `mcpServers`。名称必须每 Worker 唯一，
   * 否则运行侧按名入表会互相覆盖。
   */
  readonly mcpServersForWorker?: ((workerIndex: number) => readonly unknown[]) | undefined;
}

export class GatewayAgentpoolDriver implements AgentPoolDriver {
  private pool: AgentpoolsPoolLike | undefined;
  private readonly leases = new Map<number, AgentpoolsLeaseLike>();

  private constructor(
    private readonly module: AgentpoolsModule,
    private readonly config: GatewayAgentpoolConfig,
  ) {}

  static async create(config: GatewayAgentpoolConfig): Promise<GatewayAgentpoolDriver> {
    const module = await loadAgentpools();
    const program = config.program || resolveCodexBinary();
    // 与自研 Codex 通道一致的启动参数：unelevated 沙箱 + stdio 监听。
    const codexArgs = backgroundCodexArgs(
      config.codexArgs?.length ? config.codexArgs : ['app-server', '--listen', 'stdio://'],
    );
    const driver = new GatewayAgentpoolDriver(module, { ...config, program });
    const pool = new module.AgentPool({
      apiVersion: 2,
      sharedProcess: config.sharedProcess ?? true,
      maxQueued: config.maxQueued ?? Math.max(8, config.poolSize * 2),
      agents: Array.from({ length: config.poolSize }, (_, workerIndex) => ({
        runtime: 'codexAppServer',
        program: driver.config.program,
        args: [...codexArgs],
        ...(driver.config.env ? { env: { ...driver.config.env } } : {}),
        cwd: config.cwd,
        ...(config.model ? { model: config.model } : {}),
        ...(config.effort ? { effort: config.effort } : {}),
        ...(config.approvalPolicy ? { approvalPolicy: config.approvalPolicy } : {}),
        ...(config.sandbox ? { sandbox: config.sandbox } : {}),
        ...mcpServersFor(config, workerIndex),
        timeouts: {
          ...(config.handshakeMs ? { handshakeMs: config.handshakeMs } : {}),
          ...(config.promptMs ? { promptMs: config.promptMs } : {}),
        },
        ephemeral: true,
      })),
    });
    driver.pool = pool;
    return driver;
  }

  private requirePool(): AgentpoolsPoolLike {
    if (!this.pool) throw new Error('agentpools 池已关闭');
    return this.pool;
  }

  async acquire(workerIndex?: number): Promise<AgentPoolLease> {
    const native = await this.requirePool().acquire(workerIndex);
    const lease: AgentPoolLease = { agentIndex: native.agentIndex };
    this.leases.set(lease.agentIndex, native);
    return lease;
  }

  private native(lease: AgentPoolLease): AgentpoolsLeaseLike {
    const found = this.leases.get(lease.agentIndex);
    if (!found) throw new Error(`Worker ${lease.agentIndex} 没有活动的原生租约`);
    return found;
  }

  async ask(lease: AgentPoolLease, prompt: string): Promise<AgentPoolAskResult> {
    const result = await this.native(lease).ask(prompt);
    return { text: result.text, stopReason: result.stopReason };
  }

  drainEvents(lease: AgentPoolLease): AgentPoolActivityEvent[] {
    return this.native(lease).drainEvents();
  }

  cancel(lease: AgentPoolLease): void {
    this.native(lease).cancel();
  }

  async finish(lease: AgentPoolLease): Promise<void> {
    try {
      await this.native(lease).finish();
    } finally {
      this.leases.delete(lease.agentIndex);
    }
  }

  status(): { readonly queued: number; readonly active: number; readonly closed: boolean } {
    return this.requirePool().status();
  }

  async close(drain = true): Promise<{ readonly closeErrors: readonly string[]; readonly panickedWorkers: number }> {
    this.leases.clear();
    const report = (await this.requirePool().close({ drain })) as { closeErrors?: unknown; panickedWorkers?: unknown };
    this.pool = undefined;
    const closeErrors = Array.isArray(report?.closeErrors) ? report.closeErrors.filter((item): item is string => typeof item === 'string') : [];
    const panickedWorkers = typeof report?.panickedWorkers === 'number' ? report.panickedWorkers : 0;
    return { closeErrors, panickedWorkers };
  }
}
