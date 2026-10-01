import { createHash } from 'node:crypto';
import {
  ok,
  err,
  isOk,
  type Result,
  BusinessError,
  translateToBusinessError,
  generateId,
  nowIso,
} from '@study-studio/shared';
import type { Database } from 'bun:sqlite';
import { getVisibleDocument } from './document-visibility.js';

/**
 * 内容段地址（P1-3；v23）。
 * - 派生投影：课程文档由 lines 投影，用户文档由 content 切分；底稿仍是
 *   documents.ast_json／content（投影不同步改底稿）；
 * - hash 为作用域身份 `v1|document|lesson|ord|text`（P1-3 硬约束：禁裸内容 hash）；
 * - 显式投影路径 only：读（list）永不隐式写入（P1-3 硬约束）。
 */

export type ContentSegmentKind = 'paragraph' | 'dialogue' | 'heading' | 'exercise' | 'quote';

const SEGMENT_KINDS: ReadonlySet<string> = new Set([
  'paragraph',
  'dialogue',
  'heading',
  'exercise',
  'quote',
]);

export interface ContentSegment {
  id: string;
  documentId: string;
  lessonId: string;
  ord: number;
  kind: ContentSegmentKind;
  text: string;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  hash: string;
  createdAt: string;
}

/**
 * 纯切分（P2-1）：按空行分段，丢弃空白段；偏移为 UTF-16 码元下标，
 * 相对输入文本（调用方保证输入即持久化底稿，见 reproject）。
 * - 换行：\n 与 \r\n 统一处理；段内换行保留；
 * - 空段：trim 后为空即丢弃，不占 ord；
 * - 长段：不截断（大文档上限由调用方按字符数控制）。
 */
export interface TextChunk {
  text: string;
  start: number;
  end: number;
}

export function chunkTextToSegments(content: string): TextChunk[] {
  const chunks: TextChunk[] = [];
  const re = /\r?\n[ \t]*\r?\n/g;
  let segStart = 0;
  const push = (raw: string, base: number): void => {
    const leading = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (!trimmed) return;
    const start = base + leading;
    chunks.push({ text: trimmed, start, end: start + trimmed.length });
  };
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    push(content.slice(segStart, m.index), segStart);
    segStart = m.index + m[0].length;
  }
  push(content.slice(segStart), segStart);
  return chunks;
}

/**
 * 投影资格（P2-1a）：首次投影／missing／reproject 三处共用同一判定。
 * - 课程文档（curriculum_textbook）→ P2-2 lines 投影，本批不碰；
 * - PDF 导入件（任务行为 pdf）→ P2-2，本批不碰；
 * - 其余 user_import（无任务行视为 pilot 文本，显式宽容）→ 本批投影。
 * 纯函数（无 DB），DB 解释见 resolveProjectionEligibility。
 */
export function isProjectionEligible(sourceKind: string, importFormat: string | null): boolean {
  if (sourceKind === 'curriculum_textbook') return false;
  if (importFormat === 'pdf') return false;
  return true;
}

/** DB 解释：读文档行＋最新 done 任务格式（无任务行即 pilot 文本）。 */
export function resolveProjectionEligibility(
  deps: { sqlite: Database },
  documentId: string
): { eligible: boolean; sourceKind: string; importFormat: string | null } | null {
  const doc = deps.sqlite
    .query('SELECT source_kind AS sourceKind FROM documents WHERE id = ?')
    .get(documentId) as { sourceKind: string } | null;
  if (!doc) return null;
  const task = deps.sqlite
    .query(
      // P2-1b：与 missing 查询同一排序（updated_at DESC, id DESC），双执行零漂移。
      `SELECT source_kind AS sourceKind FROM document_imports
       WHERE document_id = ? AND status = 'done' ORDER BY updated_at DESC, id DESC LIMIT 1`
    )
    .get(documentId) as { sourceKind: string } | null;
  const importFormat = task ? task.sourceKind : null;
  return { eligible: isProjectionEligible(doc.sourceKind, importFormat), sourceKind: doc.sourceKind, importFormat };
}

/** 作用域段 hash（P1-2a R3＋P1-3 硬约束）：相同文本跨文档永不冲突。 */
export function segmentHash(documentId: string, lessonId: string, ord: number, text: string): string {
  return createHash('sha256')
    .update(`v1|${documentId}|${lessonId}|${ord}|${text}`, 'utf8')
    .digest('hex');
}

