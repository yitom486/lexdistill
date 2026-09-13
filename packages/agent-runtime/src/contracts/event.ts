import type { BusinessError } from '@study-studio/shared';

/**
 * 业务层标准规范化的 Agent 内部事件流
 * 屏蔽任何具体模型底层协议差异
 */
export type AgentEvent =
  | { type: 'TEXT_DELTA'; delta: string }
  | { type: 'REASONING_STARTED' }
  | { type: 'REASONING_DELTA'; delta: string }
  | { type: 'REASONING_COMPLETED' }
  | {
      type: 'TOOL_CALL_REQUESTED';
      callId: string;
      toolName: string;
      input: Record<string, unknown>;
    }
  | { type: 'TOOL_CALL_COMPLETED'; callId: string; result: unknown }
  | {
      type: 'APPROVAL_REQUESTED';
      approvalId: string;
      action: string;
      description: string;
      riskLevel: string;
      /** 客户端展示倒计时；超时后 Adapter 会自动 decline */
      expiresAt?: number;
    }
  | {
      type: 'APPROVAL_RESOLVED';
      approvalId: string;
      decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel';
      reason?: 'user' | 'timeout' | 'interrupt';
    }
  | { type: 'ERROR'; error: BusinessError }
  | { type: 'COMPLETED'; finalOutput?: string; tokenUsage?: { total: number } };
