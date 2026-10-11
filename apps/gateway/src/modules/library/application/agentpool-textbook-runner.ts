/**
 * agentpools 驱动的正文提炼执行（替代已删除的自研 ChapterSessionPool）。
 *
 * 每任务：建 MCP 任务（每 Worker 独立端点）→ 起池（sharedProcess，固定 cwd，
 * 用户模型/MCP 注入）→ 各 Worker 不带序号领租约（池按需给空闲者，忙则排队），
 * 从共享游标取下一章 → 每章建作用域→ask→暂存有效则整章事务保存 →
 * 收尾释放 lease、关池、撤销任务。章节不预分堆，空闲者多做；领不到租约且无人
 * 认领的章节逐项记失败，不丢不重跑。
 * 取消/超时可达实际活动请求；首响应与 stall 判定只依据真实活动标记。
 */
import { BusinessError, generateId, translateToBusinessError, type Result } from '@study-studio/shared';
import type { AgentPoolLease } from '@study-studio/agent-runtime';
import type { TextbookLessonStage, TextbookModelActivity } from '@study-studio/document-model';
import type { AgentPoolDriver } from '@study-studio/agent-runtime';
import { GatewayAgentpoolDriver } from '../../../infrastructure/agentpools/agentpool-driver.js';
import { TextbookMcpRegistry } from '../mcp/textbook-mcp-server.js';
import { buildTextbookWorkerMcpServer } from '../mcp/textbook-mcp-catalog.js';
import type { McpChapterScope } from '../mcp/textbook-mcp-scope.js';
import { buildLessonExtractionPrompt } from './prompts/lesson-extraction-prompt.js';
import type { LessonExtractionJob } from './lesson-batch-extractor.js';
import type { ImportMonitor } from './import-monitor.js';
import type { CommitLessonKnowledgeOutput } from '../ports.js';

export interface AgentpoolRunInput {
  registry: TextbookMcpRegistry;
  gatewayBaseUrl: string;
  userId: string;
  documentId: string;
  jobs: LessonExtractionJob[];
  poolSize: number;
  model?: string | undefined;
  /** ACP 运行时 id（缺席即 codex-acp 默认）。 */
  runtimeId?: string | undefined;
  workingDirectory: string;
  allowAiExercises: boolean;
  forceOverwrite?: boolean;
  firstResponseTimeoutMs: number;
  stallTimeoutMs: number;
  /** 单章绝对墙钟上限：活动再多也会中断，防止空转拖住整批。 */
  wallTimeoutMs: number;
  toolRepairRetries?: number;
  modelRetries: number;
  storageRetries: number;
  signal: AbortSignal;
  monitor?: ImportMonitor;
  emit: (
    lessonId: string,
    stage: TextbookLessonStage,
    stats?: { vocabCount: number; grammarCount: number; exerciseCount: number; hasPassage: boolean },
    error?: string,
    allLessonsReady?: boolean,
    activity?: TextbookModelActivity,
  ) => void;
  fail: (lessonId: string, error: BusinessError) => void;
  markSaved: (lessonId: string, stats: CommitLessonKnowledgeOutput['stats'], receipt: CommitLessonKnowledgeOutput) => void;
  /**
   * 测试接缝：每轮 ask 前调用（首轮 + 每次模型重试）。
   * 确定性“模型”脚本经 scope.submission 直接提交，与 ask 文本无关。生产不传。
   */
  onChapterScope?: (scope: McpChapterScope, job: LessonExtractionJob, attempt: number) => void | Promise<void>;
  /**
   * 章节开工备料（如扫描版烘图）：取到章节后、组提示词前调用，失败则本章记失败。
   * 缺席时直接使用静态 job（文字版与测试 harness 走此路）。
   */
  prepareChapter?: (job: LessonExtractionJob, signal: AbortSignal) => Promise<Result<LessonExtractionJob, BusinessError>>;
}

