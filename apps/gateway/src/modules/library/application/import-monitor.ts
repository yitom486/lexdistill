import type { AgentEvent, AgentSession } from '@study-studio/agent-runtime';
import type { ImportEventInput } from '@study-studio/document-model';
import { logger, nowIso } from '@study-studio/shared';
import type { ContentRepository } from '../ports.js';

type EventScope = Partial<Pick<ImportEventInput, 'documentId' | 'jobId' | 'nodeId' | 'sessionId' | 'threadId' | 'attemptId' | 'callId'>>;
const warnings = new Map<string, string>();
const key = (userId: string, traceId: string) => JSON.stringify([userId, traceId]);
export const getImportMonitorWarning = (userId: string, traceId: string) => warnings.get(key(userId, traceId));
export const IMPORT_MONITOR_REFRESH_MS = 1000;

/** 串行写诊断，失败与教材事务隔离；只接收业务白名单内容，不接收鉴权配置。 */
export class ImportMonitor {
  private pending: Promise<void> = Promise.resolve();
  constructor(private readonly repo: ContentRepository, readonly userId: string, readonly traceId: string, private readonly scope: EventScope = {}) {}
  record(category: ImportEventInput['category'], name: string, detail?: unknown, scope: EventScope = {}): void {
    const occurredAt = nowIso();
    this.pending = this.pending.then(async () => {
      try {
        const result = await this.repo.appendImportEvent({ userId: this.userId, traceId: this.traceId, ...this.scope, ...scope, category, name, detail, occurredAt });
        if (!result.ok) throw result.error;
      } catch {
        warnings.set(key(this.userId, this.traceId), '监视记录不完整：部分交互记录保存失败；教材保存结果请核对数据库。');
        logger.warn('教材导入监视记录保存失败', { traceId: this.traceId, name });
      }
    });
  }
  flush(): Promise<void> { return this.pending; }
  turn(session: AgentSession, scope: EventScope) {
    const binding = { ...scope, sessionId: session.sessionId, ...(session.threadId ? { threadId: session.threadId } : {}) };
    let text = '', reasoning = '', lastFlush = Date.now();
    const flush = () => {
      if (text || reasoning) this.record('model', 'message', { text, reasoning }, binding);
      text = ''; reasoning = ''; lastFlush = Date.now();
    };
    return { binding, flush, event: (event: AgentEvent) => {
      if (event.type === 'TEXT_DELTA' || event.type === 'REASONING_DELTA') {
        if (event.type === 'TEXT_DELTA') text += event.delta; else reasoning += event.delta;
        if (Date.now() - lastFlush >= IMPORT_MONITOR_REFRESH_MS) flush();
      } else if (event.type === 'TOOL_CALL_REQUESTED') {
        flush(); this.record('tool', 'requested', { name: event.toolName, input: event.input }, { ...binding, callId: event.callId });
      } else if (event.type === 'TOOL_CALL_COMPLETED') {
        this.record('tool', 'result', event.result, { ...binding, callId: event.callId });
      } else { flush(); this.record('model', event.type.toLowerCase(), event.type === 'ERROR' ? { code: event.error.code, message: event.error.userMessage, category: event.error.category, retryable: event.error.retryable } : event, binding); }
    } };
  }
}
