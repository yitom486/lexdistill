import type { AgentEvent } from '../../contracts/index.js';
import { translateToBusinessError } from '@study-studio/shared';

export interface RawCodexItem {
  type: string;
  id?: string;
  text?: string;
  delta?: string;
  reasoningDelta?: string;
  toolCall?: {
    callId: string;
    toolName: string;
    arguments: Record<string, unknown>;
  };
  approval?: {
    approvalId: string;
    action: string;
    description: string;
    riskLevel: string;
  };
  error?: unknown;
}

/**
 * 将 Codex App Server 的底层异构事件映射为规范的内部 AgentEvent
 */
export function mapCodexItemToAgentEvent(item: RawCodexItem): AgentEvent | null {
  switch (item.type) {
    case 'message_delta':
      return { type: 'TEXT_DELTA', delta: item.delta ?? '' };

    case 'reasoning_started':
      return { type: 'REASONING_STARTED' };

    case 'reasoning_delta':
      return { type: 'REASONING_DELTA', delta: item.reasoningDelta ?? '' };

    case 'reasoning_completed':
      return { type: 'REASONING_COMPLETED' };

    case 'dynamic_tool_call':
      if (!item.toolCall) return null;
      return {
        type: 'TOOL_CALL_REQUESTED',
        callId: item.toolCall.callId,
        toolName: item.toolCall.toolName,
        input: item.toolCall.arguments,
      };

    case 'approval_request':
      if (!item.approval) return null;
      return {
        type: 'APPROVAL_REQUESTED',
        approvalId: item.approval.approvalId,
        action: item.approval.action,
        description: item.approval.description,
        riskLevel: item.approval.riskLevel,
      };

    case 'error':
      return {
        type: 'ERROR',
        error: translateToBusinessError(item.error, 'CODEX_ADAPTER'),
      };

    default:
      return null;
  }
}
