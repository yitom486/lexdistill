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
import {
  computeTocRequestKey,
  sha256HexText,
} from '../../persistence/toc-import-sessions.js';
import type {
  TocAppendChunkResult,
  TocImportChunk,
  TocImportSession,
} from '../../persistence/toc-import-sessions.js';

/**
 * CMD-LINGUA-P5D2C：执行下一个完整 chunk（append 到同一 target document）。
 *
 * Gate（fail-closed，零写直到提交事务）：
 * owner → running 且已绑定 → 最小 prepared 即上一个 completed 的直接后继 →
 * 所属 lesson 单完整 chunk → range 1..30 → session 有 AST 指纹（legacy 拒绝）→
 * `[1]` 探页数 → preview/指纹/request_key/chunk 全重算比对 →
 * 当前 AST hash 必须匹配 session 记录 → convert 精确窗 → 恰一课 →
 * 新 lesson.id 不得重复 → 单事务提交（写合并 AST + 全量 shred + 指纹 + 状态）。
 * converter 失败/0 课/多课：只记 chunk 失败计数，target 与已完成 chunk 不动。
 * 本轮只执行“下一个”；不循环、不跳过、不 retry failed。
 */

export interface TocImportExecuteNextInput {
  userId: string;
  sessionId: string;
  filename: string;
  bytes: Uint8Array;
  entries: unknown;
  anchors: unknown;
  fingerprint: unknown;
}

export interface TocImportExecuteNextDeps extends Pick<PdfImportServiceDeps, 'loadInspector' | 'runtimeDir'> {
  getSession: (
    userId: string,
    sessionId: string
  ) => Promise<{ session: TocImportSession; chunks: TocImportChunk[] } | undefined>;
  getDocument: (documentId: string) => Promise<Result<DocumentItem | null, BusinessError>>;
  commitAppendChunk: (input: {
    sessionId: string;
    userId: string;
    ordinal: number;
    book: TextbookAST;
    range: { fromPage: number; toPage: number };
  }) => Promise<Result<TocAppendChunkResult, BusinessError>>;
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

export interface TocImportExecuteNextOutput extends TocAppendChunkResult {
  sessionId: string;
  ordinal: number;
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

function legacy(): Result<never, BusinessError> {
  return err(
    new BusinessError(
      'E_TOC_LEGACY_SESSION',
      '该会话缺 AST 指纹（旧计划），不能追加，请重新准备 session 后再执行',
      'VALIDATION'
    )
  );
}

/**
 * 下一个 chunk 执行编排：读校验（零写）→ 站外 convert → 单事务提交。
 * 全 completed 即读档返回（零计算）；completed chunk 永不重算。
 */
export async function executeTocImportNext(
  deps: TocImportExecuteNextDeps,
  input: TocImportExecuteNextInput
): Promise<Result<TocImportExecuteNextOutput, BusinessError>> {
  const valid = validatePdfInput({ userId: input.userId, filename: input.filename, bytes: input.bytes });
  if (!valid.ok) return err(valid.error);
  if (!input.sessionId || typeof input.sessionId !== 'string') {
    return err(new BusinessError('E_INVALID_INPUT', '缺少导入会话标识', 'VALIDATION'));
  }
  if (typeof input.fingerprint !== 'string' || !input.fingerprint) {
    return err(new BusinessError('E_INVALID_INPUT', '预览指纹缺失，请重新请求分段预览', 'VALIDATION'));
  }

  // Gate 1：owner（不存在/他人一律 E_NOT_FOUND，无任何写）。
  let stored: { session: TocImportSession; chunks: TocImportChunk[] };
  try {
    const found = await deps.getSession(input.userId, input.sessionId);
    if (!found) {
      return err(new BusinessError('E_NOT_FOUND', '未找到指定的导入会话', 'LEARNER_STATE'));
    }
    stored = found;
  } catch (e) {
    return err(translateToBusinessError(e, 'TOC_IMPORT_EXECUTE_NEXT:load'));
  }
  const { session, chunks } = stored;

  // Gate 2：running 或 completed（prepared 请走 execute-first；终态拒绝）。
  // completed 只允许“全部完成读档”路径，下方无 prepared 即进入。
  if ((session.status !== 'running' && session.status !== 'completed') || !session.documentId) {
    return err(new BusinessError('E_INVALID_INPUT', '该导入会话当前不可追加（需 running 且已绑定文档）', 'VALIDATION'));
  }

  // Gate 3/4：最小 prepared 即上一个 completed 的直接后继；无 prepared 即全部完成→读档返回。
  const prepared = chunks.filter((c) => c.status === 'prepared').sort((a, b) => a.ordinal - b.ordinal);
  const completedOrdinals = chunks
    .filter((c) => c.status === 'completed')
    .map((c) => c.ordinal)
    .sort((a, b) => a - b);
  const next = prepared[0];
  if (!next) {
    return await readAllCompleted(deps, input, session, chunks);
  }
  if (session.status === 'completed') {
    return err(new BusinessError('E_INTERNAL', '已完成会话仍有未执行分段（数据异常）', 'INTERNAL'));
  }
  const maxCompleted = completedOrdinals.length > 0 ? (completedOrdinals[completedOrdinals.length - 1] as number) : -1;
  if (completedOrdinals.length === 0 || next.ordinal !== maxCompleted + 1) {
    return err(new BusinessError('E_INVALID_INPUT', '只能按序执行下一个分段，不可跳过', 'VALIDATION'));
  }

  // Legacy：无 AST 指纹的旧 session 不得静默补写，直接拒绝。
  if (!session.astFingerprint) {
    return legacy();
  }

  // Gate 7：preview 重算 + 指纹核验。
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

  // Gate 6/7：request_key / plan / chunk rows 全一致。
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

  // Gate 5/6：所属 lesson 单完整 chunk，range 1..30。
  const lesson = preview.lessons.find((l) => l.lessonIndex === next.lessonIndex);
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
    return err(new BusinessError('E_INVALID_INPUT', '该课不是一个完整 chunk，不能执行', 'VALIDATION'));
  }
  const rangeLength = lesson.physicalEnd - lesson.physicalStart + 1;
  if (rangeLength < 1 || rangeLength > TOC_SEGMENT_CHUNK_PAGES) {
    return err(
      new BusinessError(
        'E_INVALID_INPUT',
        `该课共 ${rangeLength} 页（单次执行上限 ${TOC_SEGMENT_CHUNK_PAGES} 页），不能执行`,
        'VALIDATION'
      )
    );
  }
  const range = { fromPage: lesson.physicalStart, toPage: lesson.physicalEnd };

