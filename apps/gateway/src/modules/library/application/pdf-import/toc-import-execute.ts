import {
  BusinessError,
  err,
  isOk,
  logger,
  ok,
  translateToBusinessError,
  type Result,
} from '@study-studio/shared';
import type { DocumentItem, TextbookAST } from '@study-studio/protocol';
import {
  convertPdfToAst,
  rangePages,
  validatePdfInput,
  type PdfAstOutput,
  type PdfImportServiceDeps,
} from './pdf-import-service.js';
import { narrowPlanAnchors, narrowPlanEntries, planTocSegments } from './toc-segment-plan.js';
import {
  fingerprintTocPlan,
  sha256HexBytes,
  TOC_SEGMENT_CHUNK_PAGES,
  type TocSegmentPreviewOutput,
} from './toc-segment-preview.js';
import { computeTocRequestKey } from '../../persistence/toc-import-sessions.js';
import type {
  TocFirstChunkResult,
  TocImportChunk,
  TocImportSession,
} from '../../persistence/toc-import-sessions.js';

/**
 * CMD-LINGUA-P5D2B：执行 session 首个完整 chunk（恰一次）。
 *
 * Gate（fail-closed，零写直到提交事务）：
 * owner → prepared 且未绑定 → [1] 探页数 → preview/指纹/request_key/chunk
 * 全重算比对 → ordinal=0 prepared → 所属 lesson 单完整 chunk → range 1..30 →
 * convert 精确窗 → 恰一课 → 单事务提交（含幂等读档）。
 * converter 失败/0 课/多课：只记 chunk 失败计数，session 保持 prepared。
 * 本轮只执行 ordinal=0；不做第二个 chunk、不 append、不重试 failed。
 */

export interface TocImportExecuteInput {
  userId: string;
  sessionId: string;
  filename: string;
  bytes: Uint8Array;
  entries: unknown;
  anchors: unknown;
  fingerprint: unknown;
  docTitle?: unknown;
}

export interface TocImportExecuteDeps extends Pick<PdfImportServiceDeps, 'loadInspector' | 'runtimeDir'> {
  getSession: (
    userId: string,
    sessionId: string
  ) => Promise<{ session: TocImportSession; chunks: TocImportChunk[] } | undefined>;
  getDocument: (documentId: string) => Promise<Result<DocumentItem | null, BusinessError>>;
  commitFirstChunk: (input: {
    sessionId: string;
    userId: string;
    docTitle: string;
    book: TextbookAST;
    range: { fromPage: number; toPage: number };
  }) => Promise<Result<TocFirstChunkResult, BusinessError>>;
  recordChunkFailure: (input: {
    sessionId: string;
    userId: string;
    ordinal: number;
    errorCode: string;
  }) => Promise<Result<void, BusinessError>>;
  convertRange?: (input: {
    userId: string;
    filename: string;
    bytes: Uint8Array;
    pages: number[];
  }) => Promise<Result<PdfAstOutput, BusinessError>>;
}

export interface TocImportExecuteOutput extends TocFirstChunkResult {
  sessionId: string;
}

function stale(): Result<never, BusinessError> {
  return err(
    new BusinessError(
      'E_TOC_PLAN_STALE',
      '分段预览已过期（目录、anchor 或文件可能已变更），请重新请求预览后再执行',
      'VALIDATION'
    )
  );
}

/**
 * 幂等读档（纯读）：已完成 chunk 直接返回存档结果，不探页数、不 convert、不 save。
 * 文档缺失/损坏即 INTERNAL（与执行写无关，doctor 另行告警）。
 */
async function readCompletedResult(
  deps: TocImportExecuteDeps,
  input: TocImportExecuteInput,
  session: TocImportSession,
  firstChunk: TocImportChunk
): Promise<Result<Omit<TocFirstChunkResult, 'committed'>, BusinessError>> {
  if (!session.documentId) {
    return err(new BusinessError('E_INTERNAL', '已完成分段缺失教材绑定（数据异常）', 'INTERNAL'));
  }
  const got = await deps.getDocument(session.documentId);
  if (!isOk(got)) return got;
  const doc = got.value;
  if (!doc || doc.userId !== input.userId || !doc.astJson) {
    return err(new BusinessError('E_INTERNAL', '已完成分段的教材缺失（数据异常）', 'INTERNAL'));
  }
  let lessonId = '';
  let lessonTitle = '';
  let dialogues = 0;
  try {
    const saved = JSON.parse(doc.astJson) as {
      lessons?: Array<{ id?: unknown; title?: unknown; dialogues?: unknown[] }>;
    };
    // 首 chunk 的课恒为追加序第 0 位（D2B 按 chunk 序 append，此 invariant 由执行顺序保证）。
    const target = Array.isArray(saved.lessons) ? saved.lessons[0] : undefined;
    if (target && typeof target.id === 'string') lessonId = target.id;
    if (target && typeof target.title === 'string') lessonTitle = target.title;
    if (target && Array.isArray(target.dialogues)) dialogues = target.dialogues.length;
  } catch {
    return err(new BusinessError('E_INTERNAL', '已完成分段的教材损坏（数据异常）', 'INTERNAL'));
  }
  if (!lessonId) {
    return err(new BusinessError('E_INTERNAL', '已完成分段的教材缺失课程（数据异常）', 'INTERNAL'));
  }
  return ok({
    documentId: session.documentId,
    lessonId,
    lessonTitle,
    range: { fromPage: firstChunk.physicalStart, toPage: firstChunk.physicalEnd },
    stats: { lessons: 1, dialogues, chunks: 1 },
  });
}

