import {
  BusinessError,
  err,
  isOk,
  logger,
  ok,
  translateToBusinessError,
  type Result,
} from '@study-studio/shared';
import {
  narrowPlanAnchors,
  narrowPlanEntries,
  planTocSegments,
} from './toc-segment-plan.js';
import {
  fingerprintTocPlan,
  sha256HexBytes,
  TOC_SEGMENT_CHUNK_PAGES,
  type TocSegmentPreviewOutput,
} from './toc-segment-preview.js';
import {
  computeTocRequestKey,
  fingerprintTocChunk,
  type PreparedTocImportSession,
} from '../../persistence/toc-import-sessions.js';
import type { PdfImportServiceDeps } from './pdf-import-service.js';

/**
 * CMD-LINGUA-P5D2A：整书目录导入 prepare（只建 session，不执行导入）。
 *
 * 输入是**用户已确认**的东西：P4C 确认条目 + anchors + preview 指纹 + 展示标题。
 * 流程：输入校验 → `[1]` 探页数 → 重跑 P5-A preview → 指纹核验 →
 * 全绿 gate → request_key 幂等建 session + prepared chunks（单事务）。
 * 不调 OCR/Agent/render/convert/append/saveCanonicalAst/shred，不建 document；
 * chunk 恒 prepared（执行归 D2B）。
 */

export interface TocImportPrepareInput {
  userId: string;
  filename: string;
  bytes: Uint8Array;
  entries: unknown;
  anchors: unknown;
  fingerprint: unknown;
  docTitle?: unknown;
}

export interface TocImportPrepareDeps extends Pick<PdfImportServiceDeps, 'loadInspector' | 'runtimeDir'> {
  prepareSession: (
    input: {
      userId: string;
      requestKey: string;
      planFingerprint: string;
      pdfSha256: string;
      pageCount: number;
      lessons: Array<{ lessonIndex: number; title: string }>;
      chunks: Array<{
        ordinal: number;
        lessonIndex: number;
        lessonTitle: string;
        physicalStart: number;
        physicalEnd: number;
        chunkFingerprint: string;
      }>;
      docTitle: string;
    }
  ) => Promise<Result<PreparedTocImportSession, BusinessError>>;
}

export interface TocImportPrepareOutput {
  session: PreparedTocImportSession['session'];
  chunks: PreparedTocImportSession['chunks'];
  /** true = 同请求复用（零新行）；false = 本次新建。 */
  reused: boolean;
  pageCount: number;
}

function stale(): Result<never, BusinessError> {
  return err(
    new BusinessError(
      'E_TOC_PLAN_STALE',
      '分段预览已过期（目录、anchor 或文件可能已变更），请重新请求预览后再准备导入',
      'VALIDATION'
    )
  );
}

/**
 * 整书导入 prepare 编排（只持久化 session/chunk 计划行）：
 * 校验 → preview 重跑 → 指纹核验 → 全绿 gate → 幂等持久化。
 */
export async function prepareTocImport(
  deps: TocImportPrepareDeps,
  input: TocImportPrepareInput
): Promise<Result<TocImportPrepareOutput, BusinessError>> {
  if (!input || typeof input !== 'object') {
    return err(new BusinessError('E_INVALID_INPUT', '导入准备输入缺失', 'VALIDATION'));
  }
  if (typeof input.fingerprint !== 'string' || !input.fingerprint) {
    return err(new BusinessError('E_INVALID_INPUT', '预览指纹缺失，请重新请求分段预览', 'VALIDATION'));
  }
  const titleRaw = typeof input.docTitle === 'string' ? input.docTitle.trim().slice(0, 120) : '';

  const planned = await planTocSegments(deps, {
    userId: input.userId,
    filename: input.filename,
    bytes: input.bytes,
    entries: input.entries,
    anchors: input.anchors,
  });
  if (!isOk(planned)) return planned;
  const preview: TocSegmentPreviewOutput & { fingerprint: string } = planned.value;

  // 指纹核验：服务端窄化后的规范输入重算，逐字比对（改 PDF/条目/anchor/顺序即过期）。
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

  // 全绿 gate：unresolved / 无 end / 空计划 / 超 30 chunk 全拒绝，零 session。
  if (preview.diagnostics.unresolvedCount !== 0) {
    return err(new BusinessError('E_INVALID_INPUT', '当前目录不能自动导入；请补充或修正 anchor', 'VALIDATION'));
  }
  if (preview.diagnostics.lessonsWithoutEnd !== 0) {
    return err(new BusinessError('E_INVALID_INPUT', '存在没有终点的课，不能确定导入范围', 'VALIDATION'));
  }
  if (preview.lessons.length === 0 || preview.chunks.length === 0) {
    return err(new BusinessError('E_INVALID_INPUT', '没有可导入的课与分段', 'VALIDATION'));
  }
  for (const chunk of preview.chunks) {
    const length = chunk.physicalTo - chunk.physicalFrom + 1;
    if (!Number.isSafeInteger(length) || length < 1 || length > TOC_SEGMENT_CHUNK_PAGES) {
      return err(
        new BusinessError(
          'E_INVALID_INPUT',
          `存在超过单次上限的分段（${length} 页），不能准备导入`,
          'VALIDATION'
        )
      );
    }
  }

  const requestKey = computeTocRequestKey({
    userId: input.userId,
    pdfSha256,
    planFingerprint: preview.fingerprint,
  });
  let stored: PreparedTocImportSession;
  try {
    const res = await deps.prepareSession({
      userId: input.userId,
      requestKey,
      planFingerprint: preview.fingerprint,
      pdfSha256,
      pageCount: preview.pageCount,
      lessons: preview.lessons.map((l) => ({ lessonIndex: l.lessonIndex, title: l.title })),
      chunks: preview.chunks.map((c, ordinal) => ({
        ordinal,
        lessonIndex: c.lessonIndex,
        lessonTitle: c.title,
        physicalStart: c.physicalFrom,
        physicalEnd: c.physicalTo,
        chunkFingerprint: fingerprintTocChunk({
          requestKey,
          ordinal,
          lessonIndex: c.lessonIndex,
          physicalStart: c.physicalFrom,
          physicalEnd: c.physicalTo,
        }),
      })),
      docTitle: titleRaw,
    });
    if (!isOk(res)) return res;
    stored = res.value;
  } catch (e) {
    return err(translateToBusinessError(e, 'TOC_IMPORT_PREPARE:store'));
  }

  // 只记计数：不记标题、anchor 详情、指纹原文、路径、用户。
  logger.warn('[toc-import-prepare] 完成', {
    lessons: stored.session.lessonCount,
    chunks: stored.session.chunkCount,
    reused: stored.reused,
  });
  return ok({
    session: stored.session,
    chunks: stored.chunks,
    reused: stored.reused,
    pageCount: preview.pageCount,
  });
}
