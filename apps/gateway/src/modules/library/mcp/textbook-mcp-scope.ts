/**
 * 教材 MCP 调用作用域（网关侧唯一事实源）。
 *
 * MCP 没有原生 turnId：归属不靠模型回传任何身份，靠三层网关事实：
 * 1. 端点隔离：每个任务每个 Worker 独立 URL（任务 token 不可猜），跨任务/跨用户在路由层即 404；
 * 2. 当前章节映射：同一 Worker 同时只处理一章，映射只在 ask 间隙切换；
 *    调用在入场瞬间捕获不可变作用域快照，执行与提交前复核有效性；
 * 3. 同步边界：网关对同一 Worker 一次只发一个 ask，本轮全部工具调用落定
 *    ask 才返回；迟到重放用 JSON-RPC 请求 id 去重，已 responder 的原样返回。
 * 取消/结束即撤销作用域，其后到达的调用一律拒绝，不污染数据库。
 */
import {
  type TextbookContentKind,
} from '@lexdistill/document-model';
import { LessonContentBuffer, type BufferedContentReceipt } from '../tools/lesson-content-buffer.js';
import type { ContentRepository, CommitLessonKnowledgeOutput } from '../ports.js';
import { BusinessError, err, ok, translateToBusinessError, type Result } from '@lexdistill/shared';
import type { ImportMonitor } from '../application/import-monitor.js';

export interface McpChapterAssignment {
  userId: string;
  documentId: string;
  lessonId: string;
  assignmentId: string;
  allowAiExercises: boolean;
  replaceContent?: boolean;
  signal?: AbortSignal;
  toolRepairRetries?: number;
  monitor?: ImportMonitor;
  sessionId?: string;
}

export interface McpScopeSnapshot {
  readonly userId: string;
  readonly documentId: string;
  readonly lessonId: string;
  readonly assignmentId: string;
  readonly generation: number;
}

type RpcId = string | number;

/** 单章单次尝试的作用域：引用计数式撤销，入场调用捕获快照后独立校验。 */
export class McpChapterScope {
  private revokedFlag = false;
  private generationCounter = 0;
  readonly seenRpcIds = new Map<RpcId, unknown>();
  readonly submission: McpTextbookSubmission;

  constructor(
    readonly repo: ContentRepository,
    readonly assignment: McpChapterAssignment,
  ) {
    this.submission = new McpTextbookSubmission(repo, assignment, () => !this.revokedFlag);
  }

  /** 进入新一轮 ask 前换发世代；旧世代残留调用按过期拒绝。 */
  snapshot(): McpScopeSnapshot {
    return {
      userId: this.assignment.userId,
      documentId: this.assignment.documentId,
      lessonId: this.assignment.lessonId,
      assignmentId: this.assignment.assignmentId,
      generation: this.generationCounter,
    };
  }

  isCurrent(snapshot: McpScopeSnapshot): boolean {
    return (
      !this.revokedFlag &&
      snapshot.generation === this.generationCounter &&
      snapshot.assignmentId === this.assignment.assignmentId
    );
  }

  revoke(): void {
    this.revokedFlag = true;
  }

  get revoked(): boolean {
    return this.revokedFlag;
  }
}

/**
 * MCP 版章节提交：复用 LessonContentBuffer 校验与整章事务，
 * 守卫只认网关作用域（用户一致＋未撤销＋信号有效），不认任何模型自报身份。
 */
export class McpTextbookSubmission {
  private buffer: LessonContentBuffer | undefined;
  private readonly calls = new Map<RpcId, { key: string; result: Result<BufferedContentReceipt, BusinessError> }>();
  private readonly rejected = new Set<string>();
  private rejectedCount = 0;
  private sealedFlag = false;
  /** 串行队列：与原提交器一致，并发调用排队执行，防止双重初始化覆盖暂存。 */
  private queue: Promise<void> = Promise.resolve();
  candidate = false;
  error: BusinessError | undefined;
  receipt: CommitLessonKnowledgeOutput | undefined;

  constructor(
    private readonly repo: ContentRepository,
    private readonly assignment: McpChapterAssignment,
    private readonly scopeActive: () => boolean,
  ) {}

  private get scope() {
    return { userId: this.assignment.userId, documentId: this.assignment.documentId, chapterId: this.assignment.lessonId };
  }

  private guard(): BusinessError | undefined {
    if (!this.scopeActive()) {
      return new BusinessError('E_SUBMISSION_SCOPE_INVALID', '本次课程处理已经结束，迟到调用已拒绝', 'VALIDATION');
    }
    if (this.assignment.signal?.aborted) {
      return new BusinessError('E_CANCELLED', '本次课程处理已经结束，迟到调用已拒绝', 'VALIDATION');
    }
    return undefined;
  }

  private binding(extra?: { callId?: string | number }) {
    return {
      nodeId: this.assignment.lessonId,
      attemptId: this.assignment.assignmentId,
      ...(this.assignment.sessionId ? { sessionId: this.assignment.sessionId } : {}),
      ...(extra?.callId !== undefined ? { callId: String(extra.callId) } : {}),
    };
  }