const EXTRACTION_CLOSING =
  '当前轮只处理系统指定的章节 PDF，自行读取本轮文件。历史材料只作对话历史，不作为本章事实来源。依据本章实际内容选择可用工具提交，类别缺失就省略，不凑齐类别、不生成原文没有的知识点。只填写内容，不填写系统身份、页码或数据库 ID；修改与删除使用本次任务工具回执中的引用。工具报错时按错误说明修正，不能宣称已成功。完成工具提交后返回一句简短结束说明，最终保存结果由系统决定。';

export interface AgentpoolBoot {
  driver: AgentPoolDriver;
  taskToken: string;
  workerCount: number;
}

type AgentpoolBootInput = Pick<AgentpoolRunInput,
  'registry' | 'gatewayBaseUrl' | 'userId' | 'documentId' | 'workingDirectory' |
  'model' | 'runtimeId'> & {
  driver?: AgentPoolDriver;
};

/**
 * 只起池（建任务端点 + 拉进程），不跑章节：调用方在切分 PDF 的同时起池，
 * 装载那 2 秒不再干等。失败时撤销任务端点后直接抛，与原来内联起池语义一致。
 */
export async function bootAgentpoolChapters(input: AgentpoolBootInput, workerCount: number): Promise<AgentpoolBoot> {
  const { taskToken, workerPaths } = input.registry.createTask(input.userId, input.documentId, workerCount);
  try {
    const driver = input.driver ?? (await GatewayAgentpoolDriver.create({
    program: '',
    cwd: input.workingDirectory,
    ...(input.runtimeId ? { acp: { runtimeId: input.runtimeId } } : {}),
    ...(input.model ? { model: input.model } : {}),
    // 每 Worker 只配自己的端点，形状与命名归 textbook-mcp-catalog 所有，后端按名入表不会串。
    // ACP 条目自动预授权（autoApprovePermissions），写入零问话。
    mcpServersForWorker: (_workerIndex: number) => {
      const path = workerPaths[_workerIndex];
      if (!path) return [];
      return [buildTextbookWorkerMcpServer(_workerIndex, input.gatewayBaseUrl, path)];
    },
    poolSize: workerCount,
    sharedProcess: true,
    promptMs: 3_600_000,
    }));
    return { driver, taskToken, workerCount };
  } catch (cause) {
    // 池建不起来：任务端点不能 orphan，直接撤销再抛。
    input.registry.revokeTask(taskToken);
    throw cause;
  }
}

/** 跑完已备好的章节：空闲领任务 + 无人认领记失败，不负责起池关池。 */
export async function runAgentpoolWorkers(input: AgentpoolRunInput, boot: AgentpoolBoot): Promise<void> {
  const activeLeases = new Set<number>();
  const abortAll = () => {
    for (const index of activeLeases) {
      try {
        boot.driver.cancel({ agentIndex: index });
      } catch {
        // 租约已释放时忽略。
      }
    }
  };
  input.signal.addEventListener('abort', abortAll, { once: true });
  try {
    // 空闲领任务：各循环不带序号领租约（池给空闲 Worker），从共享游标取下一章；
    // 同一租约可连续做多章，会话连续性由池侧保持。领不到租约的循环直接退出，
    // 它没拿到的章节由存活循环接走；最后仍无人认领的逐项记失败。
    let cursor = 0;
    const attempted = new Array<boolean>(input.jobs.length).fill(false);
    const leaseFailure: { error?: BusinessError } = {};
    const next = (): LessonExtractionJob | undefined => {
      const index = cursor++;
      if (index >= input.jobs.length) return undefined;
      attempted[index] = true;
      return input.jobs[index];
    };
    await Promise.all(
      Array.from({ length: boot.workerCount }, () => runWorker(input, boot.driver, boot.taskToken, next, activeLeases, leaseFailure)),
    );
    for (let index = 0; index < input.jobs.length; index++) {
      if (!attempted[index]) input.fail(input.jobs[index]!.lessonId, leaseFailure.error ?? new BusinessError('E_AGENTPOOL_LEASE', '无可用会话执行本章', 'AGENT_RUNTIME'));
    }
  } finally {
    input.signal.removeEventListener('abort', abortAll);
    abortAll();
  }
}

