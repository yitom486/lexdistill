import {
  ok,
  err,
  isOk,
  type Result,
  BusinessError,
  translateToBusinessError,
  nowIso,
} from '@study-studio/shared';
import { and, eq } from 'drizzle-orm';
import { documentStructures } from '@study-studio/storage-sqlite';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';
import { getDocumentById } from './documents-annotations.js';
import type {
  HeadingCandidate,
  StructureClass,
} from '@study-studio/protocol';

export interface SavedDocumentStructure {
  documentId: string;
  userId: string;
  headings: HeadingCandidate[];
  classes: StructureClass[];
  model: string;
  effort: string;
  dropped: number;
  createdAt: string;
}

function parseJsonArray(raw: unknown): Array<Record<string, unknown>> {
  try {
    if (typeof raw !== 'string' || !raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}

/**
 * 保存文档结构分类（幂等全量覆盖；文档归属校验：自有或公共种子）。
 * headings/classes 由调用方（classify 路由）校验后传入，此处只做归属与落库。
 */
export async function saveDocumentStructure(
  deps: RepoDeps,
  userId: string,
  documentId: string,
  input: {
    headings: HeadingCandidate[];
    classes: StructureClass[];
    model: string;
    effort: string;
    dropped: number;
  }
): Promise<Result<SavedDocumentStructure, BusinessError>> {
  try {
    const got = await getDocumentById(deps, documentId);
    if (!isOk(got)) return err(got.error);
    const doc = got.value;
    if (!doc || (doc.userId !== userId && doc.sourceKind !== 'curriculum_textbook')) {
      return err(new BusinessError('E_NOT_FOUND', '未找到指定的教材或文档', 'LEARNER_STATE'));
    }
    const now = nowIso();
    await deps.db
      .insert(documentStructures)
      .values({
        documentId,
        userId,
        headingsJson: JSON.stringify(input.headings),
        classesJson: JSON.stringify(input.classes),
        model: input.model,
        effort: input.effort,
        dropped: input.dropped,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: documentStructures.documentId,
        set: {
          headingsJson: JSON.stringify(input.headings),
          classesJson: JSON.stringify(input.classes),
          model: input.model,
          effort: input.effort,
          dropped: input.dropped,
          createdAt: now,
        },
      });
    return ok({
      documentId,
      userId,
      headings: input.headings,
      classes: input.classes,
      model: input.model,
      effort: input.effort,
      dropped: input.dropped,
      createdAt: now,
    });
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'saveDocumentStructure',
        entityId: documentId,
      })
    );
  }
}

/** 读取文档结构分类（无记录返回 null，不报错）。 */
export async function getDocumentStructure(
  deps: RepoDeps,
  userId: string,
  documentId: string
): Promise<Result<SavedDocumentStructure | null, BusinessError>> {
  try {
    const rows = await deps.db
      .select()
      .from(documentStructures)
      .where(
        and(
          eq(documentStructures.documentId, documentId),
          eq(documentStructures.userId, userId)
        )
      )
      .limit(1);
    const row = rows[0];
    if (!row) return ok(null);
    const headings = parseJsonArray(row.headingsJson)
      .filter((h) => typeof h.text === 'string' && typeof h.page === 'number')
      .map((h) => ({ page: h.page as number, text: h.text as string }));
    const classes = parseJsonArray(row.classesJson)
      .filter((c) => typeof c.text === 'string' && typeof c.kind === 'string')
      .map((c) => ({
        text: c.text as string,
        page: typeof c.page === 'number' ? c.page : 0,
        kind: c.kind as StructureClass['kind'],
        lessonNo: typeof c.lessonNo === 'string' ? c.lessonNo : null,
        skillId: typeof c.skillId === 'string' ? c.skillId : null,
      }));
    return ok({
      documentId: row.documentId,
      userId: row.userId,
      headings,
      classes,
      model: row.model,
      effort: row.effort,
      dropped: row.dropped,
      createdAt: row.createdAt,
    });
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'getDocumentStructure',
        entityId: documentId,
      })
    );
  }
}
