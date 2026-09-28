/**
 * CMD-LINGUA-P5C：anchor 确认与分段预览纯逻辑（无 React、无 fetch、无存储）。
 *
 * - 候选页号解析：显式集合，最多 8 页，超限/非法 fail-closed（不发请求）；
 * - anchor 确认守门：只有 Arabic 候选可成数字页 anchor（Roman 仅前言证据），
 *   重复印刷页拒绝；守门通过仍需调用方显式 dispatch（点击），不存在自动路径；
 * - evidence 固定 `human-confirmed`（P5-A 白名单既有成员，不新增类型）；
 * - 预览请求体装配 + 指纹（anchor 变更即预览失效）；
 * - 后端负载收窄（folio / preview），形状不对返回 null。
 */

export const ANCHOR_CHECK_MAX_PAGES = 8;

/** 本地 anchor（本次浏览器会话 state；evidence 恒为 human-confirmed）。 */
export interface LocalAnchor {
  printedPage: number;
  physicalPage: number;
  evidence: 'human-confirmed';
  /** 展示标签，如 `印18 ↔ 物26`（纯展示，不参与指纹）。 */
  label: string;
}

export interface FolioCandidateData {
  raw: string;
  normalized: { kind: 'arabic'; value: number } | { kind: 'roman'; value: string };
  location: 'header' | 'footer';
  source: 'native' | 'ocr';
  confidence: 'low' | 'medium';
}

export interface FolioPageData {
  physicalPage: number;
  candidates: FolioCandidateData[];
}

export interface FolioResponseData {
  pageCount: number;
  pages: FolioPageData[];
}

export interface PreviewLessonData {
  lessonIndex: number;
  title: string;
  printedStart: number;
  physicalStart: number | null;
  physicalEnd: number | null;
  status: 'mapped' | 'unresolved';
  reason: string;
  regionId: string | null;
  offsetUsed: number | null;
}

export interface PreviewChunkData {
  lessonIndex: number;
  title: string;
  chunkIndex: number;
  physicalFrom: number;
  physicalTo: number;
}

export interface PreviewResponseData {
  pageCount: number;
  lessons: PreviewLessonData[];
  regions: Array<{ id: string; offset: number; printedFrom: number; printedTo: number; verified: boolean; anchorCount: number }>;
  chunks: PreviewChunkData[];
  diagnostics: {
    lessonCount: number;
    mappedCount: number;
    unresolvedCount: number;
    regionCount: number;
    chunksPlanned: number;
    lessonsWithoutEnd: number;
  };
  /** P5-D1 计划指纹（服务端计算；导入时原样带回核验）。 */
  fingerprint: string;
}

export type AnchorPagesValidation = { ok: true; pages: number[] } | { ok: false; message: string };

/**
 * 待检查页号解析（纯函数）：逗号/空白分隔，最多 8 页，去重排序。
 * 非法即 ok:false，调用方展示 message，绝不发请求。
 */
export function parseAnchorCheckPages(text: string): AnchorPagesValidation {
  const tokens = text.split(/[,，\s]+/).map((t) => t.trim()).filter((t) => t.length > 0);
  if (tokens.length === 0) {
    return { ok: false, message: '请填写要检查的 PDF 物理页号（如 26,31）' };
  }
  const pages: number[] = [];
  for (const token of tokens) {
    if (!/^\d+$/.test(token)) {
      return { ok: false, message: `页号“${token.slice(0, 12)}”不是正整数` };
    }
    const page = Number(token);
    if (!Number.isSafeInteger(page) || page < 1) {
      return { ok: false, message: `页号“${token.slice(0, 12)}”不是正整数` };
    }
    if (!pages.includes(page)) pages.push(page);
  }
  pages.sort((a, b) => a - b);
  if (pages.length > ANCHOR_CHECK_MAX_PAGES) {
    return { ok: false, message: `一次最多检查 ${ANCHOR_CHECK_MAX_PAGES} 页（当前 ${pages.length} 页）` };
  }
  return { ok: true, pages };
}

export type AnchorDecision = { ok: true; anchor: LocalAnchor } | { ok: false; message: string };

