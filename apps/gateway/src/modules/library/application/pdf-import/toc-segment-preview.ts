import { BusinessError, err, ok, type Result } from '@study-studio/shared';
import { MAX_OCR_PAGES_PER_IMPORT } from './pdf-import-service.js';

/**
 * CMD-LINGUA-P5A：已确认目录 → 物理页映射与分段预览（纯函数，零副作用）。
 *
 * P3 已证实 `printedPage !== physicalPage`：目录上的印刷页码不能直接当 PDF
 * 物理页用。本模块只回答“如果 anchors 可信，lesson 落在哪些物理页”——
 * 输出 preview/planning，不调 PDF runtime、OCR、Agent、HTTP，不写 DB/AST/shred。
 *
 * 安全要点（fail-closed）：
 * - anchor 必须是显式证据（embedded-outline / human-confirmed / verified-folio），
 *   title、课号、模型置信度一律不得伪装成 anchor（类型层面就不收这些字段）。
 * - offset 不一致绝不强行套全书常量：只在“已验证区间”内给 end，
 *   归属无法证明的条目 physicalStart/End 保持 null。
 * - chunk 每段恒 ≤30 页（与 OCR 单次上限同值），只覆盖已确定的 range。
 */

export const TOC_SEGMENT_CHUNK_PAGES = MAX_OCR_PAGES_PER_IMPORT;

/** anchor 证据来源（封闭联合；未知字符串 fail-closed，见下）。 */
export type TocSegmentAnchorEvidence = 'embedded-outline' | 'human-confirmed' | 'verified-folio';

const KNOWN_EVIDENCE: ReadonlySet<string> = new Set([
  'embedded-outline',
  'human-confirmed',
  'verified-folio',
]);

/**
 * 显式 anchor：印刷页 ↔ 物理页的一次可验证对应。
 * verified-folio 目前尚无生产者（留给 P5-B），类型先行、文档见契约。
 */
export interface TocSegmentAnchor {
  printedPage: number;
  physicalPage: number;
  evidence: TocSegmentAnchorEvidence;
}

export interface TocSegmentTocEntry {
  title: string;
  printedPage: number;
  level: number;
  kind: 'lesson' | 'section';
}

export interface TocSegmentPreviewInput {
  pageCount: number;
  entries: TocSegmentTocEntry[];
  anchors: TocSegmentAnchor[];
}

export type TocLessonMappingStatus = 'mapped' | 'unresolved';

export type TocLessonMappingReason =
  | 'anchor-exact'
  | 'verified-interval'
  | 'consistent-extrapolation'
  | 'single-anchor-extrapolation'
  | 'no-anchors'
  | 'between-conflicting-offsets'
  | 'maps-before-page-1'
  | 'maps-beyond-pagecount';

export interface TocLessonSegment {
  /** kind=lesson 条目在原 entries 中的下标（0-based；section 不占位）。 */
  lessonIndex: number;
  title: string;
  printedStart: number;
  physicalStart: number | null;
  physicalEnd: number | null;
  status: TocLessonMappingStatus;
  reason: TocLessonMappingReason;
  /** 已验证区间 id，或 `extrapolated:<offset>`，或 null（未映射）。 */
  regionId: string | null;
  offsetUsed: number | null;
}

export interface TocMappingRegion {
  id: string;
  offset: number;
  printedFrom: number;
  printedTo: number;
  verified: true;
  anchorCount: number;
}

export interface TocSegmentChunk {
  lessonIndex: number;
  title: string;
  chunkIndex: number;
  physicalFrom: number;
  physicalTo: number;
}

export interface TocSegmentDiagnostics {
  lessonCount: number;
  sectionCountIgnored: number;
  mappedCount: number;
  unresolvedCount: number;
  regionCount: number;
  ambiguousCount: number;
  outOfBoundsCount: number;
  lessonsWithoutEnd: number;
  chunksPlanned: number;
}

export interface TocSegmentPreviewOutput {
  pageCount: number;
  lessons: TocLessonSegment[];
  regions: TocMappingRegion[];
  chunks: TocSegmentChunk[];
  diagnostics: TocSegmentDiagnostics;
}

