import { eq } from 'drizzle-orm';
import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
  generateId,
  nowIso,
} from '@study-studio/shared';
import { documentImports } from '@study-studio/storage-sqlite';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';
import { DOCUMENT_SOURCE_KINDS, type DocumentSourceKind } from './document-kinds.js';

/**
 * 文档导入任务持久化（状态机 processing → done/failed；读侧永不抛）。
 */

export type ImportTaskStatus = 'processing' | 'done' | 'failed';

export interface ImportTask {
  id: string;
  userId: string;
  sourceKind: DocumentSourceKind;
  filename: string;
  status: ImportTaskStatus;
  documentId?: string | undefined;
  lessons?: number | undefined;
  error?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

type ImportTaskRow = typeof documentImports.$inferSelect;

function toImportTask(row: ImportTaskRow): ImportTask {
  const status: ImportTaskStatus =
    row.status === 'done' || row.status === 'failed' ? row.status : 'processing';
  const task: ImportTask = {
    id: row.id,
    userId: row.userId,
    sourceKind: (DOCUMENT_SOURCE_KINDS as string[]).includes(row.sourceKind)
      ? (row.sourceKind as DocumentSourceKind)
      : 'text',
    filename: row.filename,
    status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (row.documentId) task.documentId = row.documentId;
  if (typeof row.lessons === 'number') task.lessons = row.lessons;
  if (row.error) task.error = row.error;
  return task;
}

export async function createImportTask(
  deps: RepoDeps,
  input: { userId: string; sourceKind: DocumentSourceKind; filename: string }
): Promise<Result<ImportTask, BusinessError>> {
  try {
    const now = nowIso();
    const row = {
      id: generateId('import'),
      userId: input.userId,
      sourceKind: input.sourceKind,
      filename: input.filename.slice(0, 256),
      status: 'processing',
      documentId: null as string | null,
      lessons: null as number | null,
      error: null as string | null,
      createdAt: now,
      updatedAt: now,
    };
    await deps.db.insert(documentImports).values(row);
    return ok(toImportTask({ ...row, status: 'processing' } as ImportTaskRow));
  } catch (e) {
    return err(translateToBusinessError(e, 'createImportTask'));
  }
}

export async function updateImportTask(
  deps: RepoDeps,
  id: string,
  patch: { status: ImportTaskStatus; documentId?: string; lessons?: number; error?: string }
): Promise<Result<ImportTask, BusinessError>> {
  try {
    const rows = await deps.db.select().from(documentImports).where(eq(documentImports.id, id));
    const row = rows[0];
    if (!row) {
      return err(new BusinessError('E_NOT_FOUND', '导入任务不存在', 'LEARNER_STATE', false));
    }
    const next = {
      status: patch.status,
      documentId: patch.documentId ?? row.documentId,
      lessons: patch.lessons ?? row.lessons,
      error: patch.error ?? null,
      updatedAt: nowIso(),
    };
    await deps.db.update(documentImports).set(next).where(eq(documentImports.id, id));
    return ok(toImportTask({ ...row, ...next }));
  } catch (e) {
    return err(translateToBusinessError(e, 'updateImportTask'));
  }
}

/** 取任务（读侧永不抛；不存在返回 undefined）。 */
export async function getImportTask(deps: RepoDeps, id: string): Promise<ImportTask | undefined> {
  try {
    const rows = await deps.db.select().from(documentImports).where(eq(documentImports.id, id));
    const row = rows[0];
    return row ? toImportTask(row) : undefined;
  } catch {
    return undefined;
  }
}
