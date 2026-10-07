/**
 * M2-1 统一 Agent Runtime 公共入口（外观包，不含实现）。
 *
 * 布局：
 * - `./contracts`：provider-neutral 契约（C3 起本体已并入）；
 * - `./adapters`：Codex / Responses 适配器入口（具名收敛，不含工具桥）。
 *
 * 不变量：contracts 内禁 provider/厂商内容（单测锁定）；具体厂商实现
 * 只许位于 adapters 各包内部；Codex 专有动态工具桥禁上浮到本入口；
 * TTS 不并入（保持 speech 包独立）。
 * 本入口一律具名重导出（禁 `export *`，表面由 runtime-facade.test.ts 锁定）。
 */
export type {
  AgentAdapter,
  CreateSessionOptions,
  AgentImageAttachment,
  AgentInput,
  ContextFocusItem,
  ContextSnapshot,
  LearnerDigest,
  LearnerWeaknessDigest,
  AgentEvent,
  AgentSession,
  ApprovalDecision,
  AgentPoolActivityEvent,
  AgentPoolAskResult,
  AgentPoolDriver,
  AgentPoolDriverOptions,
  AgentPoolLease,
} from './contracts/index.js';
export {
  CodexAdapter,
  CodexSession,
  buildLearnerContextEntry,
  mapAppServerNotificationToEvents,
  resolveCodexBinary,
  backgroundCodexArgs,
  ResponsesAdapter,
  ResponsesSession,
  buildLightweightReply,
  AcpAdapter,
  AcpAgentSession,
} from './adapters/index.js';
export type {
  CodexAdapterOptions,
  ExternalToolExecutor,
  AcpAdapterOptions,
} from './adapters/index.js';
