import { and, asc, eq, gt } from 'drizzle-orm';
import { ImportEventSchema, type ImportEvent, type ImportEventInput, type ImportEventQuery } from '@lexdistill/document-model';
import { ok, err, nowIso, translateToBusinessError, type BusinessError, type Result } from '@lexdistill/shared';
import { textbookImportEvents } from '../../schema.js';
import type { DrizzleDb } from '../../connection.js';

export async function appendImportEvent(deps: { db: DrizzleDb }, input: ImportEventInput): Promise<Result<ImportEvent, BusinessError>> {
  try {
    const row = deps.db.insert(textbookImportEvents).values({ ...input,
      documentId: input.documentId ?? null, jobId: input.jobId ?? null, nodeId: input.nodeId ?? null,
      sessionId: input.sessionId ?? null, threadId: input.threadId ?? null, attemptId: input.attemptId ?? null, callId: input.callId ?? null,
      occurredAt: input.occurredAt ?? nowIso(), detailJson: JSON.stringify(input.detail ?? null),
    }).returning().get()!;
    return ok(ImportEventSchema.parse({ ...row, detail: input.detail ?? null }));
  } catch (cause) { return err(translateToBusinessError(cause, { category: 'DATABASE', fallbackMessage: '导入监视记录保存失败，记录可能不完整' })); }
}
export async function listImportEvents(deps: { db: DrizzleDb }, query: ImportEventQuery): Promise<Result<ImportEvent[], BusinessError>> {
  try {
    const rows = deps.db.select({ sequence: textbookImportEvents.sequence, userId: textbookImportEvents.userId, traceId: textbookImportEvents.traceId,
      documentId: textbookImportEvents.documentId, jobId: textbookImportEvents.jobId, nodeId: textbookImportEvents.nodeId,
      sessionId: textbookImportEvents.sessionId, threadId: textbookImportEvents.threadId, attemptId: textbookImportEvents.attemptId, callId: textbookImportEvents.callId,
      category: textbookImportEvents.category, name: textbookImportEvents.name, occurredAt: textbookImportEvents.occurredAt,
      detailJson: textbookImportEvents.detailJson,
    }).from(textbookImportEvents).where(and(eq(textbookImportEvents.userId, query.userId), eq(textbookImportEvents.traceId, query.traceId), gt(textbookImportEvents.sequence, query.after ?? 0))).orderBy(asc(textbookImportEvents.sequence)).limit(query.limit ?? 200).all();
    // 列表保持轻量：只带失败类事件的详情（成功路径的完整输入按需另查）。
    // 无详情时不放键：调用方以 `'detail' in event` 区分。
    const withDetail = new Set(['failed', 'error', 'rejected']);
    return ok(rows.map(row => ImportEventSchema.parse(withDetail.has(row.name) ? { ...row, detail: JSON.parse(row.detailJson) } : row)));
  } catch (cause) { return err(translateToBusinessError(cause, { category: 'DATABASE', fallbackMessage: '无法读取本次导入记录' })); }
}
export async function getImportEvent(deps: { db: DrizzleDb }, userId: string, traceId: string, sequence: number): Promise<Result<ImportEvent | null, BusinessError>> {
  try {
    const row = deps.db.select().from(textbookImportEvents).where(and(eq(textbookImportEvents.userId, userId), eq(textbookImportEvents.traceId, traceId), eq(textbookImportEvents.sequence, sequence))).get();
    return ok(row ? ImportEventSchema.parse({ ...row, detail: JSON.parse(row.detailJson) }) : null);
  } catch (cause) { return err(translateToBusinessError(cause, { category: 'DATABASE', fallbackMessage: '无法读取交互详情' })); }
}
