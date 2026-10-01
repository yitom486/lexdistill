import type { AgentAdapter, AgentSession, AgentImageAttachment } from '@study-studio/agent-runtime';
import type { ChapterSource, TocEntry, TextbookLessonStage, TextbookModelActivity } from '@study-studio/document-model';
import { BusinessError, generateId, translateToBusinessError, logger, type Result } from '@study-studio/shared';
import type { CommitLessonKnowledgeOutput } from '../ports.js';
import type { LibraryLessonCommitTool } from '../tools/library-lesson-commit-tool.js';
import { buildLessonExtractionPrompt } from './prompts/lesson-extraction-prompt.js';
import type { ImportMonitor } from './import-monitor.js';
import { awaitModelActivity } from './model-activity-deadline.js';

export interface LessonExtractionJob {
  documentId: string;
  lessonId: string;
  title: string;
  language: string;
  allowAiExercises: boolean;
  tocEntries: readonly TocEntry[];
  tocPath: readonly TocEntry[];
  text: string;
  source?: ChapterSource;
  attachments?: AgentImageAttachment[];
}
export type LessonStage = TextbookLessonStage;
export interface BatchExtractionProgress {
  documentId: string; lessonId: string; stage: LessonStage;
  completedCount: number; totalCount: number; successfulCount?: number;
  allLessonsReady: boolean; error?: string;
  stats: CommitLessonKnowledgeOutput['stats'];
  modelActivity?: TextbookModelActivity;
}
type ModelTurnActivity = Pick<TextbookModelActivity, 'lastActivityAt' | 'event' | 'nativeTurnId' | 'engineRetryCount' | 'message'>;

/** 教材专用有界交接队列；满时阻塞解析生产者，结束/取消唤醒双方。 */
export class LessonInputQueue {
  private readonly buffer: LessonExtractionJob[] = [];
  private waiters: Array<() => void> = [];
  private ended = false;
  private error: BusinessError | undefined;
  constructor(private readonly capacity: number) {}
  get size(): number { return this.buffer.length; }
  private wake(): void { const waiters = this.waiters.splice(0); for (const wake of waiters) wake(); }
  private changed(): Promise<void> { return new Promise(resolve => this.waiters.push(resolve)); }
  async put(job: LessonExtractionJob): Promise<void> {
    while (!this.ended && this.buffer.length >= this.capacity) await this.changed();
    if (this.ended) throw this.error ?? new BusinessError('E_CANCELLED', '章节队列已关闭', 'TOOL_EXECUTION');
    this.buffer.push(job); this.wake();
  }
  async take(): Promise<LessonExtractionJob | undefined> {
    while (!this.buffer.length && !this.ended) await this.changed();
    if (this.error) throw this.error;
    const job = this.buffer.shift(); this.wake(); return job;
  }
  end(error?: BusinessError): void { this.ended = true; this.error = error; if (error) this.buffer.length = 0; this.wake(); }
}

export interface ChapterSessionOptions {
  userId: string; poolSize: number; model?: string | undefined; effort?: string | undefined;
  adapter: AgentAdapter; tool: LibraryLessonCommitTool; signal: AbortSignal;
  monitor?: ImportMonitor;
  firstResponseTimeoutMs: number; stallTimeoutMs: number;
}
interface ChapterWorker { session: AgentSession }