/**
 * folio 候选确认守门（纯函数）：只有用户点击候选才产出 anchor。
 * - Roman 一律拒绝（仅前言证据，不能映射数字印刷页）；
 * - 重复印刷页拒绝（P5-A fail-closed，提前拦下给友好文案）；
 * - 通过仍只返回 anchor 对象，是否进入 state 由调用方显式 dispatch 决定
 *   （本模块不存在“看到候选就自动确认”的路径）。
 */
export function decideAnchorConfirm(
  candidate: FolioCandidateData,
  physicalPage: number,
  existing: LocalAnchor[]
): AnchorDecision {
  if (candidate.normalized.kind !== 'arabic') {
    return { ok: false, message: 'Roman 候选仅为前言证据，不能成为数字页 anchor' };
  }
  const printed = candidate.normalized.value;
  if (existing.some((a) => a.printedPage === printed)) {
    return { ok: false, message: `印刷页 ${printed} 已有 anchor，先移除再确认` };
  }
  return {
    ok: true,
    anchor: {
      printedPage: printed,
      physicalPage,
      evidence: 'human-confirmed',
      label: `印${printed} ↔ 物${physicalPage}`,
    },
  };
}

/** Explicitly entered folio pair. The user must inspect the PDF before confirming it. */
export function decideManualAnchorConfirm(
  printedText: string,
  physicalText: string,
  existing: LocalAnchor[],
): AnchorDecision {
  if (!/^\d+$/.test(printedText.trim()) || !/^\d+$/.test(physicalText.trim())) {
    return { ok: false, message: '印刷页和 PDF 物理页都必须是正整数' };
  }
  const printedPage = Number(printedText.trim());
  const physicalPage = Number(physicalText.trim());
  if (!Number.isSafeInteger(printedPage) || !Number.isSafeInteger(physicalPage) || printedPage < 1 || physicalPage < 1) {
    return { ok: false, message: '印刷页和 PDF 物理页都必须是正整数' };
  }
  if (existing.some((anchor) => anchor.printedPage === printedPage || anchor.physicalPage === physicalPage)) {
    return { ok: false, message: '该印刷页或 PDF 物理页已有 anchor，请先移除再确认' };
  }
  return {
    ok: true,
    anchor: {
      printedPage,
      physicalPage,
      evidence: 'human-confirmed',
      label: `印${printedPage} ↔ 物${physicalPage}`,
    },
  };
}

export interface AnchorFlowState {
  anchors: LocalAnchor[];
  checkText: string;
  /** 请求预览时的 anchor 指纹；null = 尚未请求。 */
  previewSig: string | null;
}

export const initialAnchorFlowState: AnchorFlowState = {
  anchors: [],
  checkText: '',
  previewSig: null,
};

export type AnchorFlowAction =
  | { type: 'set-check-text'; text: string }
  | { type: 'confirm-anchor'; anchor: LocalAnchor }
  | { type: 'remove-anchor'; printedPage: number }
  | { type: 'preview-requested'; sig: string }
  | { type: 'preview-cleared' };

/**
 * anchor 状态机（纯函数）：只有显式动作能增删 anchor；
 * anchor 集合任何变化都使旧 preview 指纹失效（由视图按指纹比对展示“请重新请求”）。
 */
export function anchorFlowReducer(state: AnchorFlowState, action: AnchorFlowAction): AnchorFlowState {
  switch (action.type) {
    case 'set-check-text':
      return { ...state, checkText: action.text };
    case 'confirm-anchor':
      if (state.anchors.some((a) => a.printedPage === action.anchor.printedPage)) return state;
      return { ...state, anchors: [...state.anchors, action.anchor], previewSig: null };
    case 'remove-anchor':
      return {
        ...state,
        anchors: state.anchors.filter((a) => a.printedPage !== action.printedPage),
        previewSig: null,
      };
    case 'preview-requested':
      return { ...state, previewSig: action.sig };
    case 'preview-cleared':
      return { ...state, previewSig: null };
    default:
      return state;
  }
}

