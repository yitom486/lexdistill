/**
 * 厂商无关的批量 Agent 池驱动契约（C3）。
 *
 * 教材这类多章节并发提炼走池 + 租约，不经过 AgentAdapter 的单会话模型。
 * 实现（如 agentpools 适配）负责进程/线程、连续会话、取消与活动事件；
 * 业务只看到租约、文本问答与可轮询的活动标记。
 */

export interface AgentPoolLease {
  /** 池内 Worker 序号（多 Worker 端点隔离用）。 */
  readonly agentIndex: number;
}

export interface AgentPoolActivityEvent {
  /** turn_started | activity | turn_ended | cancelled（运行侧如实上报）。 */
  readonly kind: string;
  readonly turnId: string | null;
  readonly atMs: number;
}

export interface AgentPoolDriverOptions {
  /** Agent 可执行文件（如 codex 二进制）。 */
  readonly program: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  /** 所有 Worker 的固定工作区（稳定父目录）。 */
  readonly cwd: string;
  readonly model?: string | undefined;
  /** 推理强度（运行支持才生效，不支持时由实现显式拒绝，不得静默忽略）。 */
  readonly effort?: string | undefined;
  /** 注入各 Worker 的 MCP 服务（stdio/http 条目，运行侧原样透传）。 */
  readonly mcpServers?: readonly unknown[];
  /** Worker 数量。 */
  readonly poolSize: number;
  /** Codex 线程审批策略。缺席走运行时默认（never = 需要审批的一律拒绝）。 */
  readonly approvalPolicy?: string | undefined;
  /** 模型执行 shell 的沙箱档（官方 SandboxMode）。缺席走服务端默认。 */
  readonly sandbox?: string | undefined;
  readonly maxQueued?: number;
  /** 与 agentpools sharedProcess 语义一致：同进程多线程。 */
  readonly sharedProcess?: boolean;
  readonly handshakeMs?: number;
  readonly promptMs?: number;
}

export interface AgentPoolAskResult {
  readonly text: string;
  readonly stopReason: string;
}

export interface AgentPoolDriver {
  acquire(workerIndex?: number): Promise<AgentPoolLease>;
  ask(lease: AgentPoolLease, prompt: string): Promise<AgentPoolAskResult>;
  /** 排空自上次调用后的活动标记；永不阻塞。 */
  drainEvents(lease: AgentPoolLease): AgentPoolActivityEvent[];
  /** 协作取消活动 ask；闲置时无操作。 */
  cancel(lease: AgentPoolLease): void;
  finish(lease: AgentPoolLease): Promise<void>;
  status(): { readonly queued: number; readonly active: number; readonly closed: boolean };
  /**
   * 关闭池并停止活动会话。返回关闭报告；调用方必须检查 closeErrors /
   * panickedWorkers，失败时不得删除仍可能被读取的临时文件。
   */
  close(drain?: boolean): Promise<{ readonly closeErrors: readonly string[]; readonly panickedWorkers: number }>;
}