/**
 * 关池 + 撤销任务端点。关闭结果必须落实：失败意味着活动会话可能还在读文件，
 * 调用方据此保留临时目录。
 */
export async function closeAgentpoolChapters(
  input: Pick<AgentpoolRunInput, 'registry' | 'monitor'>,
  boot: AgentpoolBoot,
): Promise<{ driverCloseFailed: boolean }> {
  let driverCloseFailed = false;
  try {
    const report = await boot.driver.close(false);
    if (report.closeErrors.length || report.panickedWorkers > 0) {
      driverCloseFailed = true;
      input.monitor?.record('model', 'failed', {
        code: 'E_AGENTPOOL_CLOSE',
        message: `会话池关闭未完成（错误 ${report.closeErrors.length} 项，异常 Worker ${report.panickedWorkers} 个），临时文件已保留待查`,
      }, undefined);
    }
  } catch (cause) {
    driverCloseFailed = true;
    const error = cause instanceof BusinessError ? cause : translateToBusinessError(cause, { category: 'AGENT_RUNTIME', fallbackMessage: '会话池关闭失败' });
    input.monitor?.record('model', 'failed', { code: error.code, message: error.userMessage }, undefined);
  } finally {
    input.registry.revokeTask(boot.taskToken);
  }
  return { driverCloseFailed };
}

export async function runAgentpoolChapters(input: AgentpoolRunInput & { driver?: AgentPoolDriver }): Promise<{ driverCloseFailed: boolean }> {
  const workerCount = Math.max(1, Math.min(input.poolSize, input.jobs.length));
  const boot = await bootAgentpoolChapters(input, workerCount);
  await runAgentpoolWorkers(input, boot);
  return closeAgentpoolChapters(input, boot);
}

function chapterFailure(cause: unknown): BusinessError {
  return cause instanceof BusinessError ? cause : translateToBusinessError(cause, { category: 'AGENT_RUNTIME', fallbackMessage: '章节执行失败' });
}

async function runWorker(
  input: AgentpoolRunInput,
  driver: AgentPoolDriver,
  taskToken: string,
  next: () => LessonExtractionJob | undefined,
  activeLeases: Set<number>,
  leaseFailure: { error?: BusinessError },
): Promise<void> {
  let lease: AgentPoolLease | undefined;
  try {
    lease = await driver.acquire();
  } catch (cause) {
    // 领不到租约只记错误退出，不预占章节；剩余章节由存活循环接走。
    const error = chapterFailure(cause);
    if (!leaseFailure.error) leaseFailure.error = error;
    input.monitor?.record('model', 'failed', { code: error.code, message: error.userMessage }, undefined);
    return;
  }
  // 租约的真实序号决定本循环拿到的 Worker：MCP 端点与作用域按它映射。
  const workerIndex = lease.agentIndex;
  activeLeases.add(lease.agentIndex);
  try {
    for (;;) {
      if (input.signal.aborted) return;
      const job = next();
      if (!job) return;
      try {
        await runChapter(input, driver, taskToken, workerIndex, lease, job);
      } catch (cause) {
        input.fail(job.lessonId, chapterFailure(cause));
      }
    }
  } finally {
    activeLeases.delete(lease.agentIndex);
    await driver.finish(lease).catch(() => undefined);
  }
}

