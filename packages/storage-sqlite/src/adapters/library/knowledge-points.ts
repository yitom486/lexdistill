import type { Database } from 'bun:sqlite';
import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
  generateId,
  nowIso,
} from '@study-studio/shared';

/**
 * 目录挂载蒸馏点（v30 knowledge_points）。
 * - 自然键 (document_id, lesson_id, kind, concept) 幂等 upsert：同键重存只刷新
 *   explanation/source_refs，不增行（AI 重提可放心覆盖）；
 * - concept 为空即拒绝（doctor `knowledge:concept-empty` 会标 FAIL）；
 * - source_refs 只存原文行 id 字符串数组（可空＝悬空知识点），不校验存在性
 *   （原文行可能后 shred，校验留给 doctor lesson-orphan）。
 */

export const KNOWLEDGE_POINT_KINDS = ['concept', 'vocab_ref', 'grammar_ref', 'rule'] as const;
export type KnowledgePointKind = (typeof KNOWLEDGE_POINT_KINDS)[number];

export interface SaveKnowledgePointInput {
  concept: string;
  kind?: string | undefined;
  explanationMd?: string | undefined;
  /** 原文行 id 数组（可空＝悬空）；只收字符串，超长截断，超量截断。 */
  sourceRefs?: unknown;
  ord?: number | undefined;
}

export interface KnowledgePoint {
  id: string;
  documentId: string;
  lessonId: string;
  kind: string;
  ord: number;
  concept: string;
  explanationMd: string;
  sourceRefs: string[];
  createdAt: string;
  updatedAt: string;
}

function narrowKind(raw: unknown): KnowledgePointKind | null {
  return typeof raw === 'string' &&
    (KNOWLEDGE_POINT_KINDS as readonly string[]).includes(raw)
    ? (raw as KnowledgePointKind)
    : null;
}

function narrowSourceRefs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !item.trim()) continue;
    out.push(item.trim().slice(0, 128));
    if (out.length >= 32) break;
  }
  return out;
}

function parseSourceRefs(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return narrowSourceRefs(parsed);
  } catch {
    return [];
  }
}

interface KnowledgePointRow {
  id: string;
  document_id: string;
  lesson_id: string;
  kind: string;
  ord: number;
  concept: string;
  explanation_md: string;
  source_refs_json: string;
  created_at: string;
  updated_at: string;
}

function toKnowledgePoint(row: KnowledgePointRow): KnowledgePoint {
  return {
    id: row.id,
    documentId: row.document_id,
    lessonId: row.lesson_id,
    kind: row.kind,
    ord: row.ord,
    concept: row.concept,
    explanationMd: row.explanation_md,
    sourceRefs: parseSourceRefs(row.source_refs_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function saveKnowledgePoints(
  deps: { sqlite: Database },
  input: { documentId: string; lessonId: string; points: SaveKnowledgePointInput[] }
): Promise<Result<{ saved: number; updated: number }, BusinessError>> {
  const documentId = input.documentId.trim();
  const lessonId = input.lessonId.trim();
  if (!documentId || documentId.length > 128 || !lessonId || lessonId.length > 128) {
    return err(new BusinessError('E_INVALID_INPUT', 'documentId 或 lessonId 非法', 'VALIDATION'));
  }
  if (!Array.isArray(input.points) || input.points.length === 0 || input.points.length > 100) {
    return err(new BusinessError('E_INVALID_INPUT', 'points 需为 1–100 条', 'VALIDATION'));
  }
  try {
    let saved = 0;
    let updated = 0;
    const now = nowIso();
    let ord = 0;
    for (const p of input.points) {
      const concept = typeof p.concept === 'string' ? p.concept.trim().slice(0, 200) : '';
      if (!concept) {
        return err(new BusinessError('E_INVALID_INPUT', 'concept 非法（不能为空）', 'VALIDATION'));
      }
      // 写口 fail-closed：未知 kind 拒绝（读口损坏值仍可回退，见 toKnowledgePoint 调用方）。
      if (p.kind !== undefined && narrowKind(p.kind) === null) {
        return err(
          new BusinessError('E_INVALID_INPUT', `kind 非法（仅允许 ${KNOWLEDGE_POINT_KINDS.join('/')})`, 'VALIDATION')
        );
      }
      const kind = narrowKind(p.kind) ?? 'concept';
      const explanationMd =
        typeof p.explanationMd === 'string' ? p.explanationMd.slice(0, 4000) : '';
      const sourceRefsJson = JSON.stringify(narrowSourceRefs(p.sourceRefs));
      const pointOrd = typeof p.ord === 'number' && Number.isInteger(p.ord) && p.ord >= 0 ? p.ord : ord;
      ord += 1;
      const existing = deps.sqlite
        .query(
          'SELECT id AS id FROM knowledge_points WHERE document_id = ? AND lesson_id = ? AND kind = ? AND concept = ? LIMIT 1'
        )
        .get(documentId, lessonId, kind, concept) as { id: string } | null;
      if (existing) {
        deps.sqlite
          .query(
            'UPDATE knowledge_points SET explanation_md = ?, source_refs_json = ?, ord = ?, updated_at = ? WHERE id = ?'
          )
          .run(explanationMd, sourceRefsJson, pointOrd, now, existing.id);
        updated += 1;
      } else {
        deps.sqlite
          .query(
            `INSERT INTO knowledge_points
               (id, document_id, lesson_id, kind, ord, concept, explanation_md, source_refs_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(generateId('knp'), documentId, lessonId, kind, pointOrd, concept, explanationMd, sourceRefsJson, now, now);
        saved += 1;
      }
    }
    return ok({ saved, updated });
  } catch (error) {
    return err(
      translateToBusinessError(error, { category: 'DATABASE', action: 'saveKnowledgePoints' })
    );
  }
}

export async function listKnowledgePoints(
  deps: { sqlite: Database },
  input: { documentId: string; lessonId?: string | undefined; kind?: string | undefined }
): Promise<Result<KnowledgePoint[], BusinessError>> {
  const documentId = input.documentId.trim();
  if (!documentId) {
    return err(new BusinessError('E_INVALID_INPUT', 'documentId 非法', 'VALIDATION'));
  }
  try {
    const conds = ['document_id = ?'];
    const args: Array<string | number> = [documentId];
    if (input.lessonId) {
      conds.push('lesson_id = ?');
      args.push(input.lessonId);
    }
    if (input.kind) {
      conds.push('kind = ?');
      args.push(input.kind);
    }
    const rows = deps.sqlite
      .query(
        `SELECT id AS id, document_id AS document_id, lesson_id AS lesson_id, kind AS kind,
                ord AS ord, concept AS concept, explanation_md AS explanation_md,
                source_refs_json AS source_refs_json, created_at AS created_at, updated_at AS updated_at
           FROM knowledge_points WHERE ${conds.join(' AND ')} ORDER BY lesson_id, ord, concept LIMIT 500`
      )
      .all(...args) as KnowledgePointRow[];
    return ok(rows.map(toKnowledgePoint));
  } catch (error) {
    return err(
      translateToBusinessError(error, { category: 'DATABASE', action: 'listKnowledgePoints' })
    );
  }
}
