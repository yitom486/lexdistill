import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
  generateId,
  nowIso,
} from '@study-studio/shared';
import { tocImportChunks, tocImportSessions, documents } from '../../schema.js';
import type { DrizzleDb } from '../../connection.js';
import { parseTextbookAST, type TextbookAST } from '@study-studio/document-model';

/**
 * D3 起家在 storage-sqlite（前身 gateway modules/library/persistence/toc-import-sessions.ts）。
 * - 参数收窄为 `{ db }`（调用方传完整 RepoDeps 依然兼容）；
 * - shred 拆分注入：commit 系函数经参数接收 `shredIntoTransaction`
 *   （实现留守 Gateway，由门面装配；本文件永不直引 Gateway）；
 * - `ShredTx` 在此本地定义（与 textbook-shred.ts 的同名类型同构，
 *   同源 DrizzleDb，赋值兼容）。
 */
export type ShredTx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];

/** 文本摘要（确定性，无 IO；与指纹函数同口径，均为 UTF-8 字节）。 */
export function sha256HexText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * CMD-LINGUA-P5D2A：整书目录导入 session/chunk 持久化。
 *
 * - session 一行 = 一次用户确认的整书计划（immutable：本模块不提供
 *   entries/anchors 更新路径；改计划只能产生新 request_key → 新 session）；
 * - chunk 行恒 prepared（执行与状态流转归 D2B，本轮不提供）；
 * - 同 user/request_key 唯一（UNIQUE 约束为幂等底线；并发冲突走“查到即复用”）；
 * - 状态封闭枚举，读侧收窄 + doctor 规则锁（非法值回退中性默认，见下）；
 * - 不建 documents、不调 converter/shred（deps 里就没有这些能力）。
 */

export type TocImportSessionStatus =
  | 'prepared'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'target_deleted';

export type TocImportChunkStatus = 'prepared' | 'running' | 'completed' | 'failed';

const SESSION_STATUSES: ReadonlySet<string> = new Set([
  'prepared',
  'running',
  'completed',
  'failed',
  'cancelled',
  'target_deleted',
]);

/**
 * 可恢复状态（仅这些要求 target document 存在；终态 exempt，见 doctor 规则）。
 * `completed` 不在此列：完成后文档被删同样进终态（由删除生命周期置位），
 * 不视为“可恢复执行中”。导出供 doctor/服务复用同一口径。
 */
export const RESUMABLE_SESSION_STATUSES: ReadonlySet<string> = new Set(['prepared', 'running', 'failed']);

const CHUNK_STATUSES: ReadonlySet<string> = new Set(['prepared', 'running', 'completed', 'failed']);

