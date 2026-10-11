import { type WsEnvelope, WsEventTypes } from '@study-studio/protocol';
import { ok, err, type Result, BusinessError, generateId, isOk } from '@study-studio/shared';
import { AcpAgentSession } from '@study-studio/agent-runtime';
import type { GatewayServer } from '../gateway-runtime.js';
import type { AgentLane, SessionManager } from '../session/session-manager.js';
import { buildTurnExecutionSummary } from '../turn-summary-builder.js';

export async function handleQueueStart(
  server: GatewayServer,
  envelope: WsEnvelope,
  emit?: (env: WsEnvelope) => void
): Promise<Result<WsEnvelope, BusinessError>> {
  const payload = (envelope.payload ?? {}) as {
    queuedSubmissionId?: string;
    approvalPolicy?: string;
    lane?: string;
  };
  const lane: AgentLane =
    payload.lane === 'learning' || payload.lane === 'coach'
      ? payload.lane
      : server.activeTurnLane.get(envelope.sessionId) ?? 'coach';
  const agentSession = server.sessionManager.getAgentSession(envelope.sessionId, lane) as
    | (ReturnType<SessionManager['getAgentSession']> & {
        sendQueued?: (opts?: {
          queuedSubmissionId?: string;
          approvalPolicy?: string;
        }) => AsyncIterable<import('@study-studio/agent-runtime').AgentEvent>;
      })
    | undefined;
  if (!agentSession) {
    return err(
      new BusinessError(
        'E_SESSION_NOT_FOUND',
        '当前没有可启动队列的 Agent 会话。',
        'VALIDATION'
      )
    );
  }
  if (typeof agentSession.sendQueued !== 'function' && !agentSession.threadId) {
    return err(
      new BusinessError(
        'E_SESSION_NOT_FOUND',
        '当前没有可启动队列的 Agent 会话。',
        'VALIDATION'
      )
    );
  }

  const abortController = new AbortController();
  server.activeStreamControllers.set(envelope.sessionId, abortController);
  server.activeTurnLane.set(envelope.sessionId, lane);
  // P3-C：队列回合起始时间
  const turnStartedAt = Date.now();

  if (emit) {
    emit({
      version: '1.0',
      id: generateId('turn'),
      sessionId: envelope.sessionId,
      type: WsEventTypes.AGENT_TURN_START,
      payload: { source: 'agent', fromQueue: true },
      timestamp: Date.now(),
    });
  }

  let reply = '';
  let replySource: 'agent' | 'local' = 'agent';
  let streamed = false;
  // P3-C：队列失败时保留结构化业务错误
  let queueFailureError: BusinessError | undefined;
  const threadId = agentSession.threadId;
  // ACP 会话没有 sendQueued：从网关侧台账队列取下一条，走标准 send（同一事件映射）。
  // 取数在 try 内：空队列抛 E_QUEUE_EMPTY，经外层统一收口为失败回执，不炸 WS。
  let queuedMessage: string | null = null;

  try {
    const turnStream =
      typeof agentSession.sendQueued === 'function'
        ? agentSession.sendQueued({
          ...(payload.queuedSubmissionId
            ? { queuedSubmissionId: payload.queuedSubmissionId }
            : {}),
          ...(payload.approvalPolicy ? { approvalPolicy: payload.approvalPolicy } : {}),
        })
        : (() => {
          const next = threadId
            ? server.acpLedger.queueConsume(threadId, payload.queuedSubmissionId)
            : null;
          if (!next) {
            throw new BusinessError(
              'E_QUEUE_EMPTY',
              'ACP 队列为空（可能已被消费或会话尚未入台账，先发一条消息再排队）。',
              'VALIDATION'
            );
          }
          queuedMessage = next.message;
          return agentSession.send({ message: next.message });
        })();
    for await (const ev of turnStream) {
      if (abortController.signal.aborted) {
        await agentSession.interrupt();
        break;
      }
      if (ev.type === 'TEXT_DELTA' && ev.delta) {
        reply += ev.delta;
        streamed = true;
        if (emit) {
          emit({
            version: '1.0',
            id: generateId('delta'),
            sessionId: envelope.sessionId,
            type: WsEventTypes.AGENT_TEXT_DELTA,
            payload: { delta: ev.delta, textDelta: ev.delta, source: 'agent' },
            timestamp: Date.now(),
          });
        }
      } else if (ev.type === 'REASONING_DELTA' && ev.delta) {
        if (emit) {
          emit({
            version: '1.0',
            id: generateId('reason'),
            sessionId: envelope.sessionId,
            type: WsEventTypes.AGENT_REASONING_DELTA,
            payload: { delta: ev.delta },
            timestamp: Date.now(),
          });
        }
      } else if (ev.type === 'TOOL_CALL_REQUESTED') {
        if (emit) {
          emit({
            version: '1.0',
            id: generateId('tool'),
            sessionId: envelope.sessionId,
            type: WsEventTypes.AGENT_TOOL_CALL,
            payload: {
              callId: ev.callId,
              toolName: ev.toolName,
              arguments: ev.input,
              args: ev.input,
            },
            timestamp: Date.now(),
          });
        }
      } else if (ev.type === 'APPROVAL_REQUESTED') {
        if (emit) {
          emit({
            version: '1.0',
            id: generateId('appr'),
            sessionId: envelope.sessionId,
            type: WsEventTypes.AGENT_APPROVAL_REQUEST,
            payload: {
              approvalId: ev.approvalId,
              action: ev.action,
              description: ev.description,
              riskLevel: ev.riskLevel,
              expiresAt: ev.expiresAt,
            },
            timestamp: Date.now(),
          });
        }
      } else if (ev.type === 'APPROVAL_RESOLVED') {
        if (emit) {
          emit({
            version: '1.0',
            id: generateId('appr_res'),
            sessionId: envelope.sessionId,
            type: WsEventTypes.AGENT_APPROVAL_RESOLVED,
            payload: {
              approvalId: ev.approvalId,
              decision: ev.decision,
              reason: ev.reason,
            },
            timestamp: Date.now(),
          });
        }
      } else if (ev.type === 'COMPLETED' && ev.finalOutput) {
        if (!reply) reply = String(ev.finalOutput);
      } else if (ev.type === 'ERROR') {
        streamed = false;
        reply = ev.error?.userMessage || ev.error?.message || '队列启动失败';
        replySource = 'local';
        queueFailureError = ev.error;
        break;
      }
    }
  } catch (error) {
    // 同步抛错（含 ACP 空队列）收口为失败回执，不炸 WS。
    streamed = false;
    const biz = error instanceof BusinessError
      ? error
      : new BusinessError('E_QUEUE_START', String(error), 'AGENT_RUNTIME');
    reply = biz.userMessage || biz.message || '队列启动失败';
    replySource = 'local';
    queueFailureError = biz;
  } finally {
    server.activeStreamControllers.delete(envelope.sessionId);
    server.activeTurnLane.delete(envelope.sessionId);
  }

  const isInterrupted = abortController.signal.aborted;
  let queueRemaining = 0;
  // ACP 队消费回合入台账（与普通回合同一 transcript）。
  if (queuedMessage && threadId && reply) {
    server.acpLedger.recordTurn(threadId, { user: queuedMessage, agent: reply, source: replySource });
  }
  if (threadId && !isInterrupted) {
    const queued = await server.listAgentQueue({ sessionId: threadId, limit: 20 });
    if (isOk(queued)) queueRemaining = queued.value.items.length;
  }
  // P3-C：统一执行摘要（队列回合）
  const queueStatus: 'COMPLETED' | 'INTERRUPTED' | 'FAILED' = isInterrupted
    ? 'INTERRUPTED'
    : streamed
      ? 'COMPLETED'
      : 'FAILED';
  const queueSummary = buildTurnExecutionSummary({
    status: queueStatus,
    startedAt: turnStartedAt,
    source: replySource === 'agent' ? 'agent' : 'local',
    outcome: streamed ? 'streamed' : queueFailureError ? 'fallback' : 'not_requested',
    failureError: isInterrupted ? null : queueFailureError ?? null,
    failureCategory: isInterrupted ? 'INTERRUPTED' : 'QUEUE',
    queueRemaining,
    lane,
    threadId,
    fromQueue: true,
    legacyFailureMessage: queueFailureError?.userMessage,
  });

  const completedEnvelope: WsEnvelope = {
    version: '1.0',
    id: generateId('done'),
    sessionId: envelope.sessionId,
    type: WsEventTypes.AGENT_TURN_COMPLETED,
    payload: {
      finalOutput: reply,
      // P3-C 结构化执行摘要（含 status/source/outcome/failure/elapsedMs/queueRemaining/lane/threadId/fromQueue/model）
      ...queueSummary,
      // ACP 上下文用量（同普通回合；配额类无 ACP 对应物）。
      ...(agentSession instanceof AcpAgentSession && agentSession.getLastUsage()
        ? { contextUsage: agentSession.getLastUsage() }
        : {}),
      // 旧字段兼容保留
      fromQueue: true,
    },
    timestamp: Date.now(),
  };
  if (emit) emit(completedEnvelope);
  return ok(completedEnvelope);
}
