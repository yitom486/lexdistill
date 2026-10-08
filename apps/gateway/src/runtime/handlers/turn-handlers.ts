import {
  type WsEnvelope,
  WsEventTypes,
} from '@study-studio/protocol';
import {
  ok,
  err,
  type Result,
  BusinessError,
  generateId,
  isOk,
  normalizeTrackLanguage,
} from '@study-studio/shared';
import type { GatewayServer } from '../gateway-runtime.js';
import type { ContextSnapshot } from '@study-studio/agent-runtime';
import { AcpAgentSession } from '@study-studio/agent-runtime';
import { sanitizeSnapshotReading } from '../context/context-builder.js';
import type { ToolDefinition } from '@study-studio/tool-core';
import type { AgentLane } from '../session/session-manager.js';
import { buildGenericCoachReply } from '../coach-language-policy.js';
import { selectAgentRoute } from '../router/agent-router.js';
import { resolveSessionTools, resolveTaskTools } from '../router/tool-catalog.js';
import { resolveSessionAdapterId } from '../router/runtime-catalog.js';
import { needsSessionToolUpgrade, resolveResumeThreadId } from '../router/session-tools.js';
import { resolveResponsesLiteCoach } from '../responses-lite-coach.js';
import { buildTurnExecutionSummary, formatCodexLocalFallbackNote } from '../turn-summary-builder.js';

function resolveAgentLane(
  intent: string,
  explicit?: string | null
): AgentLane {
  if (explicit === 'coach' || explicit === 'learning') return explicit;
  // 聊天界面专用；出题/批改/题目讲解走 learning，与 coach thread 隔离
  if (intent === 'FREE_COACH') return 'coach';
  return 'learning';
}