/** 只负责模型会话和发送；不引用 Repository，不解析文本 JSON，不调用落库。 */
export class ChapterSessionPool {
  private sessions: AgentSession[] = [];
  private readonly faults = new Map<string, BusinessError>();
  constructor(private readonly options: ChapterSessionOptions) {}
  private async createSession(): Promise<AgentSession> {
    const created = await this.options.adapter.createSession({
      sessionId: generateId('textbook_worker'), userId: this.options.userId,
      tools: [this.options.tool], ...(this.options.model ? { model: this.options.model } : {}),
      approvalPolicy: 'on-request', ephemeral: true,
    });
    if (!created.ok) throw created.error;
    this.sessions.push(created.value);
    this.options.monitor?.record('session', 'opened', { model: this.options.model ?? null, effort: this.options.effort ?? null,
      tools: created.value.toolSpecs ?? null, toolDescriptions: [{ name: this.options.tool.name, description: this.options.tool.description }],
    }, { sessionId: created.value.sessionId, ...(created.value.threadId ? { threadId: created.value.threadId } : {}) });
    return created.value;
  }
  async initialize(): Promise<void> {
    const results = await Promise.allSettled(Array.from({ length: this.options.poolSize }, async () => {
      await this.createSession();
    }));
    const failed = results.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') {
      await this.close();
      throw translateToBusinessError(failed.reason, { category: 'AGENT_RUNTIME', fallbackMessage: '章节会话池初始化失败，未降低所选并发度，请检查模型配置' });
    }
    if (this.options.signal.aborted) { await this.close(); throw new BusinessError('E_CANCELLED', '教材提取已取消', 'AGENT_RUNTIME'); }
  }
  async recover(session: AgentSession): Promise<AgentSession> {
    const fault = this.faults.get(session.sessionId);
    if (!fault) return session;
    logger.warn('替换发生运行时故障的教材会话', { sessionId: session.sessionId, code: fault.code });
    const index = this.sessions.indexOf(session);
    if (index >= 0) {
      const closed = await session.close(); if (!closed.ok) throw closed.error;
      this.sessions.splice(index, 1);
      this.options.monitor?.record('session', 'closed', { reason: fault.code }, { sessionId: session.sessionId });
    }
    const replacement = await this.createSession();
    this.faults.delete(session.sessionId);
    return replacement;
  }
  async consume(queue: LessonInputQueue, run: (worker: ChapterWorker, job: LessonExtractionJob) => Promise<void>, onSessionFailure: (job: LessonExtractionJob, error: BusinessError) => void): Promise<void> {
    await Promise.all([...this.sessions].map(async initial => {
      const worker = { session: initial };
      while (!this.options.signal.aborted) {
        const job = await queue.take(); if (!job) return;
        try { worker.session = await this.recover(worker.session); }
        catch (cause) {
          onSessionFailure(job, translateToBusinessError(cause, { category: 'AGENT_RUNTIME', fallbackMessage: '本章会话恢复失败，其他章节继续处理' }));
          continue;
        }
        await run(worker, job);
      }
    }));
  }
  async send(session: AgentSession, job: LessonExtractionJob, assignmentId: string, controller: AbortController, correction?: string, onActivity?: (activity: ModelTurnActivity) => void): Promise<Result<void, BusinessError>> {
    const turn = this.options.monitor?.turn(session, { nodeId: job.lessonId, attemptId: assignmentId });
    const message = buildLessonExtractionPrompt(job, this.options.tool.name.replaceAll('.', '_'), correction);
    this.options.monitor?.record('model', 'input', { message, model: this.options.model ?? null, effort: this.options.effort ?? null, correction: correction ?? null,
      tocPath: job.tocPath, tocEntries: job.tocEntries, contextMode: 'worker-thread-reuse',
      attachments: job.attachments?.map(image => ({ label: image.label, pngBase64: Buffer.from(image.png).toString('base64') })) ?? [],
    }, turn?.binding);
    const interrupt = () => { void session.interrupt().catch(cause => logger.warn('教材会话中断失败', { cause: String(cause) })); };
    const startedAt = Date.now();
    let nativeTurnId: string | undefined, lastActivityAt = startedAt, lastEvent: string | undefined;
    let engineRetryCount = 0, lastEngineError: { code: string; message: string } | undefined;
    let first = true, deadline = startedAt + this.options.firstResponseTimeoutMs;
    const activity = (event: string, message?: string) => onActivity?.({ event, lastActivityAt: new Date().toISOString(), engineRetryCount,
      ...(nativeTurnId ? { nativeTurnId } : {}), ...(message ? { message } : {}),
    });
    activity('input');
    controller.signal.addEventListener('abort', interrupt, { once: true });
    const iterator = session.send({ message, onTurnStarted: id => {
      if (controller.signal.aborted) return;
      nativeTurnId = id;
      this.options.tool.startTurn(session.sessionId, assignmentId, id);
      this.options.monitor?.record('session', 'turn_started', { nativeTurnId: id }, turn?.binding);
      activity('turn_started');
    }, ...(job.attachments?.length ? { attachments: job.attachments } : {}), ...(this.options.effort ? { turnOptions: { effort: this.options.effort } } : {}) })[Symbol.asyncIterator]();
    try {
      if (controller.signal.aborted) return { ok: false, error: new BusinessError('E_CANCELLED', '教材提取已取消', 'AGENT_RUNTIME') };
      while (true) {
        const next = await awaitModelActivity(() => iterator.next(), controller, Math.max(0, deadline - Date.now()), first, () => ({
          timeoutMs: first ? this.options.firstResponseTimeoutMs : this.options.stallTimeoutMs,
          elapsedMs: Date.now() - startedAt, idleMs: Date.now() - lastActivityAt,
          nativeTurnId: nativeTurnId ?? null, nativeTurnAccepted: !!nativeTurnId, lastModelEvent: lastEvent ?? null,
          engineRetryCount, lastEngineError: lastEngineError ?? null,
          inputCharacters: message.length, attachmentCount: job.attachments?.length ?? 0,
          attachmentBytes: job.attachments?.reduce((sum, image) => sum + image.png.byteLength, 0) ?? 0,
        }));
        if (next.done) break;
        const event = next.value;
        turn?.event(event);
        if (event.type === 'RUNTIME_RETRY') {
          engineRetryCount++; lastEngineError = { code: event.code, message: event.message };
          activity('runtime_retry', event.message);
          continue;
        }
        if (event.type === 'TEXT_DELTA' || event.type === 'REASONING_DELTA') {
          if (!event.delta) continue;
        }
        first = false; lastActivityAt = Date.now(); lastEvent = event.type;
        deadline = lastActivityAt + this.options.stallTimeoutMs;
        activity(event.type.toLowerCase());
        if (event.type === 'APPROVAL_REQUESTED') {
          const declined = await session.submitApproval(event.approvalId, 'decline');
          if (!declined.ok) return declined;
        } else if (event.type === 'ERROR') {
          if (event.error.category === 'AGENT_RUNTIME') this.faults.set(session.sessionId, event.error);
          return { ok: false, error: event.error };
        }
      }
      return { ok: true, value: undefined };
    } catch (cause) {
      const error = cause instanceof BusinessError ? cause : translateToBusinessError(cause, { category: 'AGENT_RUNTIME', fallbackMessage: '本章模型处理失败，请重试本章' });
      this.options.monitor?.record('model', 'failed', { code: error.code, message: error.userMessage, retryable: error.retryable, details: error.internalDetails }, turn?.binding);
      if (!this.options.signal.aborted) this.faults.set(session.sessionId, error);
      return { ok: false, error };
    } finally {
      // 不等待失去响应的生成器 return；迟到工具已经被 turnSignal 拒绝。
      void iterator.return?.().catch(cause => logger.warn('教材响应流收尾失败', { cause: String(cause) }));
      turn?.flush(); this.options.monitor?.record('model', 'turn_ended', undefined, turn?.binding); controller.signal.removeEventListener('abort', interrupt);
    }
  }
  async close(): Promise<void> {
    const sessions = this.sessions.splice(0);
    const results = await Promise.allSettled(sessions.map(session => session.close()));
    for (const session of sessions) this.options.monitor?.record('session', 'closed', undefined, { sessionId: session.sessionId });
    for (const result of results) {
      if (result.status === 'rejected') logger.warn('教材会话关闭失败', { cause: String(result.reason) });
      else if (!result.value.ok) logger.warn('教材会话关闭失败', { code: result.value.error.code });
    }
  }
}
