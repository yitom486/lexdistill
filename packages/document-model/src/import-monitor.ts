import { z } from 'zod';

/** 教材导入诊断记录；正文事实仍来自教材 AST。 */
export const ImportEventSchema = z.object({
  sequence: z.number().int().positive(), userId: z.string(), traceId: z.string(),
  documentId: z.string().nullable(), jobId: z.string().nullable(), nodeId: z.string().nullable(),
  sessionId: z.string().nullable(), threadId: z.string().nullable(), attemptId: z.string().nullable(), callId: z.string().nullable(),
  category: z.enum(['directory', 'text', 'queue', 'session', 'model', 'tool', 'validation', 'storage', 'task']),
  name: z.string(), occurredAt: z.string(), detail: z.unknown().optional(),
});
export type ImportEvent = z.infer<typeof ImportEventSchema>;
export type ImportEventInput = Omit<ImportEvent, 'sequence' | 'occurredAt' | 'documentId' | 'jobId' | 'nodeId' | 'sessionId' | 'threadId' | 'attemptId' | 'callId'> & Partial<Pick<ImportEvent, 'occurredAt' | 'documentId' | 'jobId' | 'nodeId' | 'sessionId' | 'threadId' | 'attemptId' | 'callId'>>;
export interface ImportEventQuery { userId: string; traceId: string; after?: number; limit?: number }
export const ImportEventPageSchema = z.object({ events: z.array(ImportEventSchema), cursor: z.number().int().nonnegative(), warning: z.string().optional() });