  // Gate 8：当前 AST hash 必须匹配 session 记录（外部改过即拒绝）。
  const current = await deps.getDocument(session.documentId);
  if (!isOk(current)) return current;
  const doc = current.value;
  if (!doc || doc.userId !== input.userId || !doc.astJson) {
    return err(new BusinessError('E_INTERNAL', '目标教材缺失（数据异常）', 'INTERNAL'));
  }
  if (sha256HexText(doc.astJson) !== session.astFingerprint) {
    return err(
      new BusinessError('E_TOC_AST_DRIFT', '目标教材已被外部修改，拒绝追加（请检查后重新准备 session）', 'TOOL_EXECUTION')
    );
  }
  let existingLessons: Array<{ id?: unknown }>;
  try {
    const parsed = JSON.parse(doc.astJson) as { lessons?: unknown };
    if (!parsed || !Array.isArray(parsed.lessons)) {
      return err(new BusinessError('E_INTERNAL', '目标教材结构损坏（数据异常）', 'INTERNAL'));
    }
    existingLessons = parsed.lessons as Array<{ id?: unknown }>;
  } catch {
    return err(new BusinessError('E_INTERNAL', '目标教材结构损坏（数据异常）', 'INTERNAL'));
  }

  // Gate 9：converter 仅收 verified range；恰一课，否则只记失败计数。
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
      ordinal: next.ordinal,
      errorCode: converted.error.code,
    });
    return converted;
  }
  if (converted.value.book.lessons.length !== 1) {
    await deps.recordChunkFailure({
      sessionId: session.id,
      userId: input.userId,
      ordinal: next.ordinal,
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
  // Gate 10：新 lesson.id 不得与现有 AST 重复（ 时尚前校验，零写）。
  const fresh = converted.value.book.lessons[0];
  if (!fresh) {
    return err(new BusinessError('E_TOC_LESSON_SHAPE', '该范围没有解析出可用课程，已取消执行，未写入任何数据', 'TOOL_EXECUTION'));
  }
  if (existingLessons.some((l) => l.id === fresh.id)) {
    return err(
      new BusinessError('E_TOC_LESSON_SHAPE', `课程 ${fresh.id} 已存在于目标教材，拒绝重复追加`, 'VALIDATION')
    );
  }

  // 提交：单事务内重读 + 合并 + 状态流转。
  let committed: TocAppendChunkResult;
  try {
    const res = await deps.commitAppendChunk({
      sessionId: session.id,
      userId: input.userId,
      ordinal: next.ordinal,
      book: converted.value.book,
      range,
    });
    if (!isOk(res)) return res;
    committed = res.value;
  } catch (e) {
    return err(translateToBusinessError(e, 'TOC_IMPORT_EXECUTE_NEXT:commit'));
  }

  // 只记计数：不记标题、指纹原文、路径、用户。
  logger.warn('[toc-import-execute-next] 完成', {
    pages: rangeLength,
    ordinal: next.ordinal,
    committed: committed.committed,
  });
  return ok({ ...committed, sessionId: session.id, ordinal: next.ordinal });
}

/** 全 completed 读档返回（零计算）：读目标文档，返回末课摘要。 */
async function readAllCompleted(
  deps: TocImportExecuteNextDeps,
  input: TocImportExecuteNextInput,
  session: TocImportSession,
  chunks: TocImportChunk[]
): Promise<Result<TocImportExecuteNextOutput, BusinessError>> {
  if (!session.documentId) {
    return err(new BusinessError('E_INTERNAL', '已完成会话缺失教材绑定（数据异常）', 'INTERNAL'));
  }
  const got = await deps.getDocument(session.documentId);
  if (!isOk(got)) return got;
  const doc = got.value;
  if (!doc || doc.userId !== input.userId || !doc.astJson) {
    return err(new BusinessError('E_INTERNAL', '已完成会话的教材缺失（数据异常）', 'INTERNAL'));
  }
  let lessonId = '';
  let lessonTitle = '';
  let dialogues = 0;
  try {
    const saved = JSON.parse(doc.astJson) as {
      lessons?: Array<{ id?: unknown; title?: unknown; dialogues?: unknown[] }>;
    };
    // 追加序末位即最后完成的课（按 chunk 序 append 的 invariant）。
    const target = Array.isArray(saved.lessons) ? saved.lessons[saved.lessons.length - 1] : undefined;
    if (target && typeof target.id === 'string') lessonId = target.id;
    if (target && typeof target.title === 'string') lessonTitle = target.title;
    if (target && Array.isArray(target.dialogues)) dialogues = target.dialogues.length;
  } catch {
    return err(new BusinessError('E_INTERNAL', '已完成会话的教材损坏（数据异常）', 'INTERNAL'));
  }
  if (!lessonId) {
    return err(new BusinessError('E_INTERNAL', '已完成会话的教材缺失课程（数据异常）', 'INTERNAL'));
  }
  const lastOrdinal = chunks.length > 0 ? (chunks[chunks.length - 1]?.ordinal ?? 0) : 0;
  const lastChunk = chunks.find((c) => c.ordinal === lastOrdinal);
  return ok({
    documentId: session.documentId,
    lessonId,
    lessonTitle,
    range: {
      fromPage: lastChunk?.physicalStart ?? 0,
      toPage: lastChunk?.physicalEnd ?? 0,
    },
    stats: { lessons: 1, dialogues, chunks: 1 },
    sessionStatus: session.status,
    committed: false as const,
    sessionId: session.id,
    ordinal: lastOrdinal,
  });
}