  async execute(
    kind: TextbookContentKind,
    input: unknown,
    rpcId: RpcId | null,
  ): Promise<Result<BufferedContentReceipt, BusinessError>> {
    const run = this.queue.then(() => this.executeInner(kind, input, rpcId));
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async executeInner(
    kind: TextbookContentKind,
    input: unknown,
    rpcId: RpcId | null,
  ): Promise<Result<BufferedContentReceipt, BusinessError>> {
    const blocked = this.guard();
    if (blocked) return err(blocked);
    if (this.sealedFlag) {
      return err(new BusinessError('E_SUBMISSION_CLOSED', '本课内容已结束接收，迟到调用已拒绝', 'VALIDATION'));
    }
    const key = JSON.stringify([kind, input]);
    if (rpcId !== null) {
      const prior = this.calls.get(rpcId);
      // 传输重放：同一请求 id 原样返回，不重复执行。
      if (prior) {
        return prior.key === key
          ? prior.result
          : err(new BusinessError('E_CONTENT_CALL_CONFLICT', '同一工具调用的内容发生冲突，请重新提交', 'VALIDATION'));
      }
    }
    const action = typeof input === 'object' && input !== null && 'action' in input ? String(input.action) : 'add';
    let result: Result<BufferedContentReceipt, BusinessError>;
    this.assignment.monitor?.record('tool', 'requested', { name: kind, input }, this.binding(rpcId === null ? undefined : { callId: rpcId }));
    try {
      if (!this.buffer) {
        const existing = await this.repo.readTextbookChapter(this.scope);
        if (!existing.ok) {
          this.error = existing.error;
          return existing;
        }
        this.buffer = new LessonContentBuffer(existing.value, this.assignment.replaceContent);
      }
      const cancelled = this.guard();
      if (cancelled) return err(cancelled);
      // 字段校验（含 superRefine）在 LessonContentBuffer 内，与原生路径同一套。
      const value = this.buffer.apply(kind, input, this.assignment.allowAiExercises);
      result = ok(value);
      this.rejected.delete(`${kind}:${action}`);
      if (value.status === 'staged') this.candidate = true;
      if (!this.rejected.size) this.error = undefined;
      this.assignment.monitor?.record('storage', value.status === 'staged' ? 'content_staged' : 'content_view', value, this.binding(rpcId === null ? undefined : { callId: rpcId }));
    } catch (cause) {
      const error = translateToBusinessError(cause, 'stageLessonContent');
      this.error = error;
      result = err(error);
      this.rejected.add(`${kind}:${action}`);
      this.assignment.monitor?.record('validation', 'rejected', { code: error.code, message: error.userMessage, details: error.internalDetails }, this.binding(rpcId === null ? undefined : { callId: rpcId }));
      if (error.retryable && this.assignment.toolRepairRetries !== undefined && ++this.rejectedCount > this.assignment.toolRepairRetries) {
        this.error = new BusinessError('E_TOOL_REPAIR_LIMIT', '本轮内容修正次数已用尽', 'VALIDATION', true);
        result = err(this.error);
      }
    }
    if (rpcId !== null) this.calls.set(rpcId, { key, result });
    this.assignment.monitor?.record('tool', 'result', result.ok ? result.value : { code: result.error.code, message: result.error.userMessage }, this.binding(rpcId === null ? undefined : { callId: rpcId }));
    return result;
  }

  /** 整章事务保存：仅网关驱动调用；缺必需类别由事务内的 E_LESSON_CONTENT_MISSING 拒绝。 */
  async persist(): Promise<Result<CommitLessonKnowledgeOutput, BusinessError>> {
    this.sealedFlag = true;
    await this.queue;
    if (this.receipt) return ok(this.receipt);
    const blocked = this.guard();
    if (blocked) return err(blocked);
    if (!this.buffer?.hasSubmittedContent()) {
      this.error = new BusinessError('E_LESSON_CONTENT_MISSING', '本课尚未提交有效学习内容', 'VALIDATION', true);
      this.assignment.monitor?.record('validation', 'rejected', { code: this.error.code, message: this.error.userMessage, details: this.error.internalDetails },
        { nodeId: this.assignment.lessonId, attemptId: this.assignment.assignmentId, ...(this.assignment.sessionId ? { sessionId: this.assignment.sessionId } : {}) });
      return err(this.error);
    }
    if (this.rejected.size) {
      return err(this.error ?? new BusinessError('E_CONTENT_FORMAT_INVALID', '仍有未修正的内容操作', 'VALIDATION', true));
    }
    const result = await this.repo.commitTextbookLesson(this.scope, this.buffer.changes);
    if (result.ok) {
      this.receipt = result.value;
      this.error = undefined;
      this.assignment.monitor?.record('storage', 'committed', result.value, { nodeId: this.assignment.lessonId, attemptId: this.assignment.assignmentId, ...(this.assignment.sessionId ? { sessionId: this.assignment.sessionId } : {}) });
    } else {
      this.error = result.error;
      this.assignment.monitor?.record('storage', 'commit_failed', { code: result.error.code, message: result.error.userMessage }, { nodeId: this.assignment.lessonId, attemptId: this.assignment.assignmentId });
    }
    return result;
  }
}
