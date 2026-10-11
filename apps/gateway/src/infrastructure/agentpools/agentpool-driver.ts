/**
 * agentpools 池驱动（网关基础设施层；包边界要求业务包不得直引厂商/引擎包）。
 *
 * 实现 agent-runtime 的 AgentPoolDriver 契约，把 npm `agentpools`
 *（API v2 + sharedProcess）的租约模型翻译过来：连续会话、协作取消、
 * 活动标记、mcpServers 透传。Agent 一律走 ACP（运行时 id 缺席即默认）。
 * effort/sandbox/approvalPolicy 无 ACP 池对应物，传入即大声拒绝（见 create）。
 */
import type {
  AgentPoolActivityEvent,
  AgentPoolAskResult,
  AgentPoolDriver,
  AgentPoolDriverOptions,
  AgentPoolLease,
} from '@study-studio/agent-runtime';
import { BusinessError, isOk } from '@study-studio/shared';
import { resolveAcpPoolAgent } from './acp-pool-agent.js';

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
  /**
   * ACP 运行时 id（缺席即 codex-acp 默认）。启动信息按 acp-client 模板＋adapter
   * 决议（program/args/env），各 Worker 共用同一决议。model 缺席用运行时默认。
   * effort/sandbox/approvalPolicy 无 ACP 对应物，不携带（审批走 autoApprove）。
   */
  readonly acp?: { readonly runtimeId?: string | undefined; readonly model?: string | undefined } | undefined;
  /**
   * 按 Worker 下发 MCP 服务（每 Worker 只配自己的端点）。
   * 缺席时所有 Worker 共用 `mcpServers`。名称必须每 Worker 唯一，
   * 否则运行侧按名入表会互相覆盖。
   * 教材管线的服务器形状与命名归 `modules/library/mcp/textbook-mcp-catalog.ts`
   * 所有；Gateway 工具选型归 `runtime/router/tool-catalog.ts`。本驱动只透传。
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
    // effort/sandbox/approvalPolicy 无 ACP 池对应物：传入即大声拒绝，不静默丢弃。
    const unsupported = (
      [
        ['effort', '思考深度档位'],
        ['sandbox', '沙箱'],
        ['approvalPolicy', '审批策略'],
      ] as const
    ).find(([key]) => config[key] !== undefined);
    if (unsupported) {
      throw new BusinessError(
        'E_AGENTPOOL_OPTION_UNSUPPORTED',
        `池化运行暂不支持${unsupported[1]}（ACP 池无对应物），请清空后重试`,
        'VALIDATION',
      );
    }
    const module = await loadAgentpools();
    const driver = new GatewayAgentpoolDriver(module, { ...config });
    // 运行时 id 缺席即默认 codex-acp；决议失败大声抛，不建半吊子池。
    const acp = await resolveAcpPoolAgent(config.acp?.runtimeId ?? 'codex-acp', {
      cwd: config.cwd,
      ...(config.acp?.model ?? config.model ? { model: config.acp?.model ?? config.model } : {}),
    });
    if (!isOk(acp)) throw acp.error;
    const pool = new module.AgentPool({
      apiVersion: 2,
      sharedProcess: config.sharedProcess ?? true,
      maxQueued: config.maxQueued ?? Math.max(8, config.poolSize * 2),
      agents: Array.from({ length: config.poolSize }, (_, workerIndex) => ({
        runtime: 'acp',
        program: acp.value.program,
        args: [...acp.value.args],
        env: { ...acp.value.env },
        cwd: config.cwd,
        ...(acp.value.model ? { model: acp.value.model } : {}),
        ...mcpServersFor(config, workerIndex),
        timeouts: {
          ...(config.handshakeMs ? { handshakeMs: config.handshakeMs } : {}),
          ...(config.promptMs ? { promptMs: config.promptMs } : {}),
        },
        autoApprovePermissions: true,
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