async function runChapter(
  input: AgentpoolRunInput,
  driver: AgentPoolDriver,
  taskToken: string,
  workerIndex: number,
  lease: AgentPoolLease,
  job: LessonExtractionJob,
): Promise<void> {
  const emptyStats = { vocabCount: 0, grammarCount: 0, exerciseCount: 0, hasPassage: false };
  const toolNames = ['write_grammar', 'write_vocabulary', 'write_exercises', 'write_articles', 'write_sentences', 'write_material'];
  input.emit(job.lessonId, 'extracting');
  // 开工备料（扫描版烘图）：与模型轮次重叠，首轮不被拖住；幂等，重试不重复烘。
  if (input.prepareChapter && job.pdfFile) {
    const prepared = await input.prepareChapter(job, input.signal);
    if (!prepared.ok) {
      if (!input.signal.aborted) input.fail(job.lessonId, prepared.error);
      return;
    }
    job.pdfFile = prepared.value.pdfFile ?? job.pdfFile;
  }
  let lastError: BusinessError | undefined;
  let lastAttemptId: string | undefined;
  for (let attempt = 0; attempt <= input.modelRetries && !input.signal.aborted; attempt++) {
    // 每轮新建作用域（上一轮引用自动过期），与原生流每轮重建 submission 一致。
    const sessionId = `pool-worker-${workerIndex}`;
    const scope = input.registry.setChapter(taskToken, workerIndex, {
      userId: input.userId,
      documentId: input.documentId,
      lessonId: job.lessonId,
      assignmentId: generateId('chapter_attempt'),
      allowAiExercises: job.allowAiExercises,
      ...(input.forceOverwrite ? { replaceContent: true } : {}),
      signal: input.signal,
      ...(input.toolRepairRetries !== undefined ? { toolRepairRetries: input.toolRepairRetries } : {}),
      ...(input.monitor ? { monitor: input.monitor, sessionId } : {}),
    });
    if (!scope) {
      input.fail(job.lessonId, new BusinessError('E_SUBMISSION_SCOPE_INVALID', '课程作用域建立失败', 'VALIDATION'));
      input.monitor?.record('session', 'unbound', undefined, { nodeId: job.lessonId, sessionId: `pool-worker-${workerIndex}`, ...(lastAttemptId ? { attemptId: lastAttemptId } : {}) });
      return;
    }
    input.monitor?.record('session', 'bound', { attempt: attempt + 1 }, { nodeId: job.lessonId, sessionId, attemptId: scope.assignment.assignmentId });
    lastAttemptId = scope.assignment.assignmentId;
    if (attempt > 0) {
      input.emit(job.lessonId, 'model_retrying');
      input.monitor?.record('model', 'retry', { message: lastError?.userMessage ?? '应用发起新轮重试', code: lastError?.code ?? 'E_RETRY' },
        { nodeId: job.lessonId, sessionId, attemptId: scope.assignment.assignmentId });
    }
    await input.onChapterScope?.(scope, job, attempt);
    const prompt = `${buildLessonExtractionPrompt(
      job,
      toolNames,
      lastError ? `${lastError.userMessage}${lastError.category === 'VALIDATION' && lastError.internalDetails ? `\n具体校验问题：${JSON.stringify(lastError.internalDetails)}` : ''}` : undefined,
    )}\n\n${EXTRACTION_CLOSING}`;
    const startedAt = Date.now();
    let firstActivityAt = 0;
    let lastActivityAt = startedAt;
    let settled = false;
    input.monitor?.record('model', 'input', { message: prompt, model: input.model ?? null, effort: null, chapterTitle: job.title, contextMode: 'pool-worker' },
      { nodeId: job.lessonId, sessionId: `pool-worker-${workerIndex}`, attemptId: scope.assignment.assignmentId });
    const askPromise = driver.ask(lease, prompt).then(
      result => ({ ok: true as const, result }),
      (cause: unknown) => ({
        ok: false as const,
        error: cause instanceof BusinessError ? cause : translateToBusinessError(cause, { category: 'AGENT_RUNTIME', fallbackMessage: '本章模型处理失败' }),
      }),
    );
    // 轮询间隔按超时配置自适应：生产 60s/120s 配 2s 粒度；测试小超时配 25ms 粒度，超时即失败、不空等。
    const pollMs = Math.min(2000, Math.max(25, Math.floor(Math.min(input.firstResponseTimeoutMs, input.stallTimeoutMs) / 5)));
    const outcome = await (async () => {
      while (!settled) {
        if (input.signal.aborted) {
          driver.cancel(lease);
          return { ok: false as const, error: new BusinessError('E_CANCELLED', '教材提取已取消', 'TOOL_EXECUTION') };
        }
        const events = driver.drainEvents(lease);
        for (const event of events) {
          if (event.kind === 'turn_started') {
            if (!firstActivityAt) firstActivityAt = Date.now();
            lastActivityAt = Date.now();
          } else if (event.kind === 'activity') {
            lastActivityAt = Date.now();
          } else if (event.kind === 'turn_ended' || event.kind === 'cancelled') {
            lastActivityAt = Date.now();
          }
        }
        const now = Date.now();
        // 绝对墙钟：碎碎念式的持续活动也续不了杯，到点就掐。
        if (now - startedAt > input.wallTimeoutMs) {
          driver.cancel(lease);
          return { ok: false as const, error: new BusinessError('E_AGENT_WALL_TIMEOUT', '单章用时超过上限，已中断本轮', 'AGENT_RUNTIME', true) };
        }
        if (!firstActivityAt && now - startedAt > input.firstResponseTimeoutMs) {
          driver.cancel(lease);
          return { ok: false as const, error: new BusinessError('E_AGENT_FIRST_RESPONSE_TIMEOUT', '模型首响应超时，已中断本轮', 'AGENT_RUNTIME', true) };
        }
        if (firstActivityAt && now - lastActivityAt > input.stallTimeoutMs) {
          driver.cancel(lease);
          return { ok: false as const, error: new BusinessError('E_AGENT_STALL_TIMEOUT', '模型长时间无活动，已中断本轮', 'AGENT_RUNTIME', true) };
        }
        const raced = await Promise.race([askPromise, new Promise<'tick'>(resolve => setTimeout(() => resolve('tick'), pollMs))]);
        if (raced !== 'tick') {
          settled = true;
          return raced;
        }
      }
      return { ok: false as const, error: new BusinessError('E_CANCELLED', '教材提取已取消', 'TOOL_EXECUTION') };
    })();
    if (!outcome.ok) {
      lastError = outcome.error;
      if (!lastError.retryable) break;
      continue;
    }
    const submission = scope.submission;
    input.monitor?.record('model', 'turn_ended', undefined, { nodeId: job.lessonId, sessionId: `pool-worker-${workerIndex}`, attemptId: scope.assignment.assignmentId });
    if (!submission.candidate) {
      lastError = submission.error ?? new BusinessError('E_LESSON_SUBMISSION_MISSING', '模型未通过工具提交有效内容', 'AGENT_RUNTIME', true);
      if (!lastError.retryable) break;
      continue;
    }
    const finalized = await submission.persist();
    if (finalized.ok) {
      input.markSaved(job.lessonId, finalized.value.stats, finalized.value);
      input.monitor?.record('session', 'unbound', undefined, { nodeId: job.lessonId, sessionId: `pool-worker-${workerIndex}`, ...(lastAttemptId ? { attemptId: lastAttemptId } : {}) });
      return;
    }
    // 暂时性保存失败只重试保存，不重跑模型、不重复插入。
    if (finalized.error.category === 'DATABASE' && finalized.error.retryable) {
      for (let retry = 0; retry < input.storageRetries && !input.signal.aborted; retry++) {
        input.emit(job.lessonId, 'storage_retrying');
        const saved = await submission.persist();
        if (saved.ok) {
          input.markSaved(job.lessonId, saved.value.stats, saved.value);
          input.monitor?.record('session', 'unbound', undefined, { nodeId: job.lessonId, sessionId: `pool-worker-${workerIndex}`, ...(lastAttemptId ? { attemptId: lastAttemptId } : {}) });
          return;
        }
        if (saved.error.category !== 'DATABASE' || !saved.error.retryable) {
          lastError = saved.error;
          break;
        }
        lastError = saved.error;
      }
      if (!input.signal.aborted && lastError?.category === 'DATABASE') break;
    }
    lastError = finalized.error;
    if (!lastError.retryable) break;
  }
  if (!input.signal.aborted) {
    input.fail(job.lessonId, lastError ?? new BusinessError('E_INTERNAL', '本章提取未完成', 'TOOL_EXECUTION'));
  }
  input.monitor?.record('session', 'unbound', undefined, { nodeId: job.lessonId, sessionId: `pool-worker-${workerIndex}`, ...(lastAttemptId ? { attemptId: lastAttemptId } : {}) });
}