/** anchor 指纹（纯函数）：printed/physical 有序对 JSON；label 不参与。 */
export function fingerprintAnchors(anchors: LocalAnchor[]): string {
  const pairs = anchors
    .map((a) => [a.printedPage, a.physicalPage] as [number, number])
    .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  return JSON.stringify(pairs);
}

export interface PreviewEntryInput {
  title: string;
  printedPage: string;
  level: 1 | 2;
  kind: 'lesson' | 'section';
}

export type PreviewEntriesBuild =
  | { ok: true; entries: Array<{ title: string; printedPage: number; level: number; kind: 'lesson' | 'section' }> }
  | { ok: false; message: string };

/** 预览请求条目装配（纯函数）：P4C 编辑态（页码字符串）→ 网关数值形状。 */
export function buildPreviewEntries(edits: PreviewEntryInput[]): PreviewEntriesBuild {
  if (edits.length === 0) {
    return { ok: false, message: '没有可预览的确认条目' };
  }
  const entries: Array<{ title: string; printedPage: number; level: number; kind: 'lesson' | 'section' }> = [];
  for (const edit of edits) {
    if (!edit.title.trim()) {
      return { ok: false, message: '存在空标题条目，请补全后再预览' };
    }
    if (!/^\d+$/.test(edit.printedPage.trim())) {
      return { ok: false, message: `条目“${edit.title.slice(0, 12)}”的印刷页不是正整数` };
    }
    const printed = Number(edit.printedPage.trim());
    if (!Number.isSafeInteger(printed) || printed < 1) {
      return { ok: false, message: `条目“${edit.title.slice(0, 12)}”的印刷页不是正整数` };
    }
    entries.push({ title: edit.title, printedPage: printed, level: edit.level, kind: edit.kind });
  }
  return { ok: true, entries };
}

/**
 * 双源一致提示（纯函数，展示用）：同物理页出现 native 与 ocr 的同值 Arabic 候选。
 * 只做 UI 辅助提示，不改变“必须手动确认”规则。
 */