interface ValidAnchor {
  printed: number;
  physical: number;
  offset: number;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function invalid(message: string): Result<never, BusinessError> {
  return err(new BusinessError('E_INVALID_INPUT', message, 'VALIDATION'));
}

/**
 * 印刷页 → 物理页映射与分段预览（纯函数）：
 * 输入校验（fail-closed）→ 已验证区间装配 → 逐课映射 → 相邻 end → chunk 拆分。
 * 不读运行时、不碰 IO；输入对象一律只读（排序用拷贝）。
 */
export function previewTocSegments(
  input: TocSegmentPreviewInput
): Result<TocSegmentPreviewOutput, BusinessError> {
  if (!input || typeof input !== 'object') return invalid('分段预览输入缺失');
  const { pageCount, entries, anchors } = input;
  if (!isPositiveInt(pageCount)) return invalid('pageCount 须为正整数');
  if (!Array.isArray(entries) || !Array.isArray(anchors)) return invalid('entries / anchors 须为数组');

  const validAnchors: ValidAnchor[] = [];
  for (const anchor of anchors) {
    if (!anchor || typeof anchor !== 'object') return invalid('anchor 须为对象');
    const { printedPage, physicalPage, evidence } = anchor as {
      printedPage?: unknown;
      physicalPage?: unknown;
      evidence?: unknown;
    };
    if (!isPositiveInt(printedPage) || !isPositiveInt(physicalPage)) {
      return invalid('anchor 的 printedPage / physicalPage 须为正整数');
    }
    if (typeof evidence !== 'string' || !KNOWN_EVIDENCE.has(evidence)) {
      return invalid(`anchor 证据来源未知（只接受 ${[...KNOWN_EVIDENCE].join(' / ')}）`);
    }
    if (printedPage > pageCount || physicalPage > pageCount) {
      return invalid(`anchor 超出本书（本书共 ${pageCount} 页）`);
    }
    validAnchors.push({ printed: printedPage, physical: physicalPage, offset: physicalPage - printedPage });
  }
  const ordered = validAnchors.slice().sort((a, b) => a.printed - b.printed);
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const curr = ordered[i];
    if (!prev || !curr) continue;
    if (curr.printed <= prev.printed) return invalid('anchor 的 printedPage 必须严格递增（重复/倒序不得猜）');
    if (curr.physical <= prev.physical) return invalid('anchor 的 physicalPage 必须严格递增（物理倒退不得猜）');
  }

