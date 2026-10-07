import { BusinessError, isOk } from '@study-studio/shared';
import type { AgentAdapter, AgentSession } from '@study-studio/agent-runtime';
import type { ExternalToolExecutor } from '@study-studio/agent-runtime';
import type { GenerationBinding, GenerationBlueprint, GenerationConfig, GenerationRunLimits } from '@study-studio/protocol';
import { GENERATION_TOOL_NAMES, createQuestionGenerationTools } from './tools.js';
import type { GenerationAudioRenderer, QuestionGenerationRepository } from './ports.js';
import { assertBlueprintFitsConfig, verifyPaperMeetsBlueprint } from './blueprint.js';
import { buildGenerationSystemPrompt } from './system-prompt.js';
import type { GenerationTaskService } from './service.js';

export interface GenerationRunRequest {
  userId: string;
  taskId: string;
  objective?: string | undefined;
  /** 每任务独立的 Adapter 构造器；调用方注入测试替身或真实 CodexAdapter。 */
  createAdapter: (executeTool: ExternalToolExecutor) => AgentAdapter;
  signal?: AbortSignal | undefined;
}

export interface GenerationRunResult {
  status: 'COMPLETED';
  paperId: string;
  toolCalls: number;
  failedCalls: number;
  durationMs: number;
}

const ALLOWED = new Set<string>(GENERATION_TOOL_NAMES);

/**
 * P1 专用出题运行闭环。
 * - 每任务一个运行所有者（经 GenerationTaskService 守卫），只注入六个专用工具；
 * - 任务身份、冻结配置（含模型）、额度、取消与成功条件由后端保证，不靠提示词；
 * - 完成由数据库资产 + 蓝图核对决定，模型自称完成不算成功。
 *
 * 原生能力隔离说明（不伪装边界）：
 * - 动态工具调用走本运行器提供的 allowlist 执行器，非六个工具一律拒绝；
 * - 会话以 `sandboxMode: 'read-only'`（非 `workspace-write`/`danger-full-access`）、
 *   `approvalPolicy: 'untrusted'` 创建，且运行器对一切审批请求直接 decline，
 *   引擎原生文件/命令/网络动作无法经审批放行（注意绝不使用 auto-accept 的 `never` 档）；
 * - 不传入 `workingDirectory`，不复用主对话 thread，不共享历史；
 * - 残余风险：引擎沙箱内部的只读能力受 Codex 实现约束，不在本公共接口的硬控制内，
 *   已按可用最严档收紧，见回归测试对会话选项的断言。
 */