interface ContentSegmentRow {
  id: string;
  document_id: string;
  lesson_id: string;
  ord: number;
  kind: string;
  text: string;
  start_offset: number | null;
  end_offset: number | null;
  hash: string;
  created_at: string;
}

const SEGMENT_KIND_FALLBACK: ContentSegmentKind = 'paragraph';

function toContentSegment(row: ContentSegmentRow): ContentSegment {
  const seg: ContentSegment = {
    id: row.id,
    documentId: row.document_id,
    lessonId: row.lesson_id,
    ord: row.ord,
    kind: SEGMENT_KINDS.has(row.kind) ? (row.kind as ContentSegmentKind) : SEGMENT_KIND_FALLBACK,
    text: row.text,
    hash: row.hash,
    createdAt: row.created_at,
  };
  if (row.start_offset !== null) seg.startOffset = row.start_offset;
  if (row.end_offset !== null) seg.endOffset = row.end_offset;
  return seg;
}

export interface ProjectSegmentsInput {
  /** 投影发起用户：文档不存在或不可见一律拒绝（P1-3a，防孤儿段＋防跨用户）。 */
  userId: string;
  documentId: string;
  /** ''＝文档直属段；否则对应 lesson 行（P1-2a R3：'' 明确无外键）。 */
  lessonId?: string | undefined;
  kind?: ContentSegmentKind | undefined;
  texts: string[];
  /** 用户文档切分时传入原文偏移（与 texts 等长）；课程投影传空即 NULL。 */
  offsets?: Array<{ start: number; end: number } | null> | undefined;
}

/**
 * 显式段投影（幂等）：同 hash 跳过；同 (document,lesson,ord) 不同 hash 即报错
 * （漂移 fail-closed，不静默覆盖）。调用方：导入／shred 事务内或显式回填，
 * 永不挂在 HTTP GET／Tool 查询下。
 */
