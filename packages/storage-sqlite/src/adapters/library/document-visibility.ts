import type { Database } from 'bun:sqlite';

/**
 * 文档可见性（P1-3a；沿用 P1-C0.8 Task 0 既有规则，不发明新语义）。
 * - 可见 ⇔ 行存在 且（doc.user_id == userId 或 doc.source_kind == 'curriculum_textbook'）；
 * - 不存在与不可见统一返回 null，调用方一律转 E_NOT_FOUND，不泄露存在性。
 */
export interface VisibleDocument {
  id: string;
  userId: string;
  sourceKind: string;
}

export function getVisibleDocument(
  sqlite: Database,
  userId: string,
  documentId: string
): VisibleDocument | null {
  const row = sqlite
    .query('SELECT id AS id, user_id AS userId, source_kind AS sourceKind FROM documents WHERE id = ?')
    .get(documentId) as { id: string; userId: string; sourceKind: string } | null;
  if (!row) return null;
  if (row.userId !== userId && row.sourceKind !== 'curriculum_textbook') return null;
  return { id: row.id, userId: row.userId, sourceKind: row.sourceKind };
}