export async function runGenerationTask(
  service: GenerationTaskService,
  repository: QuestionGenerationRepository,
  audio: GenerationAudioRenderer | undefined,
  request: GenerationRunRequest,
): Promise<GenerationRunResult> {
  const startedAt = Date.now();
  if (request.signal?.aborted) {
    throw new BusinessError('E_GENERATION_CANCELLED', '出题任务已取消', 'TOOL_EXECUTION');
  }
  const taskAbort = new AbortController();
  const onExternalAbort = () => taskAbort.abort();
  request.signal?.addEventListener('abort', onExternalAbort, { once: true });
  // 先校验任务存在与归属（同步 DB 调用，不持有所有者），再占用单运行所有者。
  const snapshot = repository.describeTask(request.userId, request.taskId);
  if (!service.tryAcquireOwner(request.taskId, taskAbort)) {
    request.signal?.removeEventListener('abort', onExternalAbort);
    throw new BusinessError('E_GENERATION_BUSY', '该出题任务已有运行中的所有者，请勿并发执行', 'TOOL_EXECUTION');
  }
  let toolHandle: ReturnType<typeof createQuestionGenerationTools> | undefined;
  let activeSession: AgentSession | undefined;
  let toolCalls = 0;
  let failedCalls = 0;
  let terminalError: BusinessError | undefined;
  // 运行预算覆盖完整生命周期：计时器在占用所有者后立即启动，
  // 覆盖工具创建、会话建立与模型运行全程。
  const deadline = setTimeout(() => taskAbort.abort(), snapshot.runLimits.maxDurationMs);
  try {
    if (snapshot.status !== 'ACTIVE') throw new BusinessError('E_GENERATION_INACTIVE', '任务已结束，不能继续运行', 'VALIDATION');
    if (snapshot.isExpired) throw new BusinessError('E_GENERATION_INACTIVE', '任务已过期，不能继续运行', 'VALIDATION');
    const binding: GenerationBinding = snapshot.binding;
    const config: GenerationConfig = snapshot.config;
    const blueprint: GenerationBlueprint | null = snapshot.blueprint;
    const runLimits: GenerationRunLimits = snapshot.runLimits;
    if (blueprint) assertBlueprintFitsConfig(config, blueprint);

    toolHandle = createQuestionGenerationTools({ repository, ...(audio ? { audio } : {}) },
      binding, config, snapshot.expiresAt,
      { ...(blueprint ? { blueprint } : {}), runLimits, ...(snapshot.objective ? { objective: snapshot.objective } : {}) });

    const registryNames = toolHandle.registry.list().map(t => t.name).sort();
    if (JSON.stringify(registryNames) !== JSON.stringify([...GENERATION_TOOL_NAMES].sort())) {
      throw new BusinessError('E_GENERATION_SCOPE', '专用工具集必须且只能是六个 generation 工具', 'SECURITY');
    }
    const storedObjective = snapshot.objective?.trim() || request.objective?.trim() || '';
    const systemPrompt = buildGenerationSystemPrompt({
      hostConfigJson: toolHandle.dynamicPrompt(),
      ...(storedObjective ? { objective: storedObjective } : {}),
    });

    const expectedEngineSession = `gen:${binding.taskId}`;
    const failTerminal = (error: BusinessError): never => {
      terminalError ??= error;
      // 预算耗尽即终止模型会话，不让模型在超限后继续调用。
      taskAbort.abort();
      throw error;
    };
    const executeTool: ExternalToolExecutor = async (toolName, input, ctx) => {
      if (taskAbort.signal.aborted) throw new BusinessError('E_GENERATION_CANCELLED', '出题任务已取消', 'TOOL_EXECUTION');
      if (ctx.userId !== binding.userId || ctx.sessionId !== expectedEngineSession) throw new BusinessError('E_GENERATION_SCOPE', '工具调用不属于当前任务会话', 'SECURITY');
      if (!ALLOWED.has(toolName)) throw new BusinessError('E_TOOL_NOT_FOUND', `未声明的工具[${toolName}]已拒绝`, 'SECURITY');
      if (toolCalls >= runLimits.maxModelRounds) failTerminal(new BusinessError('E_GENERATION_QUOTA', '模型调用轮次已用完，已终止模型会话', 'TOOL_EXECUTION'));
      toolCalls++;
      const result = await toolHandle!.registry.execute(toolName, input, binding);
      if (!isOk(result)) {
        failedCalls++;
        if (failedCalls > runLimits.maxRepairAttempts) failTerminal(new BusinessError('E_GENERATION_QUOTA', '工具失败修复次数已用完，已终止模型会话', 'TOOL_EXECUTION'));
        throw result.error;
      }
      return result.value;
    };

    const adapter = request.createAdapter(executeTool);
    const sessionRes = await adapter.createSession({
      sessionId: expectedEngineSession,
      userId: binding.userId,
      systemPrompt,
      tools: toolHandle.registry.list(),
      // 冻结模型：以任务配置为准，不接受调用方覆盖，避免记录与实际运行不一致。
      model: config.modelId,
      approvalPolicy: 'untrusted',
      sandboxMode: 'read-only',
      ephemeral: true,
    });
    if (!isOk(sessionRes)) throw sessionRes.error;
    activeSession = sessionRes.value;
    const specs = activeSession.toolSpecs ?? [];
    if (specs.length > 0) {
      const declared = new Set(specs.map(s => s.businessName ?? s.name));
      for (const name of declared) {
        if (!ALLOWED.has(name) && ![...ALLOWED].some(a => a.replace(/[^a-zA-Z0-9_]/g, '_') === name || a === name)) {
          throw new BusinessError('E_GENERATION_SCOPE', '适配器上报了专用工具之外的原生能力，已拒绝运行', 'SECURITY');
        }
      }
    }

    const onAbortInterrupt = () => {
      void activeSession?.interrupt().catch(() => undefined);
      // 取消立即传导到工具侧（含听力音频）：不等模型回话，先中止底层 TTS 并收尾。
      void toolHandle?.dispose().catch(() => undefined);
    };
    taskAbort.signal.addEventListener('abort', onAbortInterrupt, { once: true });
    // 挂载后若已取消（取消恰好发生在占用与挂载之间），立即中断一次，避免信号丢失。
    if (taskAbort.signal.aborted) onAbortInterrupt();
    try {
      const message = (storedObjective || '按冻结配置完成出题：先读配置与授权教材，按需提交题目、生成听力音频并组装试卷。只汇报真实工具回执。').slice(0, 2000);
      let finalOutput: string | undefined;
      let sawError: BusinessError | undefined;
      for await (const event of activeSession.send({ message })) {
        if (event.type === 'APPROVAL_REQUESTED') {
          // 专用出题会话不放行任何审批动作：直接拒绝，不打扰用户、不挂起等待。
          await activeSession.submitApproval(event.approvalId, 'decline').catch(() => undefined);
          continue;
        }
        if (taskAbort.signal.aborted) break;
        if (event.type === 'ERROR') { sawError = event.error; break; }
        if (event.type === 'COMPLETED') { finalOutput = event.finalOutput; break; }
      }
      if (terminalError) throw terminalError;
      if (taskAbort.signal.aborted) throw new BusinessError('E_GENERATION_CANCELLED', '出题任务已取消或超时', 'TOOL_EXECUTION');
      if (sawError) throw sawError;
      void finalOutput;

      // 成功由数据库资产决定，不由模型结论决定。
      const papers = repository.listTaskPapers(request.userId, request.taskId);
      if (papers.length === 0) throw new BusinessError('E_GENERATION_INCOMPLETE', '模型未保存任何试卷，不能视为成功', 'TOOL_EXECUTION');
      const latest = papers[papers.length - 1]!;
      const detail = repository.readTaskPaper(request.userId, request.taskId, latest.paperId);
      if (detail.items.length === 0) throw new BusinessError('E_GENERATION_INCOMPLETE', '最终试卷为空，不能视为成功', 'TOOL_EXECUTION');
      if (blueprint) verifyPaperMeetsBlueprint(detail, blueprint);
      // 听力必须已有可用音频（组装时已强制，这里显式复核，避免部分成功伪装完整）。
      const readyAudio = new Set(repository.describeTask(request.userId, request.taskId).audio.map(a => a.materialId));
      for (const item of detail.items) {
        if (item.category === 'LISTENING' && (!item.materialId || !readyAudio.has(item.materialId))) {
          throw new BusinessError('E_GENERATION_INCOMPLETE', '听力题缺少可用音频，不能视为成功', 'TOOL_EXECUTION');
        }
      }
      if (taskAbort.signal.aborted) throw new BusinessError('E_GENERATION_CANCELLED', '出题任务已取消或超时', 'TOOL_EXECUTION');
      await toolHandle.dispose('COMPLETED');
      await activeSession.close().catch(() => undefined);
      return { status: 'COMPLETED', paperId: latest.paperId, toolCalls, failedCalls, durationMs: Date.now() - startedAt };
    } finally {
      taskAbort.signal.removeEventListener('abort', onAbortInterrupt);
    }
  } catch (error) {
    try { await toolHandle?.dispose(); } catch { /* 收尾失败不掩盖原错 */ }
    try { await activeSession?.close().catch(() => undefined); } catch { /* ignore */ }
    // 预算耗尽触发的终止按原配额错误报告，不掩盖为普通取消。
    if (terminalError) throw terminalError;
    throw error instanceof BusinessError ? error : new BusinessError('E_GENERATION_FAILED', '出题运行失败', 'TOOL_EXECUTION');
  } finally {
    clearTimeout(deadline);
    service.releaseOwner(request.taskId);
    request.signal?.removeEventListener('abort', onExternalAbort);
  }
}
