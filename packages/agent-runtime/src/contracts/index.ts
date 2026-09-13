/**
 * M2-1 Agent Runtime 对外契约面（provider-neutral 外观）。
 *
 * 本目录只转出 `@study-studio/agent-core` 的契约（AgentAdapter /
 * AgentSession / AgentEvent / AgentInput / ContextSnapshot），不得新增
 * provider 实现、厂商 SDK 引用与运行时逻辑；违规由 package-boundary 单测锁定。
 * 契约的唯一事实源仍是 agent-core，本包只做收敛出口（M2 后续才搬代码）。
 */
export * from '@study-studio/agent-core';
