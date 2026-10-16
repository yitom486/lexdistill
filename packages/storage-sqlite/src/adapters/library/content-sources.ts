import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
  generateId,
  nowIso,
} from '@lexdistill/shared';
import type { Database } from 'bun:sqlite';

/**
 * 统一来源登记（P1-3；v24）。
 * - display_name 可变展示列，不进唯一键；身份＝(format, origin, origin_ref)；
 * - 特设来源不建行：由 interpretSourceKind 解释到规范行。
 */

export interface ContentSource {
  id: string;
  format: string;
  origin: string;
  originRef?: string | undefined;
  displayName: string;
  license?: string | undefined;
  attribution?: string | undefined;
  capabilitiesJson: string;
  createdAt: string;
}

interface ContentSourceRow {
  id: string;
  format: string;
  origin: string;
  origin_ref: string;
  display_name: string;
  license: string | null;
  attribution: string | null;
  capabilities_json: string;
  created_at: string;
}

function toContentSource(row: ContentSourceRow): ContentSource {
  const src: ContentSource = {
    id: row.id,
    format: row.format,
    origin: row.origin,
    displayName: row.display_name,
    capabilitiesJson: row.capabilities_json,
    createdAt: row.created_at,
  };
  if (row.origin_ref) src.originRef = row.origin_ref;
  if (row.license) src.license = row.license;
  if (row.attribution) src.attribution = row.attribution;
  return src;
}

const CANONICAL_SOURCES: Array<{
  id: string;
  format: string;
  origin: string;
  displayName: string;
}> = [
  { id: 'csrc-user-text', format: 'text', origin: 'user_import', displayName: '用户文本导入' },
  { id: 'csrc-user-pdf', format: 'pdf', origin: 'user_import', displayName: '用户 PDF 导入' },
  { id: 'csrc-user-epub', format: 'epub', origin: 'user_import', displayName: '用户 EPUB 导入' },
  { id: 'csrc-user-mobi', format: 'mobi', origin: 'user_import', displayName: '用户 MOBI 导入' },
  { id: 'csrc-user-url', format: 'url', origin: 'user_import', displayName: '用户网页导入' },
  { id: 'csrc-curriculum-textbook', format: 'text', origin: 'curriculum_textbook', displayName: '内置课程教材' },
];

/** 显式写入规范来源行（幂等，可重跑；非启动装配，由调用方显式触发）。 */
export async function ensureCanonicalContentSources(deps: {
  sqlite: Database;
}): Promise<Result<{ ensured: number }, BusinessError>> {
  try {
    const now = nowIso();
    const tx = deps.sqlite.transaction(() => {
      for (const s of CANONICAL_SOURCES) {
        deps.sqlite
          .query(
            `INSERT INTO content_sources
               (id, format, origin, origin_ref, display_name, created_at)
             VALUES (?, ?, ?, '', ?, ?)
             ON CONFLICT(format, origin, origin_ref) DO NOTHING`
          )
          .run(s.id, s.format, s.origin, s.displayName, now);
      }
    });
    tx();
    return ok({ ensured: CANONICAL_SOURCES.length });
  } catch (error) {
    return err(
      translateToBusinessError(error, { category: 'DATABASE', action: 'ensureCanonicalContentSources' })
    );
  }
}

export interface InterpretedSourceKind {
  format: string;
  origin: string;
  originRef: string;
}

/**
 * 纯解释函数（无 DB）：把 documents.source_kind 旧值拆成归属轴＋格式轴。
 * 未知值 fail-closed（抛错由调用方定级），绝不臆造来源行。
 */
export function interpretSourceKind(sourceKind: string): InterpretedSourceKind {
  const v = sourceKind.trim();
  // user_import 单值无法确定格式（C1 遗留）：format 置空，调用方经 import 任务记录
  // 消歧义，绝不在此臆造为 text。
  if (v === 'user_import') return { format: '', origin: 'user_import', originRef: '' };
  if (v === 'curriculum_textbook') return { format: 'text', origin: 'curriculum_textbook', originRef: '' };
  if (v === 'pdf' || v === 'epub' || v === 'mobi' || v === 'text' || v === 'url') {
    return { format: v, origin: 'user_import', originRef: '' };
  }
  throw new BusinessError('E_INVALID_INPUT', `未知 source_kind：${v}`, 'VALIDATION');
}

/** 按身份读来源行（只读；特设组合返回 null，调用方回退规范行）。 */
export async function getContentSource(
  deps: { sqlite: Database },
  format: string,
  origin: string,
  originRef = ''
): Promise<Result<ContentSource | null, BusinessError>> {
  try {
    const row = deps.sqlite
      .query('SELECT * FROM content_sources WHERE format = ? AND origin = ? AND origin_ref = ?')
      .get(format, origin, originRef) as ContentSourceRow | null;
    return ok(row ? toContentSource(row) : null);
  } catch (error) {
    return err(
      translateToBusinessError(error, { category: 'DATABASE', action: 'getContentSource' })
    );
  }
}