/** 下发 Client Tool 调用（前端执行，Gateway 只做参数校验） */
async function emitClientTool(
  server: GatewayServer,
  emit: ((env: WsEnvelope) => void) | undefined,
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<void> {
  const tool = server.toolRegistry.get(toolName);
  if (!tool || !emit) return;
  const res = await tool.execute(args, {
    userId: 'system',
    sessionId,
  });
  if (!isOk(res)) return;
  emit({
    version: '1.0',
    id: generateId('tool'),
    sessionId,
    type: WsEventTypes.AGENT_TOOL_CALL,
    payload: {
      callId: generateId('call'),
      toolName,
      args: res.value,
    },
    timestamp: Date.now(),
  });
}

export async function handleTurnSend(
  server: GatewayServer,
  envelope: WsEnvelope,
  emit?: (env: WsEnvelope) => void
): Promise<Result<WsEnvelope, BusinessError>> {
  const payload = (envelope.payload ?? {}) as {
    input: string;
    userId?: string;
    intent?: string;
    contextSnapshot?: Partial<ContextSnapshot>;
    agentOptions?: {
      model?: string;
      preferCodex?: boolean;
      effort?: string;
      approvalPolicy?: string;
      threadId?: string;
      ephemeral?: boolean;
      collaborationMode?: string;
      /** 显式工具 allowlist（业务名）：固定任务直接采用，不走关键词正则 */
      tools?: string[];
      /** 固定任务 id（命中中央目录 TASK_TOOL_PRESETS 直接采用；未知 id 回退 tools/提示词） */
      task?: string;
      /** Agent 运行时 id（网关按 runtime 选适配器；缺席/未知沿用 Codex） */
      runtimeId?: string;
      /** coach=聊天；learning=出题/批改/题目导师 */
      lane?: string;
    };
  };
  const userId = payload.userId || 'student_web_01';
  const userPrompt = String(payload.input || '').trim();
  const preferredModel =
    typeof payload.agentOptions?.model === 'string' && payload.agentOptions.model.trim()
      ? payload.agentOptions.model.trim()
      : undefined;
  const preferredEffort =
    typeof payload.agentOptions?.effort === 'string' && payload.agentOptions.effort.trim()
      ? payload.agentOptions.effort.trim()
      : undefined;
  const preferredApproval =
    typeof payload.agentOptions?.approvalPolicy === 'string' &&
    payload.agentOptions.approvalPolicy.trim()
      ? payload.agentOptions.approvalPolicy.trim()
      : undefined;
  const preferredThreadId =
    typeof payload.agentOptions?.threadId === 'string' &&
    payload.agentOptions.threadId.trim()
      ? payload.agentOptions.threadId.trim()
      : undefined;
  const requestedRuntimeId =
    typeof payload.agentOptions?.runtimeId === 'string' &&
    payload.agentOptions.runtimeId.trim()
      ? payload.agentOptions.runtimeId.trim()
      : undefined;
  const wantedAdapter = resolveSessionAdapterId(requestedRuntimeId);
  const preferredCollab =
    typeof payload.agentOptions?.collaborationMode === 'string' &&
    payload.agentOptions.collaborationMode.trim()
      ? payload.agentOptions.collaborationMode.trim()
      : undefined;
  const preferPersistent =
    payload.agentOptions?.ephemeral === false
      ? true
      : payload.agentOptions?.ephemeral === true
        ? false
        : undefined;

  // 1. 组装不可变学情快照
  const rawSnapshot = await server.contextBuilder.buildTurnSnapshot(
    userId,
    server.learnerRepo,
    payload.contextSnapshot
  );
  // P3-3 阅读消毒：截断超长文本，不可见归属丢弃整个 focus，turn 继续。
  const snapshot = await sanitizeSnapshotReading(server.learnerRepo, userId, rawSnapshot);

  // 2. 发出回合启动通知
  const intent = payload.intent || snapshot.userIntentHint || 'EXPLAIN';
  const agentLane = resolveAgentLane(intent, payload.agentOptions?.lane);
  const startEnvelope: WsEnvelope = {
    version: '1.0',
    id: generateId('turn'),
    sessionId: envelope.sessionId,
    type: WsEventTypes.AGENT_TURN_START,
    payload: { intent, focus: snapshot.focus, lane: agentLane },
    timestamp: Date.now(),
  };
  if (emit) emit(startEnvelope);

  // 3. 建立打断控制器
  const abortController = new AbortController();
  server.activeStreamControllers.set(envelope.sessionId, abortController);
  server.activeTurnEmit = emit;
  server.activeTurnLane.set(envelope.sessionId, agentLane);
  // P3-C：记录回合起始时间，供执行摘要计算耗时
  const turnStartedAt = Date.now();

  let reply = '';
  let toolResults: unknown = undefined;
  let replySource: 'codex' | 'lite' | 'local' = 'local';
  let codexThreadId: string | undefined;
  let codexFailureMessage: string | undefined;
  // P3-C：保留 Codex 失败的结构化业务错误，供执行摘要翻译为用户友好状态（不泄漏栈）
  let codexFailureError: BusinessError | undefined;
  // 请求的工具缺注册表实现时记名：回执透出，前端可直接提示用户重启网关，不让模型背锅。
  let toolWarnings: string[] = [];

  try {
    const track = normalizeTrackLanguage(snapshot.targetLanguage);
    // 所有连网回合一律经 AgentRouter（含 Codex 主通路）：关键词模板短路已删除，
    // 任何触发词不再截获回合；离线兜底走客户端，失败走结构化回退（徽章可辨）。
    if (!reply) {
      const decision = selectAgentRoute({
        userPrompt,
        intent: typeof intent === 'string' ? intent : undefined,
        targetLanguage: track,
      });

      if (decision.route === 'responses-lite') {
        const coach = resolveResponsesLiteCoach({
          prompt: userPrompt,
          track,
        });
        if (coach) {
          reply = coach.reply;
          replySource = 'lite';
        }

        if (!reply) {
          const liteSessionRes = await server.responsesAdapter.createSession({
            sessionId: envelope.sessionId,
            userId,
          });
          if (isOk(liteSessionRes)) {
            let liteOut = '';
            for await (const ev of liteSessionRes.value.send({
              message: userPrompt,
              contextSnapshot: snapshot,
            })) {
              if (abortController.signal.aborted) break;
              if (ev.type === 'TEXT_DELTA' && 'delta' in ev && ev.delta) {
                liteOut += ev.delta;
              } else if (ev.type === 'COMPLETED' && 'finalOutput' in ev && ev.finalOutput) {
                liteOut = String(ev.finalOutput);
              } else if (ev.type === 'ERROR' && 'error' in ev) {
                return err(ev.error);
              }
            }
            if (liteOut) {
              reply = liteOut;
              replySource = 'lite';
            }
          }
        }
      }

      // learning-loop：优先真实 Codex App Server 流式（复用本机 login）
      let streamedFromCodex = false;
      let codexFailHint = '';
      if (!reply && decision.route === 'learning-loop') {
        // 固定任务显式工具集优先（task 命中中央目录 > 自带 tools 字面量）；未声明走中央目录的意图+提示词子集（只在建新会话时生效）。
        const preferredTools = Array.isArray(payload.agentOptions?.tools)
          ? payload.agentOptions.tools.filter((name): name is string => typeof name === 'string' && name.length > 0)
          : [];
        const requestedTools = resolveTaskTools(
          typeof payload.agentOptions?.task === 'string' ? payload.agentOptions.task : undefined,
        ) ?? preferredTools;
        // 意图感知 Tool 子集（READ 按意图、WRITE 须明示；只在建新会话时生效）
        const resolvedNames = requestedTools.length > 0 ? requestedTools : resolveSessionTools({
          ...(typeof intent === 'string' ? { intent } : {}),
          userPrompt,
        });
        const dropped = resolvedNames.filter((name) => !server.toolRegistry.get(name));
        if (dropped.length > 0) {
          toolWarnings = [...dropped];
          console.warn(`[turn-tools] 注册表缺失请求工具（已丢弃，网关构建过期请重启到最新）: ${dropped.join(', ')}`);
        }
        const learningTools = resolvedNames
          .map((name) => server.toolRegistry.get(name))
          .filter((tool): tool is ToolDefinition => Boolean(tool));
        // 显式任务一个工具都落不到注册表：直接失败，不建会话、不烧模型轮次、不让模型瞎编“找不到”。
        if (requestedTools.length > 0 && learningTools.length === 0) {
          reply = `当前网关缺少任务所需工具（${requestedTools.join('、')}），请把网关更新到最新构建后重启，再重发一次。`;
          replySource = 'local';
        }

        // 按 lane 复用会话（coach 与 learning 互不共享）；换适配器必重建
        //（跨协议 resume 无意义：Codex threadId 对 ACP 不是会话）。
        let agentSession =
          server.sessionManager.getAgentSession(envelope.sessionId, agentLane) ?? null;
        let adapterSwitched = false;
        if (agentSession) {
          const currentAdapter = agentSession instanceof AcpAgentSession ? 'acp' : 'codex';
          if (currentAdapter !== wantedAdapter) {
            void agentSession.close();
            server.sessionManager.detachAgentSession(envelope.sessionId, agentLane);
            agentSession = null;
            adapterSwitched = true;
          }
        }

        // 固定任务升级：复用会话缺本轮解析集即关旧建新；升级必换线程
        //（续接旧线程工具不变，换会话不换线程等于没升）。
        let resumeThreadId = resolveResumeThreadId(preferredThreadId, requestedTools);
        if (adapterSwitched) resumeThreadId = undefined;
        const upgradeWanted = resolvedNames.filter((name) => server.toolRegistry.get(name));
        if (agentSession && upgradeWanted.length > 0) {
          const have = (agentSession.toolSpecs ?? []).map(spec => spec.businessName || spec.name);
          if (needsSessionToolUpgrade(have, upgradeWanted)) {
            resumeThreadId = undefined;
            void agentSession.close();
            server.sessionManager.detachAgentSession(envelope.sessionId, agentLane);
            agentSession = null;
          }
        }

        if (
          agentSession &&
          preferredThreadId &&
          agentSession.threadId &&
          agentSession.threadId !== preferredThreadId
        ) {
          void agentSession.close();
          server.sessionManager.detachAgentSession(envelope.sessionId, agentLane);
          agentSession = null;
        }

        if (!agentSession && !reply) {
          const sessionOpts: {
            sessionId: string;
            userId: string;
            tools?: ToolDefinition[];
            model?: string;
            effort?: string;
            approvalPolicy?: string;
            resumeThreadId?: string;
            ephemeral?: boolean;
          } = {
            // 同一 Gateway WS session 下按 lane 分 key，避免 CodexAdapter 互相覆盖
            sessionId: `${envelope.sessionId}:${agentLane}`,
            userId,
            tools: learningTools,
          };
          if (preferredModel) sessionOpts.model = preferredModel;
          if (preferredEffort) sessionOpts.effort = preferredEffort;
          if (preferredApproval) sessionOpts.approvalPolicy = preferredApproval;
          if (resumeThreadId) sessionOpts.resumeThreadId = resumeThreadId;
          if (preferPersistent === true) sessionOpts.ephemeral = false;
          if (preferPersistent === false) sessionOpts.ephemeral = true;

          const adapter = wantedAdapter === 'acp'
            ? server.acpAdapterPool.get(requestedRuntimeId ?? 'codex-acp')
            : server.agentAdapter;
          const sessionRes = await adapter.createSession(sessionOpts);
          if (isOk(sessionRes)) {
            server.sessionManager.attachAgentSession(
              envelope.sessionId,
              sessionRes.value,
              agentLane
            );
            agentSession = sessionRes.value;
          } else {
            codexFailHint =
              sessionRes.error.userMessage || 'Codex 服务暂时不可用，请稍后重试。';
            codexFailureMessage = codexFailHint;
            codexFailureError = sessionRes.error;
            console.warn(
              `[codex-session] ${sessionRes.error.code} ${codexFailHint}`
            );
          }
        }

        if (agentSession && !reply) {
          if (agentSession.threadId) codexThreadId = agentSession.threadId;
          let acc = '';
          for await (const ev of agentSession.send({
            message: userPrompt,
            contextSnapshot: snapshot,
            turnOptions: {
              ...(preferredModel ? { model: preferredModel } : {}),
              ...(preferredEffort ? { effort: preferredEffort } : {}),
              ...(preferredApproval ? { approvalPolicy: preferredApproval } : {}),
              ...(preferredCollab ? { collaborationMode: preferredCollab } : {}),
            },
          })) {
            if (abortController.signal.aborted) {
              await agentSession.interrupt();
              break;
            }
            if (ev.type === 'TEXT_DELTA' && ev.delta) {
              acc += ev.delta;
              streamedFromCodex = true;
              if (emit) {
                emit({
                  version: '1.0',
                  id: generateId('delta'),
                  sessionId: envelope.sessionId,
                  type: WsEventTypes.AGENT_TEXT_DELTA,
                  payload: {
                    delta: ev.delta,
                    textDelta: ev.delta,
                    source: 'codex',
                    lane: agentLane,
                  },
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
                  payload: { delta: ev.delta, lane: agentLane },
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
                    lane: agentLane,
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
                    lane: agentLane,
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
                    lane: agentLane,
                  },
                  timestamp: Date.now(),
                });
              }
            } else if (ev.type === 'COMPLETED' && ev.finalOutput) {
              if (!acc) acc = String(ev.finalOutput);
            } else if (ev.type === 'ERROR') {
              streamedFromCodex = false;
              acc = '';
              codexFailHint =
                ev.error?.userMessage || 'Codex 服务暂时不可用，请稍后重试。';
              codexFailureMessage = codexFailHint || undefined;
              codexFailureError = ev.error;
              console.warn(
                `[codex-turn] ${ev.error?.code ?? 'E_CODEX_TURN'} ${codexFailHint}`
              );
              // 出错时丢弃坏会话，下轮重建
              void agentSession.close();
              server.sessionManager.detachAgentSession(envelope.sessionId, agentLane);
              break;
            }
          }
          if (acc) {
            reply = acc;
            streamedFromCodex = true;
            replySource = 'codex';
          }
        }
      }

      if (!reply) {
        reply = buildGenericCoachReply({
          track,
          userPrompt,
          focusLabel: snapshot.focus?.skillTag || snapshot.focus?.surface,
        });
        replySource = 'local';
        if (codexFailHint) {
          reply += formatCodexLocalFallbackNote(codexFailHint, codexFailureError);
        }
      }

      // 非 Codex 真流式时：本地文案假分块推流
      if (!streamedFromCodex) {
        const chunkSize = 6;
        for (let i = 0; i < reply.length; i += chunkSize) {
          if (abortController.signal.aborted) {
            break;
          }
          const chunk = reply.slice(i, i + chunkSize);
          const deltaEnvelope: WsEnvelope = {
            version: '1.0',
            id: generateId('delta'),
            sessionId: envelope.sessionId,
            type: WsEventTypes.AGENT_TEXT_DELTA,
            payload: { delta: chunk, textDelta: chunk, source: replySource },
            timestamp: Date.now(),
          };
          if (emit) emit(deltaEnvelope);
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
    }
  } finally {
    server.activeStreamControllers.delete(envelope.sessionId);
    server.activeTurnEmit = undefined;
    server.activeTurnLane.delete(envelope.sessionId);
  }

  const isInterrupted = abortController.signal.aborted;
  let queueRemaining = 0;
  if (codexThreadId && !isInterrupted) {
    const queued = await server.listAgentQueue({ sessionId: codexThreadId, limit: 20 });
    if (isOk(queued)) queueRemaining = queued.value.items.length;
  }
  // P3-C：统一执行摘要（普通回合）
  const outcome: 'streamed' | 'fallback' | 'not_requested' =
    replySource === 'codex'
      ? 'streamed'
      : codexFailureMessage
        ? 'fallback'
        : 'not_requested';
  const summary = buildTurnExecutionSummary({
    status: isInterrupted ? 'INTERRUPTED' : 'COMPLETED',
    startedAt: turnStartedAt,
    source: replySource,
    outcome,
    failureError: isInterrupted ? null : codexFailureError ?? null,
    failureCategory: isInterrupted ? 'INTERRUPTED' : codexFailureError ? undefined : undefined,
    queueRemaining,
    lane: agentLane,
    threadId: codexThreadId,
    model: preferredModel,
    legacyFailureMessage: codexFailureMessage,
  });
  const completedEnvelope: WsEnvelope = {
    version: '1.0',
    id: generateId('done'),
    sessionId: envelope.sessionId,
    type: WsEventTypes.AGENT_TURN_COMPLETED,
    payload: {
      finalOutput: reply,
      toolResults,
      // P3-C 结构化执行摘要（含 status/source/outcome/failure/elapsedMs/queueRemaining/lane/threadId/model）
      ...summary,
      // 旧字段兼容（codexOutcome / codexFailureMessage）保留，便于过渡期前端旧逻辑
      codexOutcome: outcome,
      ...(codexFailureMessage ? { codexFailureMessage } : {}),
      ...(toolWarnings.length > 0 ? { toolWarnings } : {}),
      // 诊断回显：本轮实际服务的适配器与请求的运行时（排障时一眼定责）。
      adapter: wantedAdapter,
      ...(requestedRuntimeId ? { runtimeId: requestedRuntimeId } : {}),
    },
    timestamp: Date.now(),
  };
  if (emit) emit(completedEnvelope);

  return ok(completedEnvelope);
}
