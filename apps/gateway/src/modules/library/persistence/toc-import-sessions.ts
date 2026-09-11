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
import { tocImportChunks, tocImportSessions } from '../../../infrastructure/db/index.js';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';

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

export type TocImportSessionStatus = 'prepared' | 'running' | 'completed' | 'failed' | 'cancelled';

export type TocImportChunkStatus = 'prepared' | 'running' | 'completed' | 'failed';

const SESSION_STATUSES: ReadonlySet<string> = new Set([
  'prepared',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

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
  deps: RepoDeps,
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

/** 按 key 取 session + chunks（读侧永不抛；不存在返回 undefined）。 */
export async function getTocImportSession(
  deps: RepoDeps,
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
