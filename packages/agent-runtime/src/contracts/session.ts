import type { AgentEvent } from './event.js';
import type { AgentInput } from './context.js';
import type { Result, BusinessError } from '@study-studio/shared';

/** 对齐各引擎审批决策枚举 */
export type ApprovalDecision =
  | 'accept'
  | 'acceptForSession'
  | 'decline'
  | 'cancel';

/**
 * 外部工具执行器（运行器 scope 闭包形态；与引擎无关）。
 * 由调用方注入归属校验、额度与执行后端。
 */
export type ExternalToolExecutor = (
  toolName: string,
  input: Record<string, unknown>,
  ctx: { sessionId: string; userId: string; turnId?: string; callId?: string }
) => Promise<unknown>;

export interface AgentSession {  /** 实际注入的原生工具声明，由 Adapter 提供；诊断不得重新推导厂商协议。 */
  readonly toolSpecs?: readonly { name: string; businessName: string; description: string; inputSchema: Record<string, unknown> }[];
  readonly sessionId: string;
  /** 引擎侧会话 id（若引擎支持多轮续接） */
  readonly threadId?: string;

  /**
   * 启动对话轮次，返回标准事件流
   */
  send(input: AgentInput): AsyncIterable<AgentEvent>;

  /**
   * 提交工具执行结果
   */
  submitToolResult(
    callId: string,
    result: unknown
  ): Promise<Result<void, BusinessError>>;

  /**
   * 提交敏感操作审批决策。
   * `boolean` 仍兼容：true→accept，false→decline。
   */
  submitApproval(
    approvalId: string,
    decision: boolean | ApprovalDecision
  ): Promise<Result<void, BusinessError>>;

  /**
   * 向当前进行中的 Turn 注入引导消息（引擎支持时）
   */
  steer(message: string): Promise<Result<void, BusinessError>>;

  /**
   * 中断当前轮次
   */
  interrupt(): Promise<Result<void, BusinessError>>;

  /**
   * 关闭会话
   */
  close(): Promise<Result<void, BusinessError>>;
}