export interface TocImportSession {
  id: string;
  userId: string;
  requestKey: string;
  planFingerprint: string;
  pdfSha256: string;
  pageCount: number;
  lessonCount: number;
  chunkCount: number;
  status: TocImportSessionStatus;
  docTitle: string;
  /**
   * session 层 target document（v20；一个 session 最多对应一个教材 document）。
   * 缺席 = 尚未绑定（D2A 恒缺席）；删除目标后保留快照做审计，但 session 已终态、永不再 resume。
   */
  documentId?: string | undefined;
  /**
   * session 层 canonical AST 指纹（v21；canonical AST JSON 的 SHA-256 hex）。
   * 缺席 = 旧 session（首 chunk 提交前或 D2A 时代行）：append 路径不得静默补写，
   * 必须明确拒绝为 legacy，要求用户重新准备 session。
   */
  astFingerprint?: string | undefined;
  error?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface TocImportChunk {
  sessionId: string;
  ordinal: number;
  lessonIndex: number;
  lessonTitle: string;
  physicalStart: number;
  physicalEnd: number;
  chunkFingerprint: string;
  status: TocImportChunkStatus;
  documentId?: string | undefined;
  attempts: number;
  error?: string | undefined;
  updatedAt: string;
}

type SessionRow = typeof tocImportSessions.$inferSelect;
type ChunkRow = typeof tocImportChunks.$inferSelect;

function toSessionStatus(raw: string): TocImportSessionStatus {
  return SESSION_STATUSES.has(raw) ? (raw as TocImportSessionStatus) : 'prepared';
}

function toChunkStatus(raw: string): TocImportChunkStatus {
  return CHUNK_STATUSES.has(raw) ? (raw as TocImportChunkStatus) : 'prepared';
}

function toSession(row: SessionRow): TocImportSession {
  const session: TocImportSession = {
    id: row.id,
    userId: row.userId,
    requestKey: row.requestKey,
    planFingerprint: row.planFingerprint,
    pdfSha256: row.pdfSha256,
    pageCount: row.pageCount,
    lessonCount: row.lessonCount,
    chunkCount: row.chunkCount,
    status: toSessionStatus(row.status),
    docTitle: row.docTitle,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (row.documentId) session.documentId = row.documentId;
  if (row.astFingerprint) session.astFingerprint = row.astFingerprint;
  if (row.error) session.error = row.error;
  return session;
}

function toChunk(row: ChunkRow): TocImportChunk {
  const chunk: TocImportChunk = {
    sessionId: row.sessionId,
    ordinal: row.ordinal,
    lessonIndex: row.lessonIndex,
    lessonTitle: row.lessonTitle,
    physicalStart: row.physicalStart,
    physicalEnd: row.physicalEnd,
    chunkFingerprint: row.chunkFingerprint,
    status: toChunkStatus(row.status),
    attempts: row.attempts,
    updatedAt: row.updatedAt,
  };
  if (row.documentId) chunk.documentId = row.documentId;
  if (row.error) chunk.error = row.error;
  return chunk;
}

/**
 * 服务端 request_key（纯函数，确定性）：user + 当前 PDF SHA-256 + canonical plan 指纹。
 * 改 PDF / entries / anchors / 顺序任一 → key 变化 → 不能复用旧 session。
 */
export function computeTocRequestKey(input: { userId: string; pdfSha256: string; planFingerprint: string }): string {
  const canonical = JSON.stringify({ v: 1, user: input.userId, pdf: input.pdfSha256, plan: input.planFingerprint });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * chunk 指纹（纯函数，确定性）：D2B 执行前重验的绑定
 *（request_key + ordinal + lesson + range，换一段即不同）。
 */
export function fingerprintTocChunk(input: {
  requestKey: string;
  ordinal: number;
  lessonIndex: number;
  physicalStart: number;
  physicalEnd: number;
}): string {
  const canonical = JSON.stringify({
    v: 1,
    session: input.requestKey,
    ordinal: input.ordinal,
    lesson: input.lessonIndex,
    from: input.physicalStart,
    to: input.physicalEnd,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export interface PrepareTocImportSessionInput {
  userId: string;
  requestKey: string;
  planFingerprint: string;
  pdfSha256: string;
  pageCount: number;
  lessons: Array<{ lessonIndex: number; title: string }>;
  chunks: Array<{ ordinal: number; lessonIndex: number; lessonTitle: string; physicalStart: number; physicalEnd: number; chunkFingerprint: string }>;
  docTitle: string;
}

export interface PreparedTocImportSession {
  session: TocImportSession;
  chunks: TocImportChunk[];
  /** true = 已存在，直接复用（零新行）；false = 本次新建。 */
  reused: boolean;
}

function rowsMatchPlan(
  session: TocImportSession,
  chunks: TocImportChunk[],
  input: PrepareTocImportSessionInput
): boolean {
  if (session.planFingerprint !== input.planFingerprint) return false;
  if (session.pdfSha256 !== input.pdfSha256 || session.pageCount !== input.pageCount) return false;
  if (session.lessonCount !== input.lessons.length || session.chunkCount !== input.chunks.length) return false;
  if (chunks.length !== input.chunks.length) return false;
  for (let i = 0; i < input.chunks.length; i++) {
    const want = input.chunks[i];
    const got = chunks[i];
    if (!want || !got) return false;
    if (
      got.ordinal !== want.ordinal ||
      got.lessonIndex !== want.lessonIndex ||
      got.physicalStart !== want.physicalStart ||
      got.physicalEnd !== want.physicalEnd ||
      got.chunkFingerprint !== want.chunkFingerprint
    ) {
      return false;
    }
  }
  return true;
}

/**
 * 幂等创建或复用 session（单事务）：
 * 查到同 key 即校验一致后复用；否则一次写入 session + 全部 prepared chunk。
 * 并发冲突（UNIQUE）走“查到即复用”，查不到才抛源错。
 */
export async function prepareTocImportSession(
  deps: { db: DrizzleDb },
  input: PrepareTocImportSessionInput
): Promise<Result<PreparedTocImportSession, BusinessError>> {
  const now = nowIso();
  try {
    const created = deps.db.transaction((tx) => {
      const existing = tx
        .select()
        .from(tocImportSessions)
        .where(and(eq(tocImportSessions.userId, input.userId), eq(tocImportSessions.requestKey, input.requestKey)))
        .all();
      const hit = existing[0];
      if (hit) {
        const rows = tx
          .select()
          .from(tocImportChunks)
          .where(eq(tocImportChunks.sessionId, hit.id))
          .all()
          .sort((a, b) => a.ordinal - b.ordinal);
        const session = toSession(hit);
        const chunks = rows.map(toChunk);
        if (!rowsMatchPlan(session, chunks, input)) {
          throw new BusinessError(
            'E_INTERNAL',
            '已存导入计划与当前计划不一致，拒绝复用（数据异常，请检查后重试）',
            'INTERNAL'
          );
        }
        return { session, chunks, reused: true as const };
      }
      const id = generateId('tocimport');
      tx.insert(tocImportSessions)
        .values({
          id,
          userId: input.userId,
          requestKey: input.requestKey,
          planFingerprint: input.planFingerprint,
          pdfSha256: input.pdfSha256,
          pageCount: input.pageCount,
          lessonCount: input.lessons.length,
          chunkCount: input.chunks.length,
          status: 'prepared',
          docTitle: input.docTitle,
          error: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      for (const chunk of input.chunks) {
        tx.insert(tocImportChunks)
          .values({
            sessionId: id,
            ordinal: chunk.ordinal,
            lessonIndex: chunk.lessonIndex,
            lessonTitle: chunk.lessonTitle,
            physicalStart: chunk.physicalStart,
            physicalEnd: chunk.physicalEnd,
            chunkFingerprint: chunk.chunkFingerprint,
            status: 'prepared',
            documentId: null,
            attempts: 0,
            error: null,
            updatedAt: now,
          })
          .run();
      }
      const sessionRows = tx.select().from(tocImportSessions).where(eq(tocImportSessions.id, id)).all();
      const chunkRows = tx
        .select()
        .from(tocImportChunks)
        .where(eq(tocImportChunks.sessionId, id))
        .all()
        .sort((a, b) => a.ordinal - b.ordinal);
      const createdSession = sessionRows[0];
      if (!createdSession) {
        throw new BusinessError('E_INTERNAL', '导入会话创建后读取失败', 'INTERNAL');
      }
      return { session: toSession(createdSession), chunks: chunkRows.map(toChunk), reused: false as const };
    });
    return ok(created);
  } catch (e) {
    if (e instanceof BusinessError) return err(e);
    // 并发/重试撞 UNIQUE：只要行已在，复用即正确（幂等底线）；不在才抛源错。
    const found = await getTocImportSession(deps, input.userId, input.requestKey);
    if (found) {
      if (!rowsMatchPlan(found.session, found.chunks, input)) {
        return err(
          new BusinessError('E_INTERNAL', '已存导入计划与当前计划不一致，拒绝复用（数据异常，请检查后重试）', 'INTERNAL')
        );
      }
      return ok({ session: found.session, chunks: found.chunks, reused: true });
    }
    return err(translateToBusinessError(e, 'prepareTocImportSession'));
  }
}

/** 按 id 取 session + chunks（读侧永不抛；不存在返回 undefined；归属由调用方校验）。 */
export async function getTocImportSessionById(
  deps: { db: DrizzleDb },
  sessionId: string
): Promise<{ session: TocImportSession; chunks: TocImportChunk[] } | undefined> {
  try {
    const rows = await deps.db.select().from(tocImportSessions).where(eq(tocImportSessions.id, sessionId));
    const hit = rows[0];
    if (!hit) return undefined;
    const chunks = await deps.db.select().from(tocImportChunks).where(eq(tocImportChunks.sessionId, hit.id));
    return {
      session: toSession(hit),
      chunks: chunks.sort((a, b) => a.ordinal - b.ordinal).map(toChunk),
    };
  } catch {
    return undefined;
  }
}

/** 按 key 取 session + chunks（读侧永不抛；不存在返回 undefined）。 */
export async function getTocImportSession(
  deps: { db: DrizzleDb },
  userId: string,
  requestKey: string
): Promise<{ session: TocImportSession; chunks: TocImportChunk[] } | undefined> {
  try {
    const rows = await deps.db
      .select()
      .from(tocImportSessions)
      .where(and(eq(tocImportSessions.userId, userId), eq(tocImportSessions.requestKey, requestKey)));
    const hit = rows[0];
    if (!hit) return undefined;
    const chunks = await deps.db
      .select()
      .from(tocImportChunks)
      .where(eq(tocImportChunks.sessionId, hit.id));
    return {
      session: toSession(hit),
      chunks: chunks.sort((a, b) => a.ordinal - b.ordinal).map(toChunk),
    };
  } catch {
    return undefined;
  }
}

/**
 * 绑定 session → target document（D2B 首个成功 chunk 在同一事务创建文档后调用，
 * 后续 chunk 只更新同一文档，本函数是唯一的绑定入口）。
 * - session 必须存在且归属调用方（否则 E_NOT_FOUND，不泄漏他人存在性）；
 * - session 必须尚未绑定（同 session 不得绑定第二个 document）；
 * - session 必须可恢复（prepared/running/failed），终态不可绑定；
 * - 目标 document 必须存在且归属调用方；
 * - 单事务内校验 + 写入。
 */
export async function bindTocImportSessionDocument(
  deps: { db: DrizzleDb },
  input: { sessionId: string; userId: string; documentId: string }
): Promise<Result<TocImportSession, BusinessError>> {
  try {
    const bound = deps.db.transaction((tx) => {
      const rows = tx.select().from(tocImportSessions).where(eq(tocImportSessions.id, input.sessionId)).all();
      const hit = rows[0];
      if (!hit || hit.userId !== input.userId) {
        throw new BusinessError('E_NOT_FOUND', '未找到指定的导入会话', 'LEARNER_STATE');
      }
      if (hit.documentId) {
        throw new BusinessError('E_INVALID_INPUT', '该导入会话已绑定教材，不可重复绑定', 'VALIDATION');
      }
      if (!RESUMABLE_SESSION_STATUSES.has(hit.status)) {
        throw new BusinessError('E_INVALID_INPUT', '该导入会话已终结，不可绑定', 'VALIDATION');
      }
      const docs = tx
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.id, input.documentId), eq(documents.userId, input.userId)))
        .all();
      if (docs.length === 0) {
        throw new BusinessError('E_NOT_FOUND', '未找到指定的教材或文档', 'LEARNER_STATE');
      }
      tx.update(tocImportSessions)
        .set({ documentId: input.documentId, updatedAt: nowIso() })
        .where(eq(tocImportSessions.id, input.sessionId))
        .run();
      const reread = tx.select().from(tocImportSessions).where(eq(tocImportSessions.id, input.sessionId)).all();
      const done = reread[0];
      if (!done) {
        throw new BusinessError('E_INTERNAL', '导入会话绑定后读取失败', 'INTERNAL');
      }
      return toSession(done);
    });
    return ok(bound);
  } catch (e) {
    if (e instanceof BusinessError) return err(e);
    return err(translateToBusinessError(e, 'bindTocImportSessionDocument'));
  }
}

/**
 * 同事务内置：目标 document 被删时，把其绑定的 session 置不可恢复终态。
 * - 由 deleteDocument 在同一事务内调用（与删文档/清 shred 同成功同回滚）；
 * - `document_id` 快照保留做审计（不清除），但 `target_deleted` 永不再 resume；
 * - 双条件（document_id + user_id）防越权清理；不删计划行；
 * - 返回受影响 session 数（0 = 无关联，最常见）。
 */
export function markSessionsTargetDeletedInTx(
  tx: ShredTx,
  input: { documentId: string; userId: string }
): number {
  const bound = tx
    .select({ id: tocImportSessions.id })
    .from(tocImportSessions)
    .where(and(eq(tocImportSessions.documentId, input.documentId), eq(tocImportSessions.userId, input.userId)))
    .all();
  if (bound.length === 0) return 0;
  tx.update(tocImportSessions)
    .set({ status: 'target_deleted', error: '目标教材已删除，会话不可恢复', updatedAt: nowIso() })
    .where(and(eq(tocImportSessions.documentId, input.documentId), eq(tocImportSessions.userId, input.userId)))
    .run();
  return bound.length;
}

export interface TocFirstChunkResult {
  documentId: string;
  lessonId: string;
  lessonTitle: string;
  range: { fromPage: number; toPage: number };
  stats: { lessons: number; dialogues: number; chunks: number };
  /** true = 本次提交生效；false = 已是 completed，幂等返回（零新写）。 */
  committed: boolean;
}

function mapBookLanguage(language: string): string {
  if (language === 'EN') return 'en';
  if (language === 'KO') return 'ko';
  return 'ja';
}

/**
 * 首 chunk 成功提交（单事务，原子）：
 * 重读 session/chunk → 已 completed 即读档返回（零新写）；
 * 否则一次写入：documents 行 + shredIntoTransaction 全 derived 投影 +
 * session 绑定并转 running + chunk completed。任一步失败整体回滚。
 * chunk 的废弃 document_id 列恒不写（NULL）。
 */
export async function commitTocFirstChunk(
  deps: { db: DrizzleDb },
  input: {
    sessionId: string;
    userId: string;
    docTitle: string;
    book: TextbookAST;
    range: { fromPage: number; toPage: number };
  },
  shredIntoTransaction: (tx: ShredTx, documentId: string, book: TextbookAST) => unknown
): Promise<Result<TocFirstChunkResult, BusinessError>> {
  const checked = parseTextbookAST(JSON.parse(JSON.stringify(input.book)));
  if (!checked.ok) return err(checked.error);
  const canonical = checked.value;
  if (canonical.lessons.length !== 1) {
    return err(
      new BusinessError('E_TOC_LESSON_SHAPE', '待提交课程不是恰一课，已取消提交', 'TOOL_EXECUTION')
    );
  }
  const only = canonical.lessons[0];
  if (!only) {
    return err(new BusinessError('E_TOC_LESSON_SHAPE', '待提交课程缺失，已取消提交', 'TOOL_EXECUTION'));
  }
  try {
    const done = deps.db.transaction((tx) => {
      const sessions = tx.select().from(tocImportSessions).where(eq(tocImportSessions.id, input.sessionId)).all();
      const session = sessions[0];
      if (!session || session.userId !== input.userId) {
        throw new BusinessError('E_NOT_FOUND', '未找到指定的导入会话', 'LEARNER_STATE');
      }
      const rows = tx
        .select()
        .from(tocImportChunks)
        .where(eq(tocImportChunks.sessionId, input.sessionId))
        .all()
        .sort((a, b) => a.ordinal - b.ordinal);
      const first = rows.find((r) => r.ordinal === 0);
      if (!first) {
        throw new BusinessError('E_INVALID_INPUT', '该会话没有可执行首 chunk', 'VALIDATION');
      }
      // 幂等：已 completed 即读档返回（不 convert、不 save、不改行）。
      // 首 chunk 的课恒为追加序第 0 位（D2B 按 chunk 序 append，此 invariant 由执行顺序保证）。
      if (first.status === 'completed' && session.documentId) {
        const docs = tx.select().from(documents).where(eq(documents.id, session.documentId)).all();
        const doc = docs[0];
        if (!doc || !doc.astJson) {
          throw new BusinessError('E_INTERNAL', '已完成 chunk 的教材缺失（数据异常）', 'INTERNAL');
        }
        let lessonId = only.id;
        let lessonTitle = only.title;
        let dialogues = only.dialogues.length;
        try {
          const saved = JSON.parse(doc.astJson) as { lessons?: Array<{ id?: unknown; title?: unknown; dialogues?: unknown[] }> };
          const savedLesson = Array.isArray(saved.lessons) ? saved.lessons[0] : undefined;
          if (savedLesson && typeof savedLesson.id === 'string') lessonId = savedLesson.id;
          if (savedLesson && typeof savedLesson.title === 'string') lessonTitle = savedLesson.title;
          if (savedLesson && Array.isArray(savedLesson.dialogues)) dialogues = savedLesson.dialogues.length;
        } catch {
          // 坏 AST 不归本路径（doctor 报漂移）；回退用本次 book
        }
        return {
          documentId: session.documentId,
          lessonId,
          lessonTitle,
          range: input.range,
          stats: { lessons: 1, dialogues, chunks: 1 },
          committed: false as const,
        };
      }
      if (session.status !== 'prepared' || session.documentId) {
        throw new BusinessError('E_INVALID_INPUT', '该导入会话当前不可执行', 'VALIDATION');
      }
      if (first.status !== 'prepared') {
        throw new BusinessError('E_INVALID_INPUT', '该 chunk 当前不可执行', 'VALIDATION');
      }
      const now = nowIso();
      const docId = generateId('doc');
      const astJson = JSON.stringify(canonical);
      tx.insert(documents)
        .values({
          id: docId,
          userId: input.userId,
          title: input.docTitle.trim() ? input.docTitle.trim().slice(0, 120) : only.title,
          sourceKind: 'user_import',
          language: mapBookLanguage(canonical.language),
          content: `单课导入 · 物理${input.range.fromPage}–${input.range.toPage}页`,
          astJson,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      shredIntoTransaction(tx, docId, canonical);
      tx.update(tocImportSessions)
        .set({ documentId: docId, astFingerprint: sha256HexText(astJson), status: 'running', error: null, updatedAt: now })
        .where(eq(tocImportSessions.id, input.sessionId))
        .run();
      tx.update(tocImportChunks)
        .set({ status: 'completed', attempts: first.attempts + 1, error: null, updatedAt: now })
        .where(and(eq(tocImportChunks.sessionId, input.sessionId), eq(tocImportChunks.ordinal, 0)))
        .run();
      return {
        documentId: docId,
        lessonId: only.id,
        lessonTitle: only.title,
        range: input.range,
        stats: { lessons: 1, dialogues: only.dialogues.length, chunks: 1 },
        committed: true as const,
      };
    });
    return ok(done);
  } catch (e) {
    if (e instanceof BusinessError) return err(e);
    return err(translateToBusinessError(e, 'commitTocFirstChunk'));
  }
}

/**
 * 记录 chunk 执行失败（converter 失败 / 0 课 / 多课时调用）：
 * 仅 attempts+1 与中性错误码；session 一律不动（保持可恢复 prepared）。
 * 归属不符即 E_NOT_FOUND，无任何写。
 */
export async function recordTocChunkFailure(
  deps: { db: DrizzleDb },
  input: { sessionId: string; userId: string; ordinal: number; errorCode: string }
): Promise<Result<void, BusinessError>> {
  try {
    deps.db.transaction((tx) => {
      const sessions = tx.select({ id: tocImportSessions.id, userId: tocImportSessions.userId }).from(tocImportSessions).where(eq(tocImportSessions.id, input.sessionId)).all();
      const session = sessions[0];
      if (!session || session.userId !== input.userId) {
        throw new BusinessError('E_NOT_FOUND', '未找到指定的导入会话', 'LEARNER_STATE');
      }
      const rows = tx
        .select()
        .from(tocImportChunks)
        .where(and(eq(tocImportChunks.sessionId, input.sessionId), eq(tocImportChunks.ordinal, input.ordinal)))
        .all();
      const hit = rows[0];
      if (!hit) {
        throw new BusinessError('E_NOT_FOUND', '未找到指定的分段', 'LEARNER_STATE');
      }
      tx.update(tocImportChunks)
        .set({ attempts: hit.attempts + 1, error: input.errorCode.slice(0, 64), updatedAt: nowIso() })
        .where(and(eq(tocImportChunks.sessionId, input.sessionId), eq(tocImportChunks.ordinal, input.ordinal)))
        .run();
    });
    return ok(undefined);
  } catch (e) {
    if (e instanceof BusinessError) return err(e);
    return err(translateToBusinessError(e, 'recordTocChunkFailure'));
  }
}

export interface TocAppendChunkResult {
  documentId: string;
  lessonId: string;
  lessonTitle: string;
  range: { fromPage: number; toPage: number };
  stats: { lessons: number; dialogues: number; chunks: number };
  sessionStatus: TocImportSessionStatus;
  /** true = 本次提交生效；false = 已是 completed，幂等返回（零新写）。 */
  committed: boolean;
}

/**
 * 后续 chunk 追加提交（单事务，原子）：
 * 重读 session/chunk/doc → 已 completed 即读档返回；
 * 否则校验 AST 链（当前 hash == session 记录）→ 合并（append-only：旧数组逐字保留、
 * 新课仅末尾）→ 写合并 AST + 全量 shred → 更新 AST 指纹 → chunk completed →
 * 无 prepared 剩余则 session completed，否则 running。
 * 任一步失败整体回滚；chunk 的废弃 document_id 列恒不写。
 */
export async function commitTocAppendChunk(
  deps: { db: DrizzleDb },
  input: {
    sessionId: string;
    userId: string;
    ordinal: number;
    book: TextbookAST;
    range: { fromPage: number; toPage: number };
  },
  shredIntoTransaction: (tx: ShredTx, documentId: string, book: TextbookAST) => unknown
): Promise<Result<TocAppendChunkResult, BusinessError>> {
  const checked = parseTextbookAST(JSON.parse(JSON.stringify(input.book)));
  if (!checked.ok) return err(checked.error);
  const canonical = checked.value;
  if (canonical.lessons.length !== 1) {
    return err(new BusinessError('E_TOC_LESSON_SHAPE', '待追加课程不是恰一课，已取消提交', 'TOOL_EXECUTION'));
  }
  const only = canonical.lessons[0];
  if (!only) {
    return err(new BusinessError('E_TOC_LESSON_SHAPE', '待追加课程缺失，已取消提交', 'TOOL_EXECUTION'));
  }
  try {
    const done = deps.db.transaction((tx) => {
      const sessions = tx.select().from(tocImportSessions).where(eq(tocImportSessions.id, input.sessionId)).all();
      const session = sessions[0];
      if (!session || session.userId !== input.userId) {
        throw new BusinessError('E_NOT_FOUND', '未找到指定的导入会话', 'LEARNER_STATE');
      }
      const rows = tx
        .select()
        .from(tocImportChunks)
        .where(eq(tocImportChunks.sessionId, input.sessionId))
        .all()
        .sort((a, b) => a.ordinal - b.ordinal);
      const target = rows.find((r) => r.ordinal === input.ordinal);
      if (!target) {
        throw new BusinessError('E_NOT_FOUND', '未找到指定的分段', 'LEARNER_STATE');
      }
      if (target.status === 'completed' && session.documentId) {
        const docs = tx.select().from(documents).where(eq(documents.id, session.documentId)).all();
        const doc = docs[0];
        if (!doc || !doc.astJson) {
          throw new BusinessError('E_INTERNAL', '已完成分段的教材缺失（数据异常）', 'INTERNAL');
        }
        return {
          documentId: session.documentId,
          lessonId: only.id,
          lessonTitle: only.title,
          range: input.range,
          stats: { lessons: 1, dialogues: only.dialogues.length, chunks: 1 },
          sessionStatus: toSessionStatus(session.status),
          committed: false as const,
        };
      }
      if (session.status !== 'running' || !session.documentId) {
        throw new BusinessError('E_INVALID_INPUT', '该导入会话当前不可追加', 'VALIDATION');
      }
      if (target.status !== 'prepared') {
        throw new BusinessError('E_INVALID_INPUT', '该分段当前不可执行', 'VALIDATION');
      }
      if (!session.astFingerprint) {
        throw new BusinessError(
          'E_TOC_LEGACY_SESSION',
          '该会话缺 AST 指纹（旧计划），请重新准备 session 后再追加',
          'VALIDATION'
        );
      }
      const docs = tx.select().from(documents).where(eq(documents.id, session.documentId)).all();
      const doc = docs[0];
      if (!doc || doc.userId !== input.userId || !doc.astJson) {
        throw new BusinessError('E_INTERNAL', '目标教材缺失（数据异常）', 'INTERNAL');
      }
      // AST 链校验：当前 hash 必须等于 session 记录（外部改过即拒绝，不向漂移文档追加）。
      if (sha256HexText(doc.astJson) !== session.astFingerprint) {
        throw new BusinessError(
          'E_TOC_AST_DRIFT',
          '目标教材已被外部修改，拒绝追加（请检查后重新准备 session）',
          'TOOL_EXECUTION'
        );
      }
      let existing: TextbookAST;
      try {
        const parsed = parseTextbookAST(JSON.parse(doc.astJson));
        if (!parsed.ok) throw parsed.error;
        existing = parsed.value;
      } catch {
        throw new BusinessError('E_INTERNAL', '目标教材结构损坏（数据异常）', 'INTERNAL');
      }
      // append-only 合并：旧课逐字保留（id/顺序/内容），新课仅末尾；id 撞车即拒。
      if (existing.lessons.some((l) => l.id === only.id)) {
        throw new BusinessError(
          'E_TOC_LESSON_SHAPE',
          `课程 ${only.id} 已存在于目标教材，拒绝重复追加`,
          'VALIDATION'
        );
      }
      const merged: TextbookAST = { ...existing, lessons: [...existing.lessons, only] };
      const rechecked = parseTextbookAST(JSON.parse(JSON.stringify(merged)));
      if (!rechecked.ok) {
        throw new BusinessError('E_INTERNAL', '合并后教材校验失败（数据异常）', 'INTERNAL');
      }
      const mergedCanonical = rechecked.value;
      const mergedJson = JSON.stringify(mergedCanonical);
      const now = nowIso();
      tx.update(documents)
        .set({ astJson: mergedJson, updatedAt: now })
        .where(eq(documents.id, session.documentId))
        .run();
      shredIntoTransaction(tx, session.documentId, mergedCanonical);
      const remaining = rows.filter((r) => r.ordinal !== input.ordinal && r.status !== 'completed').length;
      tx.update(tocImportSessions)
        .set({
          astFingerprint: sha256HexText(mergedJson),
          status: remaining === 0 ? 'completed' : 'running',
          error: null,
          updatedAt: now,
        })
        .where(eq(tocImportSessions.id, input.sessionId))
        .run();
      tx.update(tocImportChunks)
        .set({ status: 'completed', attempts: target.attempts + 1, error: null, updatedAt: now })
        .where(and(eq(tocImportChunks.sessionId, input.sessionId), eq(tocImportChunks.ordinal, input.ordinal)))
        .run();
      return {
        documentId: session.documentId,
        lessonId: only.id,
        lessonTitle: only.title,
        range: input.range,
        stats: { lessons: 1, dialogues: only.dialogues.length, chunks: 1 },
        sessionStatus: (remaining === 0 ? 'completed' : 'running') as TocImportSessionStatus,
        committed: true as const,
      };
    });
    return ok(done);
  } catch (e) {
    if (e instanceof BusinessError) return err(e);
    return err(translateToBusinessError(e, 'commitTocAppendChunk'));
  }
}

export interface TocImportChunkView {
  ordinal: number;
  lessonIndex: number;
  lessonTitle: string;
  range: { fromPage: number; toPage: number };
  status: TocImportChunkStatus;
  attempts: number;
}

export interface TocImportSessionView {
  sessionId: string;
  status: TocImportSessionStatus;
  documentId: string | null;
  totalChunks: number;
  completedChunks: number;
  chunks: TocImportChunkView[];
  /** 最小 prepared ordinal（服务端指定的 next executable），无则 null。 */
  next: { ordinal: number; lessonIndex: number; lessonTitle: string; range: { fromPage: number; toPage: number } } | null;
}

/**
 * 只读会话摘要（纯函数）：白名单字段，无 PDF/AST/folio/anchor/指纹原文。
 * next 按“最小 prepared”指定；终态/全完成即 null（调用方展示原因，不猜）。
 */
export function toTocImportSessionView(
  session: TocImportSession,
  chunks: TocImportChunk[]
): TocImportSessionView {
  const ordered = [...chunks].sort((a, b) => a.ordinal - b.ordinal);
  const completed = ordered.filter((c) => c.status === 'completed').length;
  const nextPrepared = ordered.find((c) => c.status === 'prepared');
  return {
    sessionId: session.id,
    status: session.status,
    documentId: session.documentId ?? null,
    totalChunks: ordered.length,
    completedChunks: completed,
    chunks: ordered.map((c) => ({
      ordinal: c.ordinal,
      lessonIndex: c.lessonIndex,
      lessonTitle: c.lessonTitle,
      range: { fromPage: c.physicalStart, toPage: c.physicalEnd },
      status: c.status,
      attempts: c.attempts,
    })),
    next: nextPrepared
      ? {
          ordinal: nextPrepared.ordinal,
          lessonIndex: nextPrepared.lessonIndex,
          lessonTitle: nextPrepared.lessonTitle,
          range: { fromPage: nextPrepared.physicalStart, toPage: nextPrepared.physicalEnd },
        }
      : null,
  };
}