export async function projectContentSegments(
  deps: { sqlite: Database },
  input: ProjectSegmentsInput
): Promise<Result<{ inserted: number; skipped: number }, BusinessError>> {
  const userId = input.userId.trim();
  if (!userId || userId.length > 64) {
    return err(new BusinessError('E_INVALID_INPUT', 'userId 非法', 'VALIDATION'));
  }
  const documentId = input.documentId.trim();
  if (!documentId) {
    return err(new BusinessError('E_INVALID_INPUT', 'documentId 非法', 'VALIDATION'));
  }
  // P1-3a：孤儿拒绝＋可见性（不存在与不可见统一 E_NOT_FOUND，不泄露存在性）。
  if (!getVisibleDocument(deps.sqlite, userId, documentId)) {
    return err(new BusinessError('E_NOT_FOUND', '未找到指定的文档', 'LEARNER_STATE'));
  }
  const lessonId = (input.lessonId ?? '').trim();
  const kind = input.kind ?? SEGMENT_KIND_FALLBACK;
  if (!SEGMENT_KINDS.has(kind)) {
    return err(new BusinessError('E_INVALID_INPUT', 'segment kind 非法', 'VALIDATION'));
  }
  if (!Array.isArray(input.texts) || input.texts.length === 0 || input.texts.length > 5000) {
    return err(new BusinessError('E_INVALID_INPUT', '单次投影 1–5000 段', 'VALIDATION'));
  }
  try {
    const now = nowIso();
    let inserted = 0;
    let skipped = 0;
    const tx = deps.sqlite.transaction(() => {
      input.texts.forEach((rawText, i) => {
        const text = rawText.trim();
        if (!text) return;
        const hash = segmentHash(documentId, lessonId, i, text);
        const hit = deps.sqlite
          .query('SELECT id AS id, hash AS hash FROM content_segments WHERE hash = ?')
          .get(hash) as { id: string; hash: string } | null;
        if (hit) {
          skipped += 1;
          return;
        }
        const clash = deps.sqlite
          .query(
            'SELECT id AS id FROM content_segments WHERE document_id = ? AND lesson_id = ? AND ord = ?'
          )
          .get(documentId, lessonId, i) as { id: string } | null;
        if (clash) {
          throw new BusinessError(
            'E_SEGMENT_SCOPE_CONFLICT',
            `段作用域冲突：${documentId}/${lessonId || '(直属)'}/${i} 已有不同 hash 行`,
            'DATABASE'
          );
        }
        const off = input.offsets?.[i] ?? null;
        deps.sqlite
          .query(
            `INSERT INTO content_segments
               (id, document_id, lesson_id, ord, kind, text,
                start_offset, end_offset, hash, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            generateId('seg'),
            documentId,
            lessonId,
            i,
            kind,
            text,
            off ? off.start : null,
            off ? off.end : null,
            hash,
            now
          );
        inserted += 1;
      });
    });
    tx();
    return ok({ inserted, skipped });
  } catch (error) {
    return err(
      translateToBusinessError(error, { category: 'DATABASE', action: 'projectContentSegments' })
    );
  }
}

/**
 * 显式重放（P2-1 恢复路径）：读行 content→切分→project，与首次投影同一输入源，
 * hash 幂等全覆盖。调用方：脚本／测试／未来装配；不配路由／Tool，不挂读路径。
 */
export async function reprojectDocumentSegments(
  deps: { sqlite: Database },
  input: { userId: string; documentId: string }
): Promise<Result<{ inserted: number; skipped: number }, BusinessError>> {
  const userId = input.userId.trim();
  const documentId = input.documentId.trim();
  if (!userId || !documentId) {
    return err(new BusinessError('E_INVALID_INPUT', 'userId 或 documentId 非法', 'VALIDATION'));
  }
  const visible = getVisibleDocument(deps.sqlite, userId, documentId);
  if (!visible) {
    return err(new BusinessError('E_NOT_FOUND', '未找到指定的文档', 'LEARNER_STATE'));
  }
  // P2-1a：无资格文档拒绝重放（存在性已由可见性确认，此处可给原因）。
  const eligibility = resolveProjectionEligibility(deps, documentId);
  if (!eligibility || !eligibility.eligible) {
    return err(
      new BusinessError('E_INVALID_INPUT', '该文档暂不支持段投影（PDF／课程文档走 P2-2）', 'VALIDATION')
    );
  }
  const row = deps.sqlite
    .query('SELECT content AS content FROM documents WHERE id = ?')
    .get(documentId) as { content: string } | null;
  if (!row) {
    return err(new BusinessError('E_NOT_FOUND', '未找到指定的文档', 'LEARNER_STATE'));
  }
  const chunks = chunkTextToSegments(row.content);
  return projectContentSegments(
    deps,
    {
      userId,
      documentId,
      texts: chunks.map((c) => c.text),
      offsets: chunks.map((c) => ({ start: c.start, end: c.end })),
    }
  );
}

/**
 * 待投影查询（P2-1 重试信号）：有文档无段的行；课程文档天然无段，
 * 调用方按 sourceKind 过滤 user_import。本函数只读，不触发投影。
 */
export async function findDocumentsMissingSegments(
  deps: { sqlite: Database },
  userId?: string | undefined
): Promise<Result<Array<{ id: string; userId: string; sourceKind: string }>, BusinessError>> {
  try {
    // P2-1b：与 resolveProjectionEligibility 同一资格（最新 done 任务语义）。
    // SQL 无法调用 TS 纯函数，故此处编码同一规则，漂移由三历史序列测试锁定：
    // 最新 done 为 pdf → 排除；无任务（NULL IS NOT 'pdf' 为真）→ 纳入。
    const pdfGuard = `AND d.source_kind != 'curriculum_textbook'
      AND (SELECT t.source_kind FROM document_imports t
        WHERE t.document_id = d.id AND t.status = 'done'
        ORDER BY t.updated_at DESC, t.id DESC LIMIT 1) IS NOT 'pdf'`;
    const rows =
      userId === undefined
        ? (deps.sqlite
            .query(
              `SELECT d.id AS id, d.user_id AS userId, d.source_kind AS sourceKind
               FROM documents d LEFT JOIN content_segments s ON s.document_id = d.id
               WHERE s.id IS NULL ${pdfGuard}`
            )
            .all() as Array<{ id: string; userId: string; sourceKind: string }>)
        : (deps.sqlite
            .query(
              `SELECT d.id AS id, d.user_id AS userId, d.source_kind AS sourceKind
               FROM documents d LEFT JOIN content_segments s ON s.document_id = d.id
               WHERE s.id IS NULL AND d.user_id = ? ${pdfGuard}`
            )
            .all(userId) as Array<{ id: string; userId: string; sourceKind: string }>);
    return ok(rows);
  } catch (error) {
    return err(
      translateToBusinessError(error, { category: 'DATABASE', action: 'findDocumentsMissingSegments' })
    );
  }
}

/**
 * lines 读取（P2-2a）：按 (lesson,ord) 排序；只读，不触发投影。
 */
export interface TextbookLineRef {
  lessonId: string;
  ord: number;
  speaker: string | null;
  ja: string;
}

export async function listTextbookLines(
  deps: { sqlite: Database },
  documentId: string
): Promise<Result<TextbookLineRef[], BusinessError>> {
  const doc = documentId.trim();
  if (!doc) {
    return err(new BusinessError('E_INVALID_INPUT', 'documentId 非法', 'VALIDATION'));
  }
  try {
    const rows = deps.sqlite
      .query(
        `SELECT lessonId, row_number() OVER(PARTITION BY lessonId ORDER BY ord, category, id)-1 AS ord, speaker, ja FROM (
         SELECT id, chapter_id AS lessonId, ord, 0 AS category, speaker, text AS ja FROM textbook_sentences WHERE document_id = ?1
         UNION ALL SELECT id, chapter_id AS lessonId, ord, 1 AS category, NULL AS speaker, text AS ja FROM textbook_articles WHERE document_id = ?1
         ) ORDER BY lessonId, ord`
      )
      .all(doc) as TextbookLineRef[];
    return ok(rows);
  } catch (error) {
    return err(
      translateToBusinessError(error, { category: 'DATABASE', action: 'listTextbookLines' })
    );
  }
}

/**
 * lines 投影资格（P2-2a；与 pilot 谓词并存，互不相交由调用方按来源选择）。
 * 课程文档，或 user_import＋最新 done 任务为 pdf；且 lines 行数＞0。
 */
export function isLinesProjectionEligible(
  sourceKind: string,
  importFormat: string | null,
  lineCount: number
): boolean {
  if (lineCount <= 0) return false;
  if (sourceKind === 'curriculum_textbook') return true;
  if (sourceKind === 'user_import' && importFormat === 'pdf') return true;
  return false;
}

/**
 * lines → segments 投影（P2-2a；提交后显式步骤，整单事务化）。
 * - 来源唯一：lines 行（真实 lesson/ord；speaker 有无→dialogue/paragraph；offsets NULL）；
 * - 文档已有任意 segments 即整单跳过（ok＋note，不删不合并）；
 * - 可见性沿 P1-3a（自有或公共教材，不存在与不可见统一 E_NOT_FOUND）。
 */
export async function projectLinesSegments(
  deps: { sqlite: Database },
  input: { userId: string; documentId: string }
): Promise<Result<{ inserted: number; skipped: number; note?: string }, BusinessError>> {
  const userId = input.userId.trim();
  const documentId = input.documentId.trim();
  if (!userId || !documentId) {
    return err(new BusinessError('E_INVALID_INPUT', 'userId 或 documentId 非法', 'VALIDATION'));
  }
  if (!getVisibleDocument(deps.sqlite, userId, documentId)) {
    return err(new BusinessError('E_NOT_FOUND', '未找到指定的文档', 'LEARNER_STATE'));
  }
  const eligibility = resolveProjectionEligibility(deps, documentId);
  if (!eligibility) {
    return err(new BusinessError('E_NOT_FOUND', '未找到指定的文档', 'LEARNER_STATE'));
  }
  const linesRes = await listTextbookLines(deps, documentId);
  if (!isOk(linesRes)) return err(linesRes.error);
  if (!isLinesProjectionEligible(eligibility.sourceKind, eligibility.importFormat, linesRes.value.length)) {
    return err(
      new BusinessError('E_INVALID_INPUT', '该文档不适用 lines 投影（P2-1 pilot 或无 lines）', 'VALIDATION')
    );
  }
  const existing = deps.sqlite
    .query('SELECT id AS id FROM content_segments WHERE document_id = ? LIMIT 1')
    .get(documentId) as { id: string } | null;
  if (existing) {
    return ok({ inserted: 0, skipped: 0, note: 'existing-segments-kept' });
  }
  const now = nowIso();
  let inserted = 0;
  try {
    const tx = deps.sqlite.transaction(() => {
      linesRes.value.forEach((line) => {
        const text = line.ja.trim();
        if (!text) return;
        const hash = segmentHash(documentId, line.lessonId, line.ord, text);
        const hit = deps.sqlite
          .query('SELECT id AS id FROM content_segments WHERE hash = ?')
          .get(hash) as { id: string } | null;
        if (hit) return;
        deps.sqlite
          .query(
            `INSERT INTO content_segments
               (id, document_id, lesson_id, ord, kind, text,
                start_offset, end_offset, hash, created_at)
             VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`
          )
          .run(
            generateId('seg'),
            documentId,
            line.lessonId,
            line.ord,
            line.speaker && line.speaker.trim() ? 'dialogue' : 'paragraph',
            text,
            hash,
            now
          );
        inserted += 1;
      });
    });
    tx();
    return ok({ inserted, skipped: 0 });
  } catch (error) {
    return err(
      translateToBusinessError(error, { category: 'DATABASE', action: 'projectLinesSegments' })
    );
  }
}

/**
 * 待投影（lines）查询：有资格、lines＞0、尚无 segments。只读，不触发投影。
 */
export async function findDocumentsMissingLineSegments(
  deps: { sqlite: Database },
  userId?: string | undefined
): Promise<Result<Array<{ id: string; userId: string; sourceKind: string }>, BusinessError>> {
  try {
    const userGuard = userId === undefined ? '' : 'AND d.user_id = ?';
    const rows = (
      userId === undefined
        ? deps.sqlite.query(
            `SELECT d.id AS id, d.user_id AS userId, d.source_kind AS sourceKind
             FROM documents d
             WHERE NOT EXISTS (SELECT 1 FROM content_segments s WHERE s.document_id = d.id)
               AND (EXISTS (SELECT 1 FROM textbook_sentences l WHERE l.document_id = d.id) OR EXISTS (SELECT 1 FROM textbook_articles l WHERE l.document_id = d.id))
               AND (d.source_kind = 'curriculum_textbook'
                 OR (d.source_kind = 'user_import'
                   AND (SELECT t.source_kind FROM document_imports t
                     WHERE t.document_id = d.id AND t.status = 'done'
                     ORDER BY t.updated_at DESC, t.id DESC LIMIT 1) = 'pdf'))`
          ).all()
        : deps.sqlite.query(
            `SELECT d.id AS id, d.user_id AS userId, d.source_kind AS sourceKind
             FROM documents d
             WHERE NOT EXISTS (SELECT 1 FROM content_segments s WHERE s.document_id = d.id)
               AND (EXISTS (SELECT 1 FROM textbook_sentences l WHERE l.document_id = d.id) OR EXISTS (SELECT 1 FROM textbook_articles l WHERE l.document_id = d.id))
               AND (d.source_kind = 'curriculum_textbook'
                 OR (d.source_kind = 'user_import'
                   AND (SELECT t.source_kind FROM document_imports t
                     WHERE t.document_id = d.id AND t.status = 'done'
                     ORDER BY t.updated_at DESC, t.id DESC LIMIT 1) = 'pdf'))
               ${userGuard}`
          ).all(userId)
    ) as Array<{ id: string; userId: string; sourceKind: string }>;
    return ok(rows);
  } catch (error) {
    return err(
      translateToBusinessError(error, { category: 'DATABASE', action: 'findDocumentsMissingLineSegments' })
    );
  }
}

/** 只读列段（无隐式写入；未投影即空数组，调用方按需显式 project）。 */
export async function listContentSegments(
  deps: { sqlite: Database },
  documentId: string,
  lessonId?: string | undefined
): Promise<Result<ContentSegment[], BusinessError>> {
  const doc = documentId.trim();
  if (!doc) {
    return err(new BusinessError('E_INVALID_INPUT', 'documentId 非法', 'VALIDATION'));
  }
  try {
    const rows =
      lessonId === undefined
        ? (deps.sqlite
            .query(
              'SELECT * FROM content_segments WHERE document_id = ? ORDER BY lesson_id, ord'
            )
            .all(doc) as ContentSegmentRow[])
        : (deps.sqlite
            .query(
              'SELECT * FROM content_segments WHERE document_id = ? AND lesson_id = ? ORDER BY ord'
            )
            .all(doc, lessonId) as ContentSegmentRow[]);
    return ok(rows.map(toContentSegment));
  } catch (error) {
    return err(
      translateToBusinessError(error, { category: 'DATABASE', action: 'listContentSegments' })
    );
  }
}