/**
 * 首 chunk 执行编排：读校验（零写）→ 站外 convert → 单事务提交。
 * 提交事务内重读并处理 completed 幂等；并发重复计算允许，commit 至多一次。
 */
export async function executeTocImportFirst(
  deps: TocImportExecuteDeps,
  input: TocImportExecuteInput
): Promise<Result<TocImportExecuteOutput, BusinessError>> {
  const valid = validatePdfInput({ userId: input.userId, filename: input.filename, bytes: input.bytes });
  if (!valid.ok) return err(valid.error);
  if (!input.sessionId || typeof input.sessionId !== 'string') {
    return err(new BusinessError('E_INVALID_INPUT', '缺少导入会话标识', 'VALIDATION'));
  }
  if (typeof input.fingerprint !== 'string' || !input.fingerprint) {
    return err(new BusinessError('E_INVALID_INPUT', '预览指纹缺失，请重新请求分段预览', 'VALIDATION'));
  }
  const titleRaw = typeof input.docTitle === 'string' ? input.docTitle.trim().slice(0, 120) : '';

  // Gate 1：owner（不存在/他人一律 E_NOT_FOUND，无任何写）。
  let stored: { session: TocImportSession; chunks: TocImportChunk[] };
  try {
    const found = await deps.getSession(input.userId, input.sessionId);
    if (!found) {
      return err(new BusinessError('E_NOT_FOUND', '未找到指定的导入会话', 'LEARNER_STATE'));
    }
    stored = found;
  } catch (e) {
    return err(translateToBusinessError(e, 'TOC_IMPORT_EXECUTE:load'));
  }
  const { session, chunks } = stored;

  // Gate 2/3：prepared 且未绑定（completed 走幂等读档，其余终态拒绝）。
  const firstChunk = chunks.find((c) => c.ordinal === 0);
  if (!firstChunk) {
    return err(new BusinessError('E_INVALID_INPUT', '该会话没有可执行首 chunk', 'VALIDATION'));
  }
  // 幂等快道：已完成即读档返回，不探页数、不重跑 preview、不 convert、不 save。
  if (firstChunk.status === 'completed') {
    if (!session.documentId) {
      return err(new BusinessError('E_INTERNAL', '已完成分段缺失教材绑定（数据异常）', 'INTERNAL'));
    }
    try {
      const reread = await deps.getSession(input.userId, input.sessionId);
      const docId = reread?.session.documentId;
      if (!reread || docId !== session.documentId) {
        return err(new BusinessError('E_INTERNAL', '已完成分段读取不一致（数据异常）', 'INTERNAL'));
      }
      const completed = await readCompletedResult(deps, input, session, firstChunk);
      if (!isOk(completed)) return completed;
      return ok({ ...completed.value, committed: false as const, sessionId: session.id });
    } catch (e) {
      return err(translateToBusinessError(e, 'TOC_IMPORT_EXECUTE:idempotent'));
    }
  }
  if (session.status !== 'prepared' || session.documentId) {
    return err(new BusinessError('E_INVALID_INPUT', '该导入会话当前不可执行', 'VALIDATION'));
  }
  // Gate 8：chunk prepared（本轮不 retry failed/chunk）。
  if (firstChunk.status !== 'prepared') {
    return err(new BusinessError('E_INVALID_INPUT', '该分段当前不可执行', 'VALIDATION'));
  }

  // Gate 4/5：探页数 + preview/指纹重算。
  const planned = await planTocSegments(deps, {
    userId: input.userId,
    filename: input.filename,
    bytes: input.bytes,
    entries: input.entries,
    anchors: input.anchors,
  });
  if (!isOk(planned)) return planned;
  const preview: TocSegmentPreviewOutput & { fingerprint: string } = planned.value;
  const entries = narrowPlanEntries(input.entries);
  const anchors = narrowPlanAnchors(input.anchors);
  if (!entries || !anchors) {
    return err(new BusinessError('E_INVALID_INPUT', '已确认目录或 anchor 形状不正确', 'VALIDATION'));
  }
  const pdfSha256 = sha256HexBytes(input.bytes);
  const expected = fingerprintTocPlan({ pageCount: preview.pageCount, pdfHashHex: pdfSha256, entries, anchors });
  if (expected !== input.fingerprint || preview.fingerprint !== input.fingerprint) {
    return stale();
  }

  // Gate 6：与持久化 request_key / plan / chunk rows 完全一致。
  const recomputedKey = computeTocRequestKey({ userId: input.userId, pdfSha256, planFingerprint: preview.fingerprint });
  if (
    recomputedKey !== session.requestKey ||
    preview.fingerprint !== session.planFingerprint ||
    preview.pageCount !== session.pageCount ||
    preview.lessons.length !== session.lessonCount ||
    preview.chunks.length !== session.chunkCount
  ) {
    return stale();
  }
  if (chunks.length !== preview.chunks.length) {
    return stale();
  }
  for (let i = 0; i < preview.chunks.length; i++) {
    const want = preview.chunks[i];
    const got = chunks[i];
    if (
      !want ||
      !got ||
      got.ordinal !== i ||
      got.lessonIndex !== want.lessonIndex ||
      got.physicalStart !== want.physicalFrom ||
      got.physicalEnd !== want.physicalTo
    ) {
      return stale();
    }
  }

  // Gate 7/9/10：ordinal=0 的所属 lesson 单完整 chunk，range 1..30。
  const lesson = preview.lessons.find((l) => l.lessonIndex === firstChunk.lessonIndex);
  if (!lesson || lesson.status !== 'mapped' || lesson.physicalStart === null || lesson.physicalEnd === null) {
    return stale();
  }
  const lessonChunks = preview.chunks.filter((c) => c.lessonIndex === lesson.lessonIndex);
  const onlyChunk = lessonChunks[0];
  if (
    lessonChunks.length !== 1 ||
    !onlyChunk ||
    onlyChunk.chunkIndex !== 0 ||
    onlyChunk.physicalFrom !== lesson.physicalStart ||
    onlyChunk.physicalTo !== lesson.physicalEnd
  ) {
    return err(new BusinessError('E_INVALID_INPUT', '首 chunk 不是一个完整 lesson，不能执行', 'VALIDATION'));
  }
  const rangeLength = lesson.physicalEnd - lesson.physicalStart + 1;
  if (rangeLength < 1 || rangeLength > TOC_SEGMENT_CHUNK_PAGES) {
    return err(
      new BusinessError(
        'E_INVALID_INPUT',
        `首课共 ${rangeLength} 页（单次执行上限 ${TOC_SEGMENT_CHUNK_PAGES} 页），不能执行`,
        'VALIDATION'
      )
    );
  }
  const range = { fromPage: lesson.physicalStart, toPage: lesson.physicalEnd };

  // Gate 11：converter 只收 verified range（站外计算，零写）。
  const pages = rangePages(range.fromPage, range.toPage);
  const converted = deps.convertRange
    ? await deps.convertRange({ userId: input.userId, filename: input.filename, bytes: input.bytes, pages })
    : await convertPdfToAst(
        {
          ...(deps.loadInspector ? { loadInspector: deps.loadInspector } : {}),
          ...(deps.runtimeDir ? { runtimeDir: deps.runtimeDir } : {}),
        },
        { userId: input.userId, filename: input.filename, bytes: input.bytes, pages }
      );
  if (!isOk(converted)) {
    await deps.recordChunkFailure({
      sessionId: session.id,
      userId: input.userId,
      ordinal: 0,
      errorCode: converted.error.code,
    });
    return converted;
  }
  // Gate 12：恰一课（0/多课只记失败计数，session 保持 prepared）。
  if (converted.value.book.lessons.length !== 1) {
    await deps.recordChunkFailure({
      sessionId: session.id,
      userId: input.userId,
      ordinal: 0,
      errorCode: 'E_TOC_LESSON_SHAPE',
    });
    return err(
      new BusinessError(
        'E_TOC_LESSON_SHAPE',
        converted.value.book.lessons.length === 0
          ? '该范围没有解析出可用课程，已取消执行，未写入任何数据'
          : `该范围解析出 ${converted.value.book.lessons.length} 课（只允许恰一课），已取消执行，未写入任何数据`,
        'TOOL_EXECUTION'
      )
    );
  }

  // 提交：单事务内重读 + 幂等读档 + 原子写入。
  let committed: TocFirstChunkResult;
  try {
    const res = await deps.commitFirstChunk({
      sessionId: session.id,
      userId: input.userId,
      docTitle: titleRaw,
      book: converted.value.book,
      range,
    });
    if (!isOk(res)) return res;
    committed = res.value;
  } catch (e) {
    return err(translateToBusinessError(e, 'TOC_IMPORT_EXECUTE:commit'));
  }

  // 只记计数：不记标题、指纹原文、路径、用户。
  logger.warn('[toc-import-execute] 完成', {
    pages: rangeLength,
    committed: committed.committed,
  });
  return ok({ ...committed, sessionId: session.id });
}
