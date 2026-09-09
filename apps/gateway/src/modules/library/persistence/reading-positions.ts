import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
  nowIso,
} from '@study-studio/shared';
import { and, eq } from 'drizzle-orm';
import { readingPositions } from '../../../infrastructure/db/schema.js';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';

/**
 * 阅读位置域：每用户每文档一条（upsert），locator 为不透明 JSON（lessonId/offset/page 由前端组装）。
 * 只记“看到哪”，不解析语义；quote 级锚定仍走 annotations 表。
 */

export interface ReadingPosition {
  userId: string;
  documentId: string;
  locator: Record<string, unknown>;
  updatedAt: string;
}

function parseLocator(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* 损坏值回退空对象，读侧永不抛 */
  }
  return {};
}

/** 保存阅读位置（narrow 失败拒绝；document 归属不校验——位置是私有游标，错 id 只影响自己）。 */
export async function saveReadingPosition(
  deps: RepoDeps,
  userId: string,
  documentId: string,
  locator: unknown
): Promise<Result<ReadingPosition, BusinessError>> {
  const uid = userId.trim();
  if (!uid || uid.length > 64) {
    return err(new BusinessError('E_INVALID_INPUT', 'userId 非法', 'VALIDATION'));
  }
  const docId = documentId.trim();
  if (!docId || docId.length > 128) {
    return err(new BusinessError('E_INVALID_INPUT', 'documentId 非法', 'VALIDATION'));
  }
  if (!locator || typeof locator !== 'object' || Array.isArray(locator)) {
    return err(new BusinessError('E_INVALID_INPUT', 'locator 必须为对象', 'VALIDATION'));
  }
  const raw = JSON.stringify(locator).slice(0, 4000);
  const now = nowIso();
  try {
    await deps.db
      .insert(readingPositions)
      .values({ userId: uid, documentId: docId, locator: raw, updatedAt: now })
      .onConflictDoUpdate({
        target: [readingPositions.userId, readingPositions.documentId],
        set: { locator: raw, updatedAt: now },
      });
    return ok({ userId: uid, documentId: docId, locator: parseLocator(raw), updatedAt: now });
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'saveReadingPosition',
        entityId: docId,
      })
    );
  }
}

/** 读取阅读位置（无记录返回 null，不算错）。 */
export async function getReadingPosition(
  deps: RepoDeps,
  userId: string,
  documentId: string
): Promise<Result<ReadingPosition | null, BusinessError>> {
  const uid = userId.trim();
  const docId = documentId.trim();
  if (!uid || !docId) {
    return err(new BusinessError('E_INVALID_INPUT', 'userId 或 documentId 非法', 'VALIDATION'));
  }
  try {
    const rows = await deps.db
      .select()
      .from(readingPositions)
      .where(
        and(
          eq(readingPositions.userId, uid),
          eq(readingPositions.documentId, docId)
        )
      )
      .limit(1);
    const row = rows[0];
    if (!row) return ok(null);
    return ok({
      userId: row.userId,
      documentId: row.documentId,
      locator: parseLocator(row.locator),
      updatedAt: row.updatedAt,
    });
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'getReadingPosition',
        entityId: docId,
      })
    );
  }
}
