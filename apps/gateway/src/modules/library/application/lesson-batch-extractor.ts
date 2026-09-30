import type { AgentAdapter, AgentSession } from '@study-studio/agent-runtime';
import type { TocEntry } from '@study-studio/document-model';
import { BusinessError, generateId, translateToBusinessError, logger, type Result } from '@study-studio/shared';
import type { CommitLessonKnowledgeOutput } from '../ports.js';
import type { LibraryLessonCommitTool } from '../tools/library-lesson-commit-tool.js';
import { buildLessonExtractionPrompt } from './prompts/lesson-extraction-prompt.js';
import type { ImportMonitor } from './import-monitor.js';

export interface LessonExtractionJob {
  documentId: string;
  lessonId: string;
  title: string;
  language: string;
  allowAiExercises: boolean;
  tocEntries: readonly TocEntry[];
  tocPath: readonly TocEntry[];
  ocrText: string;
}
export type LessonStage = 'ocr' | 'queued' | 'extracting' | 'validating' | 'saving' | 'saved' | 'failed';
export interface BatchExtractionProgress {
  documentId: string; lessonId: string; stage: LessonStage;
  completedCount: number; totalCount: number; successfulCount?: number;
  allLessonsReady: boolean; error?: string;
  stats: CommitLessonKnowledgeOutput['stats'];
}

/** 教材专用有界交接队列；满时阻塞 OCR 生产者，结束/取消唤醒双方。 */
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
}

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
  async consume(queue: LessonInputQueue, run: (session: AgentSession, job: LessonExtractionJob) => Promise<void>, onSessionFailure: (job: LessonExtractionJob, error: BusinessError) => void): Promise<void> {
    await Promise.all([...this.sessions].map(async initial => {
      let session = initial;
      while (!this.options.signal.aborted) {
        const job = await queue.take(); if (!job) return;
        const fault = this.faults.get(session.sessionId);
        if (fault) {
          logger.warn('替换发生运行时故障的教材会话', { sessionId: session.sessionId, code: fault.code, lessonId: job.lessonId });
          try {
            const index = this.sessions.indexOf(session);
            if (index >= 0) {
              const closed = await session.close();
              if (!closed.ok) throw closed.error;
              this.sessions.splice(index, 1);
            }
            const replacement = await this.createSession();
            this.faults.delete(session.sessionId); session = replacement;
          } catch (cause) {
            onSessionFailure(job, translateToBusinessError(cause, { category: 'AGENT_RUNTIME', fallbackMessage: '本章会话恢复失败，其他章节继续处理' }));
            continue;
          }
        }
        await run(session, job);
      }
    }));
  }
  async send(session: AgentSession, job: LessonExtractionJob, assignmentId: string, correction?: string): Promise<Result<void, BusinessError>> {
    const turn = this.options.monitor?.turn(session, { nodeId: job.lessonId, attemptId: assignmentId });
    const message = buildLessonExtractionPrompt(job, assignmentId, this.options.tool.name.replaceAll('.', '_'), correction);
    this.options.monitor?.record('model', 'input', { message, model: this.options.model ?? null, effort: this.options.effort ?? null, correction: correction ?? null }, turn?.binding);
    const interrupt = () => { void session.interrupt().catch(cause => logger.warn('教材会话中断失败', { cause: String(cause) })); };
    this.options.signal.addEventListener('abort', interrupt, { once: true });
    try {
      if (this.options.signal.aborted) return { ok: false, error: new BusinessError('E_CANCELLED', '教材提取已取消', 'AGENT_RUNTIME') };
      for await (const event of session.send({
        message,
        ...(this.options.effort ? { turnOptions: { effort: this.options.effort } } : {}),
      })) {
        turn?.event(event);
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
      const error = translateToBusinessError(cause, { category: 'AGENT_RUNTIME', fallbackMessage: '本章模型处理失败，请重试本章' });
      if (!this.options.signal.aborted) this.faults.set(session.sessionId, error);
      return { ok: false, error };
    } finally { turn?.flush(); this.options.monitor?.record('model', 'turn_ended', undefined, turn?.binding); this.options.signal.removeEventListener('abort', interrupt); }
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
