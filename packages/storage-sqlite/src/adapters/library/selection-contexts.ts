import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
  generateId,
  nowIso,
} from '@study-studio/shared';
import type { Database } from 'bun:sqlite';

/**
 * 选区上下文（P1-3；v25）。
 * 不变量（P1-2a R2，Repository 层执行）：
 * - SI-1：禁止 document／segment／normalized_text 三空记录；
 * - SI-2：segment 非空 ⇒ 段行存在；document 与 segment 同时非空 ⇒
 *   段归属必须等于 selection.document_id；document 为空则写时以段归属回填；
 * - SI-3：user／language 必填（与 document 归属一致性由调用域保证）。
 */

const SUPPORTED_LANGUAGES = new Set(['ja', 'en', 'ko']);

export interface SelectionContext {
  id: string;
  userId: string;
  language: string;
  documentId?: string | undefined;
  segmentId?: string | undefined;
  surface: string;
  normalizedText: string;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  surroundingText?: string | undefined;
  createdAt: string;
}

export interface CaptureSelectionInput {
  userId: string;
  language: string;
  documentId?: string | undefined;
  segmentId?: string | undefined;
  surface: string;
  normalizedText: string;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  surroundingText?: string | undefined;
}

interface SelectionContextRow {
  id: string;
  user_id: string;
  language: string;
  document_id: string | null;
  segment_id: string | null;
  surface: string;
  normalized_text: string;
  start_offset: number | null;
  end_offset: number | null;
  surrounding_text: string | null;
  created_at: string;
}

function toSelectionContext(row: SelectionContextRow): SelectionContext {
  const sel: SelectionContext = {
    id: row.id,
    userId: row.user_id,
    language: row.language,
    surface: row.surface,
    normalizedText: row.normalized_text,
    createdAt: row.created_at,
  };
  if (row.document_id) sel.documentId = row.document_id;
  if (row.segment_id) sel.segmentId = row.segment_id;
  if (row.start_offset !== null) sel.startOffset = row.start_offset;
  if (row.end_offset !== null) sel.endOffset = row.end_offset;
  if (row.surrounding_text) sel.surroundingText = row.surrounding_text;
  return sel;
}

export async function captureSelectionContext(
  deps: { sqlite: Database },
  input: CaptureSelectionInput
): Promise<Result<SelectionContext, BusinessError>> {
  const userId = input.userId.trim();
  if (!userId || userId.length > 64) {
    return err(new BusinessError('E_INVALID_INPUT', 'userId 非法', 'VALIDATION'));
  }
  if (!SUPPORTED_LANGUAGES.has(input.language)) {
    return err(new BusinessError('E_INVALID_INPUT', 'language 必须为 ja/en/ko', 'VALIDATION'));
  }
  const documentId = (input.documentId ?? '').trim() || null;
  const segmentId = (input.segmentId ?? '').trim() || null;
  const normalizedText = input.normalizedText.trim().slice(0, 2000);
  const surface = input.surface.trim().slice(0, 500);
  if (!surface) {
    return err(new BusinessError('E_INVALID_INPUT', 'surface 不可为空', 'VALIDATION'));
  }
  // SI-1：三空拒绝。
  if (!documentId && !segmentId && !normalizedText) {
    return err(
      new BusinessError('E_INVALID_INPUT', '选区缺少定位：document／segment／文本三空', 'VALIDATION')
    );
  }
  try {
    // SI-2：段归属验证／回填。
    let doc: string | null = documentId;
    if (segmentId) {
      const seg = deps.sqlite
        .query('SELECT id AS id, document_id AS document_id FROM content_segments WHERE id = ?')
        .get(segmentId) as { id: string; document_id: string } | null;
      if (!seg) {
        return err(new BusinessError('E_NOT_FOUND', 'segment 不存在', 'DATABASE'));
      }
      if (doc && doc !== seg.document_id) {
        return err(
          new BusinessError('E_INVALID_INPUT', '选区 document 与 segment 归属不一致', 'VALIDATION')
        );
      }
      if (!doc) doc = seg.document_id;
    }
    const now = nowIso();
    const id = generateId('sel');
    deps.sqlite
      .query(
        `INSERT INTO selection_contexts
           (id, user_id, language, document_id, segment_id, surface,
            normalized_text, start_offset, end_offset, surrounding_text, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        userId,
        input.language,
        doc,
        segmentId,
        surface,
        normalizedText,
        input.startOffset ?? null,
        input.endOffset ?? null,
        (input.surroundingText ?? '').trim().slice(0, 2000) || null,
        now
      );
    const row = deps.sqlite
      .query('SELECT * FROM selection_contexts WHERE id = ?')
      .get(id) as SelectionContextRow | null;
    if (!row) {
      return err(new BusinessError('E_INTERNAL', '选区写入后回读失败，请重试。', 'DATABASE', true));
    }
    return ok(toSelectionContext(row));
  } catch (error) {
    return err(
      translateToBusinessError(error, { category: 'DATABASE', action: 'captureSelectionContext' })
    );
  }
}
