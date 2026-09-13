/**
 * C3 Agent Runtime 对外契约面（provider-neutral，本体已并入本目录）。
 *
 * 只含契约（AgentAdapter / AgentSession / AgentEvent / AgentInput /
 * ContextSnapshot），不得新增 provider 实现、厂商 SDK 引用与运行时逻辑；
 * 违规由 package-boundary 单测锁定。
 */
export * from './event.js';
export * from './context.js';
export * from './session.js';
export * from './adapter.js';