  interface LessonRow {
    entryIndex: number;
    title: string;
    printed: number;
  }
  const lessons: LessonRow[] = [];
  let sections = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry || typeof entry !== 'object') return invalid('目录条目须为对象');
    const { title, printedPage, kind } = entry as { title?: unknown; printedPage?: unknown; kind?: unknown };
    if (kind !== 'lesson' && kind !== 'section') return invalid('目录条目 kind 只接受 lesson / section');
    if (typeof title !== 'string' || !title) return invalid('目录条目标题不能为空');
    if (!isPositiveInt(printedPage)) return invalid('目录条目 printedPage 须为正整数');
    if (kind === 'section') {
      sections++;
      continue;
    }
    lessons.push({ entryIndex: i, title, printed: printedPage });
  }
  for (let i = 1; i < lessons.length; i++) {
    const prev = lessons[i - 1];
    const curr = lessons[i];
    if (!prev || !curr) continue;
    if (curr.printed <= prev.printed) {
      return invalid('lesson 的 printedPage 必须严格递增（重复/倒序不得猜）');
    }
  }

  // 连续同 offset anchor 组成已验证区间（≥2 个 anchor 才算验证；单点不外推成区间）。
  const regions: TocMappingRegion[] = [];
  let runStart = 0;
  while (runStart < ordered.length) {
    let runEnd = runStart;
    while (
      runEnd + 1 < ordered.length &&
      ordered[runEnd + 1]?.offset === ordered[runStart]?.offset
    ) {
      runEnd++;
    }
    const first = ordered[runStart];
    const last = ordered[runEnd];
    if (first && last && runEnd > runStart) {
      const offset = first.offset;
      regions.push({
        id: `verified:${offset}:${first.printed}-${last.printed}`,
        offset,
        printedFrom: first.printed,
        printedTo: last.printed,
        verified: true,
        anchorCount: runEnd - runStart + 1,
      });
    }
    runStart = runEnd + 1;
  }

  const byPrinted = new Map<number, ValidAnchor>();
  for (const anchor of ordered) {
    if (!byPrinted.has(anchor.printed)) byPrinted.set(anchor.printed, anchor);
  }
  const regionOf = (printed: number): TocMappingRegion | null => {
    for (const region of regions) {
      if (printed >= region.printedFrom && printed <= region.printedTo) return region;
    }
    return null;
  };

  let ambiguous = 0;
  let outOfBounds = 0;
  const segments: TocLessonSegment[] = lessons.map((lesson, lessonIndex) => {
    const exact = byPrinted.get(lesson.printed);
    const verified = regionOf(lesson.printed);
    let offset: number | null = null;
    let reason: TocLessonMappingReason = 'no-anchors';
    let regionId: string | null = null;
    if (exact) {
      // 精确命中 anchor：若同时落在已验证区间内，归属区间（同 offset，可比），
      // 保证同区间相邻 lesson 的 end 可计算；区间外则记外推。
      offset = exact.offset;
      reason = 'anchor-exact';
      regionId = verified && verified.offset === exact.offset ? verified.id : `extrapolated:${offset}`;
    } else if (verified) {
      offset = verified.offset;
      reason = 'verified-interval';
      regionId = verified.id;
    } else if (ordered.length > 0) {
      let below: ValidAnchor | null = null;
      let above: ValidAnchor | null = null;
      for (const anchor of ordered) {
        if (anchor.printed < lesson.printed) below = anchor;
        if (anchor.printed > lesson.printed && !above) above = anchor;
      }
      const candidates = new Set<number>();
      if (below) candidates.add(below.offset);
      if (above) candidates.add(above.offset);
      if (candidates.size === 1) {
        const only = below?.offset ?? above?.offset;
        if (only !== undefined) {
          offset = only;
          reason = ordered.length === 1 ? 'single-anchor-extrapolation' : 'consistent-extrapolation';
          regionId = `extrapolated:${only}`;
        }
      } else if (candidates.size > 1) {
        ambiguous++;
        reason = 'between-conflicting-offsets';
      }
    }
    if (offset === null) {
      return {
        lessonIndex,
        title: lesson.title,
        printedStart: lesson.printed,
        physicalStart: null,
        physicalEnd: null,
        status: 'unresolved' as const,
        reason,
        regionId: null,
        offsetUsed: null,
      };
    }
    const physical = lesson.printed + offset;
    if (physical < 1) {
      outOfBounds++;
      return {
        lessonIndex,
        title: lesson.title,
        printedStart: lesson.printed,
        physicalStart: null,
        physicalEnd: null,
        status: 'unresolved' as const,
        reason: 'maps-before-page-1' as const,
        regionId: null,
        offsetUsed: null,
      };
    }
    if (physical > pageCount) {
      outOfBounds++;
      return {
        lessonIndex,
        title: lesson.title,
        printedStart: lesson.printed,
        physicalStart: null,
        physicalEnd: null,
        status: 'unresolved' as const,
        reason: 'maps-beyond-pagecount' as const,
        regionId: null,
        offsetUsed: null,
      };
    }
    return {
      lessonIndex,
      title: lesson.title,
      printedStart: lesson.printed,
      physicalStart: physical,
      physicalEnd: null,
      status: 'mapped' as const,
      reason,
      regionId,
      offsetUsed: offset,
    };
  });

  // end 仅当本条与下一条同处同一已验证区间；末课取区间物理尾（皆为已证明范围）。
  let withoutEnd = 0;
  for (let i = 0; i < segments.length; i++) {
    const current = segments[i];
    if (!current || current.status !== 'mapped' || current.physicalStart === null) {
      if (current?.status === 'mapped') withoutEnd++;
      continue;
    }
    const next = segments[i + 1];
    if (
      next &&
      next.status === 'mapped' &&
      next.physicalStart !== null &&
      current.regionId !== null &&
      current.regionId === next.regionId &&
      current.regionId.startsWith('verified:')
    ) {
      current.physicalEnd = next.physicalStart - 1;
      continue;
    }
    if (!next && current.regionId !== null && current.regionId.startsWith('verified:')) {
      const region = regions.find((r) => r.id === current.regionId);
      if (region) {
        current.physicalEnd = region.printedTo + region.offset;
        continue;
      }
    }
    withoutEnd++;
  }

  // chunk：只覆盖已确定的 range，每段恒 ≤30 页。
  const chunks: TocSegmentChunk[] = [];
  for (const segment of segments) {
    if (
      segment.status !== 'mapped' ||
      segment.physicalStart === null ||
      segment.physicalEnd === null ||
      segment.physicalEnd < segment.physicalStart
    ) {
      continue;
    }
    let from = segment.physicalStart;
    let chunkIndex = 0;
    while (from <= segment.physicalEnd) {
      const to = Math.min(from + TOC_SEGMENT_CHUNK_PAGES - 1, segment.physicalEnd);
      chunks.push({
        lessonIndex: segment.lessonIndex,
        title: segment.title,
        chunkIndex,
        physicalFrom: from,
        physicalTo: to,
      });
      from = to + 1;
      chunkIndex++;
    }
  }

  const mapped = segments.filter((s) => s.status === 'mapped').length;
  return ok({
    pageCount,
    lessons: segments,
    regions,
    chunks,
    diagnostics: {
      lessonCount: segments.length,
      sectionCountIgnored: sections,
      mappedCount: mapped,
      unresolvedCount: segments.length - mapped,
      regionCount: regions.length,
      ambiguousCount: ambiguous,
      outOfBoundsCount: outOfBounds,
      lessonsWithoutEnd: withoutEnd,
      chunksPlanned: chunks.length,
    },
  });
}
