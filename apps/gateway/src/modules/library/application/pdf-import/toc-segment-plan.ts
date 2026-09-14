import {
  BusinessError,
  err,
  isOk,
  logger,
  ok,
  translateToBusinessError,
  type Result,
} from '@study-studio/shared';
import { ensurePdfRuntime } from '../../../../infrastructure/pdf-runtime/pdf-runtime.js';
import {
  probePdfPageCount,
  validatePdfInput,
  type PdfImportServiceDeps,
} from './pdf-import-service.js';
import {
  fingerprintTocPlan,
  previewTocSegments,
  sha256HexBytes,
  type TocSegmentAnchor,
  type TocSegmentPreviewOutput,
  type TocSegmentTocEntry,
} from '@study-studio/content';

/**
 * CMD-LINGUA-P5C：用户确认 anchor → 分段预览编排（只读）。
 *
 * 输入是**用户已确认**的东西：P4C 确认目录条目 + 本次显式确认的 anchors。
 * 服务只做两件事：`[1]` 探真实 pageCount，把三者喂给 P5-A 纯函数。
 * 不调 OCR/Agent/render/convert/append/save/shred，不写 DB/AST/cache；
 * 所有形状问题由 P5-A 严格校验转为 BusinessError.userMessage。
 */

export interface TocSegmentPlanInput {
  userId: string;
  filename: string;
  bytes: Uint8Array;
  entries: unknown;
  anchors: unknown;
}

/** 确认条目形状收窄（P5-D1 复用；业务校验仍由 P5-A 纯函数终审）。 */
export function narrowPlanEntries(raw: unknown): TocSegmentTocEntry[] | null {
  if (!Array.isArray(raw)) return null;
  const out: TocSegmentTocEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const rec = item as Record<string, unknown>;
    if (typeof rec.title !== 'string' || !rec.title) return null;
    if (typeof rec.printedPage !== 'number' || !Number.isSafeInteger(rec.printedPage)) return null;
    if (typeof rec.level !== 'number' || !Number.isSafeInteger(rec.level)) return null;
    if (rec.kind !== 'lesson' && rec.kind !== 'section') return null;
    out.push({ title: rec.title, printedPage: rec.printedPage, level: rec.level, kind: rec.kind });
  }
  return out;
}

/** anchor 形状收窄（P5-D1 复用；证据白名单由 P5-A 终审）。 */
export function narrowPlanAnchors(raw: unknown): TocSegmentAnchor[] | null {
  if (!Array.isArray(raw)) return null;
  const out: TocSegmentAnchor[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const rec = item as Record<string, unknown>;
    if (typeof rec.printedPage !== 'number' || !Number.isSafeInteger(rec.printedPage)) return null;
    if (typeof rec.physicalPage !== 'number' || !Number.isSafeInteger(rec.physicalPage)) return null;
    // evidence 白名单由 P5-A 终审；此处只收窄形状（字符串），未知值透传给纯函数 fail-closed。
    if (typeof rec.evidence !== 'string') return null;
    out.push({
      printedPage: rec.printedPage,
      physicalPage: rec.physicalPage,
      evidence: rec.evidence as TocSegmentAnchor['evidence'],
    });
  }
  return out;
}

/**
 * 分段预览编排（只读）：PDF 输入校验 → `[1]` 探页数 → P5-A 纯函数 → 计划指纹。
 * entries/anchors 的业务校验（单调/越界/证据白名单）全部由纯函数执行。
 */
export async function planTocSegments(
  deps: Pick<PdfImportServiceDeps, 'loadInspector' | 'runtimeDir'>,
  input: TocSegmentPlanInput
): Promise<Result<TocSegmentPreviewOutput & { fingerprint: string }, BusinessError>> {
  const valid = validatePdfInput({ userId: input.userId, filename: input.filename, bytes: input.bytes });
  if (!valid.ok) return err(valid.error);
  const entries = narrowPlanEntries(input.entries);
  if (!entries) {
    return err(new BusinessError('E_INVALID_INPUT', '已确认目录条目缺失或形状不正确', 'VALIDATION'));
  }
  const anchors = narrowPlanAnchors(input.anchors);
  if (!anchors) {
    return err(new BusinessError('E_INVALID_INPUT', 'anchor 缺失或形状不正确', 'VALIDATION'));
  }
  let pageCount = 0;
  try {
    const runtime = await ensurePdfRuntime({
      ...(deps.loadInspector ? { loadInspector: deps.loadInspector } : {}),
      ...(deps.runtimeDir ? { runtimeDir: deps.runtimeDir } : {}),
      needOcr: false,
    });
    // 诚实页数（[1] 轻探针，不扫全书）；本服务除此之外不碰任何运行时能力。
    pageCount = probePdfPageCount(runtime.inspector, input.bytes);
  } catch (e) {
    return err(
      e instanceof BusinessError
        ? e
        : new BusinessError('E_RUNTIME_LOAD', 'PDF 解析运行时准备失败，请检查网络后重试', 'NETWORK')
    );
  }
  if (!Number.isFinite(pageCount) || pageCount < 1) {
    return err(new BusinessError('E_PDF_PARSE', 'PDF 页数识别失败，文件可能已损坏', 'TOOL_EXECUTION'));
  }
  let preview: TocSegmentPreviewOutput;
  try {
    const res = previewTocSegments({ pageCount, entries, anchors });
    if (!isOk(res)) return res;
    preview = res.value;
  } catch (e) {
    return err(translateToBusinessError(e, 'TOC_SEGMENT_PLAN:pure'));
  }
  // 只记计数：不记标题、不记 anchor 详情、不记路径。
  logger.warn('[toc-segment-plan] 完成', {
    lessons: preview.diagnostics.lessonCount,
    mapped: preview.diagnostics.mappedCount,
    unresolved: preview.diagnostics.unresolvedCount,
    chunks: preview.diagnostics.chunksPlanned,
  });
  // P5-D1 计划指纹：客户端透传比对，服务端导入时重算核验。
  const fingerprint = fingerprintTocPlan({
    pageCount,
    pdfHashHex: sha256HexBytes(input.bytes),
    entries,
    anchors,
  });
  return ok({ ...preview, fingerprint });
}
