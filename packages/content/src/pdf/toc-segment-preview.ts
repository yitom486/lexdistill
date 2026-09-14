import { BusinessError, err, ok, type Result } from '@study-studio/shared';
import { isSemanticOutlineTitle } from './embedded-outline-quality.js';

/**
 * E2c 起家在 content/src/pdf（前身 gateway modules/library/...；逻辑不变，
 * 仅做三处纯化：node:crypto→内联纯 JS SHA-256、Gateway 常量→本地分段规则、
 * 包自引用→相对路径；调用签名与导出形状不变）。
 *
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

/**
 * 分段 chunk 上限（恒 30 页；与 OCR 单次上限同值但为不同规则——此处是映射分段规则，
 * 由本包单测锁死；Gateway 侧 OCR 常量自行其是，两边禁互相引用）。
 */
export const TOC_SEGMENT_CHUNK_PAGES = 30;

/**
 * CMD-LINGUA-P3.2 确认条目下限：thin/empty 永不 preview/anchor/import。
 * 单条目无法做区间验证与分段（P5 全链路至少需要两锚点语义），fail-closed。
 */
export const TOC_SEGMENT_MIN_ENTRIES = 2;

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

export interface TocPlanFingerprintInput {
  pageCount: number;
  /** PDF 字节 sha256 hex（服务端每次从当前字节重算；客户端只透传比对）。 */
  pdfHashHex: string;
  entries: TocSegmentTocEntry[];
  anchors: TocSegmentAnchor[];
}

/**
 * 纯 JS SHA-256（content 禁 node:crypto；对照 RFC 6234 标准实现，
 * 空/"abc"/fox/二进制/跨块 7 向量由本包单测锁死，改实现必须先跑向量）。
 */
function sha256Digest(bytes: Uint8Array): string {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const bitLen = bytes.length * 8;
  const paddedLen = (((bytes.length + 8) >> 6) + 1) << 6;
  const msg = new Uint8Array(paddedLen);
  msg.set(bytes);
  msg[bytes.length] = 0x80;
  const dv = new DataView(msg.buffer);
  dv.setUint32(paddedLen - 4, bitLen >>> 0);
  dv.setUint32(paddedLen - 8, Math.floor(bitLen / 2 ** 32));
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = [h0, h1, h2, h3, h4, h5, h6, h7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i]! + w[i]!) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((x) => (x >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

/** PDF 字节摘要（确定性，无 IO；与 pdf-runtime 的校验口径一致）。 */
export function sha256HexBytes(bytes: Uint8Array): string {
  return sha256Digest(bytes);
}

/**
 * P5-D1 计划指纹（纯函数，确定性）：pageCount + PDF 字节哈希 +
 * 确认条目 + anchors 的规范 JSON → sha256 hex。
 * 条目顺序即目录顺序（顺序本身是计划的一部分，不排序）。
 * 导入时服务端用当前 PDF/entries/anchors 重算并逐字比对，
 * 任一变化（换文件、改条目、增删 anchor）都导致 mismatch 而 fail-closed。
 */
export function fingerprintTocPlan(input: TocPlanFingerprintInput): string {
  const canonical = JSON.stringify({
    v: 1,
    pageCount: input.pageCount,
    pdf: input.pdfHashHex,
    entries: input.entries.map((e) => [e.title, e.printedPage, e.level, e.kind]),
    anchors: input.anchors.map((a) => [a.printedPage, a.physicalPage, a.evidence]),
  });
  return sha256Digest(new TextEncoder().encode(canonical));
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
  // P3.2 thin/empty 永不 preview：确认条目不足 2 条直接拒绝（anchor/import 同漏斗）。
  if (entries.length < TOC_SEGMENT_MIN_ENTRIES) {
    return invalid(`确认目录条目不足 ${TOC_SEGMENT_MIN_ENTRIES} 条，无法分段，请先形成合格目录草稿`);
  }

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
    // P3.1B 标题内容门（与 P3 基线同一语义规则，不复制第二套）：
    // 符号-only/Markdown 残留/纯数字形一律拒绝，垃圾基线到不了导入。
    if (!isSemanticOutlineTitle(title)) return invalid('目录条目标题无语义内容（疑似符号残留或纯数字），请修正后重试');
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
