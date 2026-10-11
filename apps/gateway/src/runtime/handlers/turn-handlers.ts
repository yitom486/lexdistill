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
import { runtimeSupportsSessionTools } from '../router/runtime-catalog.js';
import { checkProvenOptions } from '../router/model-effort-guard.js';
import { needsSessionToolUpgrade, resolveResumeThreadId } from '../router/session-tools.js';
import { resolveResponsesLiteCoach } from '../responses-lite-coach.js';
import { buildTurnExecutionSummary, formatAgentLocalFallbackNote } from '../turn-summary-builder.js';

function resolveAgentLane(
  intent: string,
  explicit?: string | null
): AgentLane {
  if (explicit === 'coach' || explicit === 'learning') return explicit;
  // 聊天界面专用；出题/批改/题目讲解走 learning，与 coach thread 隔离
  if (intent === 'FREE_COACH') return 'coach';
  return 'learning';
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
      effort?: string;
      approvalPolicy?: string;
      threadId?: string;
      ephemeral?: boolean;
      /** 显式工具 allowlist（业务名）：固定任务直接采用，不走关键词正则 */
      tools?: string[];
      /** 固定任务 id（命中中央目录 TASK_TOOL_PRESETS 直接采用；未知 id 回退 tools/提示词） */
      task?: string;
      /** Agent 运行时 id（网关按 runtime 选池适配器；缺席/未知走默认 codex-acp） */
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
  // 全回合一律走 ACP 池：运行时 id 由池归一，缺席即 codex-acp。
  const wantedAdapter = 'acp' as const;
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
  server.activeTurnLane.set(envelope.sessionId, agentLane);
  // P3-C：记录回合起始时间，供执行摘要计算耗时
  const turnStartedAt = Date.now();

  let reply = '';
  let toolResults: unknown = undefined;
  let replySource: 'agent' | 'lite' | 'local' = 'local';
  let agentThreadId: string | undefined;
  let agentFailureMessage: string | undefined;
  // P3-C：保留 Agent 失败的结构化业务错误，供执行摘要翻译为用户友好状态（不泄漏栈）
  let agentFailureError: BusinessError | undefined;
  // 请求的工具缺注册表实现时记名：回执透出，前端可直接提示用户重启网关，不让模型背锅。
  let toolWarnings: string[] = [];
  // ACP 上下文用量（send 循环内采集，会话对象出作用域后回执仍可用）。
  let turnContextUsage: { used: number; size: number } | null = null;
  // ACP 新会话首轮身份前置（session/new 无 systemPrompt 字段，身份只能随首条消息下达）。
  let isNewAcpConversation = false;

  try {
    const track = normalizeTrackLanguage(snapshot.targetLanguage);
    // 所有连网回合一律经 AgentRouter：关键词模板短路已删除，
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

      // learning-loop：ACP 池流式（按 lane 复用会话，运行时按需归一）
      let streamedFromAgent = false;
      let agentFailHint = '';
      if (!reply && decision.route === 'learning-loop') {
        // 固定任务显式工具集优先（task 命中中央目录 > 自带 tools 字面量）；未声明走中央目录的意图+提示词子集（只在建新会话时生效）。
        const preferredTools = Array.isArray(payload.agentOptions?.tools)
          ? payload.agentOptions.tools.filter((name): name is string => typeof name === 'string' && name.length > 0)
          : [];
        const fixedTaskId =
          typeof payload.agentOptions?.task === 'string' ? payload.agentOptions.task : undefined;
        const fixedTaskTools = resolveTaskTools(fixedTaskId);
        const requestedTools = fixedTaskTools ?? preferredTools;
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
        // 缺工具与运行时门禁均为纯本地判定，一律在探针之前：被拦的回合不拉探针子进程、不建会话。
        if (requestedTools.length > 0 && learningTools.length === 0) {
          reply = `当前网关缺少任务所需工具（${requestedTools.join('、')}），请把网关更新到最新构建后重启，再重发一次。`;
          replySource = 'local';
        }
        // 固定工具任务运行时门禁：任务要求模型经会话 MCP 调回网关工具并多轮协作；
        // 未验证的运行时（如 agy）实测无视 MCP、空转内置工具至 session/prompt 超时。
        // 直接 fail-fast 明示切换，不探针、不建会话、不烧模型轮次。
        if (!reply && fixedTaskTools && fixedTaskTools.length > 0
          && !runtimeSupportsSessionTools(requestedRuntimeId)) {
          const shownRuntime = requestedRuntimeId || '默认';
          reply = `当前 Agent 运行时（${shownRuntime}）暂不支持词汇 AI 讲解所需的工具调用（实测会在工具调用阶段超时无响应），请把 Agent 运行时切换为 ChatGPT（codex-acp）或 OpenCode 后，再点一次「生成讲解」。本次未发送模型请求。`;
          replySource = 'local';
        }
        // ACP 模型/思考深度校验（网关唯一口径，见 model-effort-guard；变体档只对探针时刻模型背书）。
        // 只在继续真实建会话时探针；已被 fail-fast 的回合不拉子进程。
        let dropModel = false;
        let dropEffort = false;
        if (!reply && (preferredModel || preferredEffort)) {
          // 按模型级联验证：档位表随模型变，用目标模型的档位表证伪才准确。
          const proven = await server.acpAdapterPool.getRuntimeOptions(
            requestedRuntimeId ?? 'codex-acp',
            preferredModel ? { model: preferredModel } : undefined,
          );
          const checked = checkProvenOptions(proven, preferredModel, preferredEffort);
          dropModel = checked.dropModel;
          dropEffort = checked.dropEffort;
          toolWarnings.push(...checked.warnings);
        }
        // 按 lane 复用会话（coach 与 learning 互不共享；单适配器，无跨协议切换）。
        let agentSession =
          server.sessionManager.getAgentSession(envelope.sessionId, agentLane) ?? null;

        // 固定任务升级：复用会话缺本轮解析集即关旧建新；升级必换线程
        //（续接旧线程工具不变，换会话不换线程等于没升）。
        let resumeThreadId = resolveResumeThreadId(preferredThreadId, requestedTools);
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
            // 同一 Gateway WS session 下按 lane 分 key，会话互不覆盖
            sessionId: `${envelope.sessionId}:${agentLane}`,
            userId,
            tools: learningTools,
          };
          if (preferredModel && !dropModel) sessionOpts.model = preferredModel;
          if (preferredEffort && !dropEffort) sessionOpts.effort = preferredEffort;
          if (preferredApproval) sessionOpts.approvalPolicy = preferredApproval;
          if (resumeThreadId) sessionOpts.resumeThreadId = resumeThreadId;
          if (preferPersistent === true) sessionOpts.ephemeral = false;
          if (preferPersistent === false) sessionOpts.ephemeral = true;

          // 具名运行时走池；缺席走默认适配器（产品为 codex-acp 池实例，测试可覆盖）。
          // 池按 runtime 记忆单例，默认实例与 codex-acp 池实例为同一对象。
          const adapter = requestedRuntimeId
            ? server.acpAdapterPool.get(requestedRuntimeId)
            : server.agentAdapter;
          const sessionRes = await adapter.createSession(sessionOpts);
          if (isOk(sessionRes)) {
            server.sessionManager.attachAgentSession(
              envelope.sessionId,
              sessionRes.value,
              agentLane
            );
            agentSession = sessionRes.value;
            // ACP 建会话偏好降级（模型/思考深度未生效）合并进本轮 toast，不静默。
            if (sessionRes.value instanceof AcpAgentSession) {
              toolWarnings.push(...sessionRes.value.drainSetupWarnings());
            }
            // ACP 会话入台账（历史/队列的 id 索引）。
            // 返回值标记本会话首轮：首条消息前置导师身份（ACP 协议无建会话身份通道）。
            if (sessionRes.value.threadId) {
              isNewAcpConversation = server.acpLedger.recordSessionCreated({
                acpSessionId: sessionRes.value.threadId,
                userId,
                lane: agentLane,
                runtimeId: requestedRuntimeId ?? 'codex-acp',
                ...(preferredModel && !dropModel ? { model: preferredModel } : {}),
                ...(preferredEffort && !dropEffort ? { effort: preferredEffort } : {}),
              });
            }
          } else {
            agentFailHint =
              sessionRes.error.userMessage || 'Agent 服务暂时不可用，请稍后重试。';
            agentFailureMessage = agentFailHint;
            agentFailureError = sessionRes.error;
            console.warn(
              `[agent-session] ${sessionRes.error.code} ${agentFailHint}`
            );
          }
        }

        if (agentSession && !reply) {
          if (agentSession.threadId) agentThreadId = agentSession.threadId;
          let acc = '';
          // 新 ACP 会话首条消息前置导师身份（常驻上下文靠会话 resume；重启失忆则用户重开话题即重建）。
          // 老会话（身份版本之前建档）由台账补一次：续跑的旧上下文借此纠正身份。
          const trackLabel = track === 'ja' ? '日语' : track === 'en' ? '英语' : track === 'ko' ? '韩语' : '外语';
          const needsIdentity = isNewAcpConversation
            || (agentThreadId ? server.acpLedger.ensureIdentityApplied(agentThreadId) : false);
          const sendMessage = needsIdentity
            ? `你是 Lingua Studio（${trackLabel}学习应用）中的 AI 导师，只教${trackLabel}、只聊学习；直接用中文回答，正文前不加英文前缀、不自我介绍，直接讲内容。\n\n${userPrompt}`
            : userPrompt;
          for await (const ev of agentSession.send({
            message: sendMessage,
            contextSnapshot: snapshot,
          })) {
            if (abortController.signal.aborted) {
              await agentSession.interrupt();
              break;
            }
            if (ev.type === 'TEXT_DELTA' && ev.delta) {
              acc += ev.delta;
              streamedFromAgent = true;
              if (emit) {
                emit({
                  version: '1.0',
                  id: generateId('delta'),
                  sessionId: envelope.sessionId,
                  type: WsEventTypes.AGENT_TEXT_DELTA,
                  payload: {
                    delta: ev.delta,
                    textDelta: ev.delta,
                    source: 'agent',
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
              streamedFromAgent = false;
              acc = '';
              agentFailHint =
                ev.error?.userMessage || 'Agent 服务暂时不可用，请稍后重试。';
              agentFailureMessage = agentFailHint || undefined;
              agentFailureError = ev.error;
              console.warn(
                `[agent-turn] ${ev.error?.code ?? 'E_AGENT_TURN'} ${agentFailHint}`
              );
              // 出错时丢弃坏会话，下轮重建
              void agentSession.close();
              server.sessionManager.detachAgentSession(envelope.sessionId, agentLane);
              break;
            }
          }
          if (acc) {
            reply = acc;
            streamedFromAgent = true;
            replySource = 'agent';
          }
          if (agentSession instanceof AcpAgentSession) {
            turnContextUsage = agentSession.getLastUsage();
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
        if (agentFailHint) {
          reply += formatAgentLocalFallbackNote(agentFailHint, agentFailureError);
        }
      }

      // 非真流式时：本地文案假分块推流
      if (!streamedFromAgent) {
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
  // ACP transcript 入台账（历史面板数据源；上下文恢复靠 session/load，不靠回放解析）。
  if (agentThreadId && reply) {
    server.acpLedger.recordTurn(agentThreadId, { user: userPrompt, agent: reply, source: replySource });
  }
  } finally {
    server.activeStreamControllers.delete(envelope.sessionId);
    server.activeTurnLane.delete(envelope.sessionId);
  }

  const isInterrupted = abortController.signal.aborted;
  let queueRemaining = 0;
  if (agentThreadId && !isInterrupted) {
    const queued = await server.listAgentQueue({ sessionId: agentThreadId, limit: 20 });
    if (isOk(queued)) queueRemaining = queued.value.items.length;
  }
  // P3-C：统一执行摘要（普通回合）
  const outcome: 'streamed' | 'fallback' | 'not_requested' =
    replySource === 'agent'
      ? 'streamed'
      : agentFailureMessage
        ? 'fallback'
        : 'not_requested';
  const summary = buildTurnExecutionSummary({
    status: isInterrupted ? 'INTERRUPTED' : 'COMPLETED',
    startedAt: turnStartedAt,
    source: replySource,
    outcome,
    failureError: isInterrupted ? null : agentFailureError ?? null,
    failureCategory: isInterrupted ? 'INTERRUPTED' : agentFailureError ? undefined : undefined,
    queueRemaining,
    lane: agentLane,
    threadId: agentThreadId,
    model: preferredModel,
    legacyFailureMessage: agentFailureMessage,
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
      // ACP 上下文用量（usage_update 只读透传；配额类无 ACP 对应物，不编）。
      ...(turnContextUsage ? { contextUsage: turnContextUsage } : {}),
      // 新字段（agentOutcome / agentFailureMessage）与旧字段（codexOutcome / codexFailureMessage）
      // 同值双发：旧前端读旧字段，新前端读新字段。
      agentOutcome: outcome,
      codexOutcome: outcome,
      ...(agentFailureMessage ? { agentFailureMessage, codexFailureMessage: agentFailureMessage } : {}),
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
