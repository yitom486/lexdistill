import type { AgentEvent } from './event.js';
import type { AgentInput } from './context.js';
import type { Result, BusinessError } from '@study-studio/shared';

/** 对齐 Codex App Server 审批决策枚举 */
export type ApprovalDecision =
  | 'accept'
  | 'acceptForSession'
  | 'decline'
  | 'cancel';

export interface AgentSession {
  readonly sessionId: string;
  /** Codex App Server thread id（若引擎支持） */
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
   * 向当前进行中的 Turn 注入引导消息（Codex turn/steer）
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
