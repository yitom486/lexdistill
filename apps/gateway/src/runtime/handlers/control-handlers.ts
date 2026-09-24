import { type WsEnvelope, WsEventTypes } from '@study-studio/protocol';
import { ok, err, type Result, BusinessError, generateId, isOk } from '@study-studio/shared';
import type { GatewayServer } from '../gateway-runtime.js';
import type { AgentLane } from '../session/session-manager.js';

export async function handleApprovalRespond(
  server: GatewayServer,
  envelope: WsEnvelope
): Promise<Result<WsEnvelope, BusinessError>> {
  const payload = (envelope.payload ?? {}) as {
    approvalId?: string;
    approved?: boolean;
    decision?: string;
    lane?: string;
  };
  const approvalId = String(payload.approvalId || '');
  if (!approvalId) {
    return err(
      new BusinessError('E_INVALID_INPUT', '缺少 approvalId', 'VALIDATION')
    );
  }

  const allowed = new Set([
    'accept',
    'acceptForSession',
    'decline',
    'cancel',
  ]);
  let decision: boolean | string;
  if (typeof payload.decision === 'string' && allowed.has(payload.decision)) {
    decision = payload.decision;
  } else if (typeof payload.approved === 'boolean') {
    decision = payload.approved;
  } else {
    return err(
      new BusinessError(
        'E_INVALID_INPUT',
        '缺少有效的审批决策（accept / acceptForSession / decline）。',
        'VALIDATION'
      )
    );
  }

  const lane: AgentLane =
    payload.lane === 'learning' || payload.lane === 'coach'
      ? payload.lane
      : server.activeTurnLane.get(envelope.sessionId) ?? 'coach';
  const agentSession = server.sessionManager.getAgentSession(envelope.sessionId, lane);
  if (!agentSession) {
    return err(
      new BusinessError(
        'E_SESSION_NOT_FOUND',
        '当前没有可响应的 Agent 会话。',
        'VALIDATION'
      )
    );
  }
  const res = await agentSession.submitApproval(
    approvalId,
    decision as boolean | 'accept' | 'acceptForSession' | 'decline' | 'cancel'
  );
  if (!isOk(res)) return err(res.error);
  return ok({
    version: '1.0',
    id: generateId('appr_ack'),
    sessionId: envelope.sessionId,
    type: WsEventTypes.AGENT_TURN_COMPLETED,
    payload: {
      status: 'APPROVAL_ACK',
      approvalId,
      lane,
      decision:
        typeof decision === 'string'
          ? decision
          : decision
            ? 'accept'
            : 'decline',
      approved:
        decision === true ||
        decision === 'accept' ||
        decision === 'acceptForSession',
    },
    timestamp: Date.now(),
  });
}

export async function handleTurnInterrupt(
  server: GatewayServer,
  envelope: WsEnvelope
): Promise<Result<WsEnvelope, BusinessError>> {
  const controller = server.activeStreamControllers.get(envelope.sessionId);
  if (controller) {
    controller.abort();
    server.activeStreamControllers.delete(envelope.sessionId);
  }
  const payload = (envelope.payload ?? {}) as { lane?: string };
  const lane: AgentLane =
    payload.lane === 'learning' || payload.lane === 'coach'
      ? payload.lane
      : server.activeTurnLane.get(envelope.sessionId) ?? 'coach';
  const agentSession = server.sessionManager.getAgentSession(envelope.sessionId, lane);
  if (agentSession) {
    void agentSession.interrupt();
  }
  return ok({
    version: '1.0',
    id: generateId('msg'),
    sessionId: envelope.sessionId,
    type: WsEventTypes.AGENT_TURN_COMPLETED,
    payload: { status: 'INTERRUPTED', lane },
    timestamp: Date.now(),
  });
}

export async function handleTurnSteer(
  server: GatewayServer,
  envelope: WsEnvelope
): Promise<Result<WsEnvelope, BusinessError>> {
  const payload = (envelope.payload ?? {}) as {
    input?: string;
    message?: string;
    lane?: string;
  };
  const message = String(payload.input || payload.message || '').trim();
  if (!message) {
    return err(
      new BusinessError('E_INVALID_INPUT', '引导消息不能为空', 'VALIDATION')
    );
  }
  const lane: AgentLane =
    payload.lane === 'learning' || payload.lane === 'coach'
      ? payload.lane
      : server.activeTurnLane.get(envelope.sessionId) ?? 'coach';
  const agentSession = server.sessionManager.getAgentSession(envelope.sessionId, lane);
  if (!agentSession) {
    return err(
      new BusinessError(
        'E_SESSION_NOT_FOUND',
        '当前没有可引导的 Agent 会话。',
        'VALIDATION'
      )
    );
  }
  const res = await agentSession.steer(message);
  if (!isOk(res)) return err(res.error);
  return ok({
    version: '1.0',
    id: generateId('steer_ack'),
    sessionId: envelope.sessionId,
    type: WsEventTypes.AGENT_TURN_COMPLETED,
    payload: { status: 'STEER_ACK', message, lane },
    timestamp: Date.now(),
  });
}

/**
 * 客户端工具执行回执（`client.tool.result`）。
 *
 * 语义：Server 工具结果已由网关内联回填 Codex，无需前端参与；
 * Client 工具（`ui.*`）由前端本地执行后回执确认。
 * 本处理仅做接收确认、永不报错——成功执行的工具绝不能再弹出 error toast。
 */
export async function handleToolResult(
  _server: GatewayServer,
  envelope: WsEnvelope
): Promise<Result<WsEnvelope, BusinessError>> {
  const payload = (envelope.payload ?? {}) as {
    callId?: unknown;
    toolName?: unknown;
    ok?: unknown;
  };
  const toolName = typeof payload.toolName === 'string' ? payload.toolName : 'unknown';
  return ok({
    version: '1.0',
    id: generateId('tool_ack'),
    sessionId: envelope.sessionId,
    type: WsEventTypes.AGENT_TURN_COMPLETED,
    payload: {
      status: 'TOOL_RESULT_ACK',
      toolName,
      ...(typeof payload.callId === 'string' ? { callId: payload.callId } : {}),
    },
    timestamp: Date.now(),
  });
}
