import { z } from 'zod';

/**
 * P3-C：Gateway 回合执行摘要（面向 UI 的可观测性契约）。
 * 让“本轮由 Agent 成功完成 / 已回退 / 已中断”成为独立、可测试的状态字段，
 * 而不是前端从气泡文案里推断。普通回合与队列回合共用同一结构。
 */
export const TurnExecutionStatusSchema = z.enum(['COMPLETED', 'INTERRUPTED', 'FAILED']);
export type TurnExecutionStatus = z.infer<typeof TurnExecutionStatusSchema>;

/** 本轮回复的执行来源（`codex` 为旧值别名，与 `agent` 等价，兼容旧网关） */
export const TurnExecutionSourceSchema = z.enum(['agent', 'codex', 'lite', 'keyword', 'local']);
export type TurnExecutionSource = z.infer<typeof TurnExecutionSourceSchema>;

/**
 * Agent 通路本轮结果：
 * - streamed：Agent 真流式完成
 * - fallback：Agent 失败后回退本地/Responses-lite
 * - not_requested：本轮未走 Agent（关键词模板或 lite 旁路）
 */
export const TurnExecutionOutcomeSchema = z.enum(['streamed', 'fallback', 'not_requested']);
export type TurnExecutionOutcome = z.infer<typeof TurnExecutionOutcomeSchema>;

/** 失败类别，供 UI 决定是否重试 / 重连 */
export const TurnFailureCategorySchema = z.enum([
  'SESSION_CREATE',
  'STREAM',
  'QUEUE',
  'INTERRUPTED',
  'UNKNOWN',
]);
export type TurnFailureCategory = z.infer<typeof TurnFailureCategorySchema>;

/** 结构化失败原因：仅含用户可读信息，绝不携带底层错误栈 */
export const TurnFailureSchema = z.object({
  /** 结构化错误代码（如 E_AGENT_SESSION_CREATE） */
  code: z.string(),
  /** 对用户友好、可读的失败说明 */
  userMessage: z.string(),
  /** 失败类别，供 UI 决定展示与重试策略 */
  category: TurnFailureCategorySchema,
  /** 是否允许用户重试 */
  retryable: z.boolean().optional(),
});
export type TurnFailure = z.infer<typeof TurnFailureSchema>;

export const TurnExecutionSummarySchema = z.object({
  status: TurnExecutionStatusSchema,
  /** 本轮回复来源 */
  source: TurnExecutionSourceSchema.optional(),
  /** Agent 通路本轮结果 */
  outcome: TurnExecutionOutcomeSchema.optional(),
  /** 结构化失败原因；仅当 status !== COMPLETED 时可能出现 */
  failure: TurnFailureSchema.optional(),
  /** 本轮耗时（毫秒） */
  elapsedMs: z.number().int().nonnegative().optional(),
  /** 队列剩余项数 */
  queueRemaining: z.number().int().nonnegative().optional(),
  /** 本轮所属 lane */
  lane: z.enum(['coach', 'learning']).optional(),
  /** 命中的引擎 thread id */
  threadId: z.string().optional(),
  /** 是否来自队列消费 */
  fromQueue: z.boolean().optional(),
  /** 本轮使用的模型 */
  model: z.string().optional(),
});
export type TurnExecutionSummary = z.infer<typeof TurnExecutionSummarySchema>;
