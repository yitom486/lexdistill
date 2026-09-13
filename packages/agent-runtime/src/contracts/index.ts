/**
 * C3 Agent Runtime 对外契约面（provider-neutral，本体已并入本目录）。
 *
 * 只含契约（AgentAdapter / AgentSession / AgentEvent / AgentInput /
 * ContextSnapshot），不得新增 provider 实现、厂商 SDK 引用与运行时逻辑；
 * 违规由 package-boundary 单测锁定。一律具名重导出（禁 `export *`，
 * 防契约表面无声膨胀）。
 */
export type {
  AgentAdapter,
  CreateSessionOptions,
} from './adapter.js';
export type {
  AgentImageAttachment,
  AgentInput,
  ContextFocusItem,
  ContextSnapshot,
  LearnerDigest,
  LearnerWeaknessDigest,
} from './context.js';
export type { AgentEvent } from './event.js';
export type {
  AgentSession,
  ApprovalDecision,
} from './session.js';