export function findCorroboratedFolios(pages: FolioPageData[]): Array<{ physicalPage: number; value: number }> {
  const out: Array<{ physicalPage: number; value: number }> = [];
  for (const page of pages) {
    const nativeValues = new Set(
      page.candidates
        .filter((c) => c.source === 'native' && c.normalized.kind === 'arabic')
        .map((c) => (c.normalized.kind === 'arabic' ? c.normalized.value : -1))
    );
    const agreed = page.candidates.find(
      (c) => c.source === 'ocr' && c.normalized.kind === 'arabic' && nativeValues.has(c.normalized.value)
    );
    if (agreed && agreed.normalized.kind === 'arabic') {
      out.push({ physicalPage: page.physicalPage, value: agreed.normalized.value });
    }
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function narrowFolioCandidate(value: unknown): FolioCandidateData | null {
  if (!isRecord(value)) return null;
  const { raw, normalized, location, source, confidence } = value;
  if (typeof raw !== 'string' || !raw) return null;
  if (!isRecord(normalized)) return null;
  const kind = (normalized as Record<string, unknown>).kind;
  const numValue = (normalized as Record<string, unknown>).value;
  if (kind === 'arabic') {
    if (typeof numValue !== 'number' || !Number.isSafeInteger(numValue)) return null;
  } else if (kind === 'roman') {
    if (typeof numValue !== 'string' || !numValue) return null;
  } else {
    return null;
  }
  if (location !== 'header' && location !== 'footer') return null;
  if (source !== 'native' && source !== 'ocr') return null;
  if (confidence !== 'low' && confidence !== 'medium') return null;
  const candidate: FolioCandidateData = {
    raw,
    normalized: kind === 'arabic'
      ? { kind: 'arabic', value: numValue as number }
      : { kind: 'roman', value: numValue as string },
    location,
    source,
    confidence,
  };
  return candidate;
}

/** folio-candidates 负载收窄（纯函数）。 */
export function narrowFolioResponse(payload: unknown): FolioResponseData | null {
  if (!isRecord(payload)) return null;
  const { pageCount, pages } = payload;
  if (typeof pageCount !== 'number' || !Number.isSafeInteger(pageCount)) return null;
  if (!Array.isArray(pages)) return null;
  const narrowed: FolioPageData[] = [];
  for (const item of pages) {
    if (!isRecord(item)) return null;
    if (typeof item.physicalPage !== 'number' || !Number.isSafeInteger(item.physicalPage)) return null;
    if (!Array.isArray(item.candidates)) return null;
    const candidates: FolioCandidateData[] = [];
    for (const raw of item.candidates) {
      const candidate = narrowFolioCandidate(raw);
      if (!candidate) return null;
      candidates.push(candidate);
    }
    narrowed.push({ physicalPage: item.physicalPage, candidates });
  }
  return { pageCount, pages: narrowed };
}

/** preview-toc-segments 负载收窄（纯函数；展示所需字段严格收敛）。 */
export function narrowPreviewResponse(payload: unknown): PreviewResponseData | null {
  if (!isRecord(payload)) return null;
  const { pageCount, lessons, regions, chunks, diagnostics } = payload;
  if (typeof pageCount !== 'number' || !Number.isSafeInteger(pageCount)) return null;
  if (!Array.isArray(lessons) || !Array.isArray(regions) || !Array.isArray(chunks) || !isRecord(diagnostics)) return null;
  const narrowedRegions: PreviewResponseData['regions'] = [];
  for (const item of regions) {
    if (!isRecord(item)) return null;
    if (typeof item.id !== 'string' || typeof item.offset !== 'number') return null;
    if (typeof item.printedFrom !== 'number' || typeof item.printedTo !== 'number') return null;
    if (typeof item.verified !== 'boolean' || typeof item.anchorCount !== 'number') return null;
    narrowedRegions.push({
      id: item.id,
      offset: item.offset,
      printedFrom: item.printedFrom,
      printedTo: item.printedTo,
      verified: item.verified,
      anchorCount: item.anchorCount,
    });
  }
  const narrowedLessons: PreviewLessonData[] = [];
  for (const item of lessons) {
    if (!isRecord(item)) return null;
    if (typeof item.lessonIndex !== 'number' || typeof item.title !== 'string') return null;
    if (typeof item.printedStart !== 'number') return null;
    if (item.physicalStart !== null && typeof item.physicalStart !== 'number') return null;
    if (item.physicalEnd !== null && typeof item.physicalEnd !== 'number') return null;
    if (item.status !== 'mapped' && item.status !== 'unresolved') return null;
    if (typeof item.reason !== 'string') return null;
    if (item.regionId !== null && typeof item.regionId !== 'string') return null;
    if (item.offsetUsed !== null && typeof item.offsetUsed !== 'number') return null;
    narrowedLessons.push({
      lessonIndex: item.lessonIndex,
      title: item.title,
      printedStart: item.printedStart,
      physicalStart: item.physicalStart,
      physicalEnd: item.physicalEnd,
      status: item.status,
      reason: item.reason,
      regionId: item.regionId,
      offsetUsed: item.offsetUsed,
    });
  }
  const narrowedChunks: PreviewChunkData[] = [];
  for (const item of chunks) {
    if (!isRecord(item)) return null;
    if (typeof item.lessonIndex !== 'number' || typeof item.title !== 'string') return null;
    if (typeof item.chunkIndex !== 'number' || typeof item.physicalFrom !== 'number' || typeof item.physicalTo !== 'number') {
      return null;
    }
    narrowedChunks.push({
      lessonIndex: item.lessonIndex,
      title: item.title,
      chunkIndex: item.chunkIndex,
      physicalFrom: item.physicalFrom,
      physicalTo: item.physicalTo,
    });
  }
  const diag = diagnostics as Record<string, unknown>;
  for (const key of ['lessonCount', 'mappedCount', 'unresolvedCount', 'regionCount', 'chunksPlanned', 'lessonsWithoutEnd']) {
    if (typeof diag[key] !== 'number') return null;
  }
  if (typeof (payload as Record<string, unknown>).fingerprint !== 'string') return null;
  return {
    pageCount,
    lessons: narrowedLessons,
    regions: narrowedRegions,
    chunks: narrowedChunks,
    diagnostics: {
      lessonCount: diag.lessonCount as number,
      mappedCount: diag.mappedCount as number,
      unresolvedCount: diag.unresolvedCount as number,
      regionCount: diag.regionCount as number,
      chunksPlanned: diag.chunksPlanned as number,
      lessonsWithoutEnd: diag.lessonsWithoutEnd as number,
    },
    fingerprint: (payload as Record<string, unknown>).fingerprint as string,
  };
}

export interface TocLessonImportResult {
  documentId: string;
  lessonId: string;
  lessonTitle: string;
  range: { fromPage: number; toPage: number };
  pageCount: number;
  stats: { lessons: number; dialogues: number; chunks: number };
}

/** import-toc-lesson 负载收窄（纯函数）。 */
export function narrowTocLessonImport(payload: unknown): TocLessonImportResult | null {
  if (!isRecord(payload)) return null;
  const { documentId, lessonId, lessonTitle, range, pageCount, stats } = payload;
  if (typeof documentId !== 'string' || !documentId) return null;
  if (typeof lessonId !== 'string' || !lessonId) return null;
  if (typeof lessonTitle !== 'string' || !lessonTitle) return null;
  if (!isRecord(range) || typeof range.fromPage !== 'number' || typeof range.toPage !== 'number') return null;
  if (typeof pageCount !== 'number' || !Number.isSafeInteger(pageCount)) return null;
  if (!isRecord(stats)) return null;
  const counts = stats as Record<string, unknown>;
  if (typeof counts.lessons !== 'number' || typeof counts.dialogues !== 'number' || typeof counts.chunks !== 'number') {
    return null;
  }
  return {
    documentId,
    lessonId,
    lessonTitle,
    range: { fromPage: range.fromPage, toPage: range.toPage },
    pageCount,
    stats: { lessons: counts.lessons, dialogues: counts.dialogues, chunks: counts.chunks },
  };
}

export const TOC_LESSON_IMPORT_MAX_PAGES = 30;

export type LessonImportDecision =
  | { ok: true; lesson: PreviewLessonData; chunk: PreviewChunkData }
  | { ok: false; message: string };

/**
 * 单课试导入守门（纯函数）：P5-D1 七门 gate 的客户端可判子集
 *（指纹一致性由服务端终审；此处只判形状与范围）。
 * ok:false 时调用方不得显示导入按钮 / 不得发请求。
 */
export function decideLessonImport(
  preview: PreviewResponseData | null,
  previewValid: boolean,
  lessonIndex: number
): LessonImportDecision {
  if (!preview || !previewValid) {
    return { ok: false, message: '请先请求有效的分段预览' };
  }
  if (!preview.fingerprint) {
    return { ok: false, message: '预览指纹缺失，请重新请求分段预览' };
  }
  if (preview.diagnostics.unresolvedCount !== 0) {
    return { ok: false, message: '当前目录不能自动导入；请补充或修正 anchor' };
  }
  if (preview.diagnostics.lessonsWithoutEnd !== 0) {
    return { ok: false, message: '存在没有终点的课，不能确定导入范围' };
  }
  const lesson = preview.lessons.find((l) => l.lessonIndex === lessonIndex);
  if (!lesson) {
    return { ok: false, message: '所选条目不存在或不是可导入课' };
  }
  if (lesson.status !== 'mapped' || lesson.physicalStart === null || lesson.physicalEnd === null) {
    return { ok: false, message: '所选课尚未映射到确定物理范围' };
  }
  const pages = lesson.physicalEnd - lesson.physicalStart + 1;
  if (pages < 1 || pages > TOC_LESSON_IMPORT_MAX_PAGES) {
    return { ok: false, message: `该课共 ${pages} 页（单次导入上限 ${TOC_LESSON_IMPORT_MAX_PAGES} 页）` };
  }
  const chunks = preview.chunks.filter((c) => c.lessonIndex === lesson.lessonIndex);
  const only = chunks[0];
  if (chunks.length !== 1 || !only || only.physicalFrom !== lesson.physicalStart || only.physicalTo !== lesson.physicalEnd) {
    return { ok: false, message: '所选课不是一个完整 chunk，不能导入' };
  }
  return { ok: true, lesson, chunk: only };
}
