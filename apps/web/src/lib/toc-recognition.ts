import type { MapPdfResult } from '../queries/useLearnerQueries.js';
import { buildPreviewEntries } from './toc-anchor-flow.js';
import type { EditableTocEntry } from './toc-confirm-flow.js';
import { planTextbookTasks, type TocEntry, type TocLevel } from '@study-studio/document-model';

export interface TocRecognitionCandidate extends EditableTocEntry {
  /** 目录层级深度：1=一级(如单元), 2=二级(如课或单元末), 3=三级(如课内小节) */
  level: number;
  /** 保留目录语义；编辑表格的缩进按真实层级计算。 */
  directoryLevel?: TocLevel;
  /** PDF bookmarks identify physical pages, never printed pages. */
  physicalPage?: number;
  endPage?: number;
  parentId?: string;
}

const LESSON_TITLE = /第\s*[0-9０-９一二三四五六七八九十百]+\s*[課课]|\b(?:lesson|unit)\s*\d+\b/i;

/** 缩进按真实父子关系链计算深度，语义类型完整保留；印刷页与物理页由调用方明确选择。 */
export function tocCandidatesFromEntries(entries: readonly TocEntry[], pages: 'printed' | 'physical'): TocRecognitionCandidate[] {
  const entryMap = new Map(entries.map(e => [e.id, e]));
  const getDepth = (id?: string): number => {
    let depth = 1;
    let curr = id ? entryMap.get(id) : undefined;
    const visited = new Set<string>();
    while (curr && !visited.has(curr.id)) {
      visited.add(curr.id);
      depth++;
      curr = curr.parentId ? entryMap.get(curr.parentId) : undefined;
    }
    return depth;
  };

  return entries.map(entry => ({
    key: entry.id, title: entry.title, printedPage: pages === 'printed' ? String(entry.startPage) : '',
    level: getDepth(entry.parentId), kind: entry.level === 'lesson' ? 'lesson' : 'section',
    directoryLevel: entry.level, confidence: null,
    ...(pages === 'physical' ? { physicalPage: entry.startPage } : {}),
    ...(entry.endPage !== undefined ? { endPage: entry.endPage } : {}),
    ...(entry.parentId ? { parentId: entry.parentId } : {}),
  }));
}

/** 修改条目的教材语义类型（unit / lesson / section），自动维护父子关系与缩进深度。 */
export function changeTocCandidateType(
  entries: readonly TocRecognitionCandidate[],
  key: string,
  type: 'unit' | 'chapter' | 'lesson' | 'section'
): TocRecognitionCandidate[] {
  const index = entries.findIndex(entry => entry.key === key);
  if (index === -1) return [...entries];

  const prevItems = entries.slice(0, index).reverse();

  if (type === 'unit') {
    return entries.map(entry => {
      if (entry.key !== key) return entry;
      const { parentId: _parentId, ...rest } = entry;
      return {
        ...rest,
        level: 1,
        kind: 'section' as const,
        directoryLevel: 'unit' as const,
      };
    });
  }

  if (type === 'lesson') {
    const parentUnit = prevItems.find(item => item.directoryLevel === 'unit');
    return entries.map(entry => {
      if (entry.key !== key) return entry;
      const { parentId: _parentId, ...rest } = entry;
      return {
        ...rest,
        level: parentUnit ? 2 : 1,
        kind: 'lesson' as const,
        directoryLevel: 'lesson' as const,
        ...(parentUnit ? { parentId: parentUnit.key } : {}),
      };
    });
  }

  // type === 'section' or 'chapter'
  const parentLesson = prevItems.find(item => item.directoryLevel === 'lesson' || item.kind === 'lesson');
  const parentUnit = prevItems.find(item => item.directoryLevel === 'unit');
  const parent = parentLesson ?? parentUnit;

  return entries.map(entry => {
    if (entry.key !== key) return entry;
    const depth = parentLesson ? 3 : parentUnit ? 2 : 1;
    const { parentId: _parentId, ...rest } = entry;
    return {
      ...rest,
      level: depth,
      kind: 'section' as const,
      directoryLevel: type,
      ...(parent ? { parentId: parent.key } : {}),
    };
  });
}

/** 编辑缩进时同步修改父节点，支持真实层级链（一级/二级/三级）。 */
export function changeTocCandidateLevel(entries: readonly TocRecognitionCandidate[], key: string, level: number): TocRecognitionCandidate[] {
  const index = entries.findIndex(entry => entry.key === key);
  if (index === -1) return [...entries];

  if (level <= 1) {
    return entries.map(entry => {
      if (entry.key !== key) return entry;
      const { parentId: _parentId, ...rest } = entry;
      return { ...rest, level: 1 };
    });
  }

  const prevItems = entries.slice(0, index).reverse();
  const parent = prevItems.find(item => item.level === level - 1);
  if (!parent) return [...entries];

  return entries.map(entry => {
    if (entry.key !== key) return entry;
    return { ...entry, level, parentId: parent.key };
  });
}

/** Reject oversized windows before map-pdf can silently clamp them to 30 pages. */
export function parseTocScanRange(start: string, end: string):
  | { ok: true; startPage?: number; endPage?: number }
  | { ok: false; message: string } {
  if (!start.trim() && !end.trim()) return { ok: true };
  if (!/^\d+$/.test(start.trim()) || !/^\d+$/.test(end.trim())) {
    return { ok: false, message: '请同时填写目录页的起止 PDF 页码，或两项都留空以预览前 30 页' };
  }
  const startPage = Number(start);
  const endPage = Number(end);
  if (!Number.isSafeInteger(startPage) || !Number.isSafeInteger(endPage) || startPage < 1 || endPage < startPage) {
    return { ok: false, message: '目录页范围必须是递增的正整数' };
  }
  if (endPage - startPage + 1 > 30) {
    return { ok: false, message: '一次最多识别 30 页目录，请缩小范围' };
  }
  return { ok: true, startPage, endPage };
}

function titleWithoutPrintedPage(label: string, printedPage: number): string {
  const withoutLeadingPage = label.replace(/^\s*\d{1,4}\s+(?=第\s*[0-9０-９一二三四五六七八九十百]+\s*[課课])/, '').trim();
  const pageText = String(printedPage);
  return (withoutLeadingPage.endsWith(pageText)
    ? withoutLeadingPage.slice(0, -pageText.length).replace(/[\s.…·．]+$/, '')
    : withoutLeadingPage).trim();
}

/** 将原生扫描或内嵌目录映射为候选条目。 */
export function tocCandidatesFromMap(result: MapPdfResult): TocRecognitionCandidate[] {
  if (result.outlineSource === 'embedded' && result.embeddedOutline?.length) {
    return result.embeddedOutline.map((entry, index) => ({
      key: `embedded-${index}`,
      title: entry.title.trim(),
      printedPage: '',
      level: entry.level <= 1 ? 1 : Math.min(entry.level, 3),
      kind: LESSON_TITLE.test(entry.title) ? 'lesson' : 'section',
      confidence: null,
      physicalPage: entry.physicalPage,
    }));
  }
  return result.tocEntries.map((entry, index) => {
    const title = titleWithoutPrintedPage(entry.label, entry.printedPage);
    return {
      key: `toc-${index}`,
      title,
      printedPage: String(entry.printedPage),
      level: 1,
      kind: LESSON_TITLE.test(title) ? 'lesson' : 'section',
      confidence: null,
    };
  });
}

/** The confirmation button shares the downstream numeric and nonempty guards. */
export function validateTocCandidates(entries: TocRecognitionCandidate[]): string | null {
  const built = buildPreviewEntries(entries);
  if (!built.ok) return built.message;
  const planned = planTextbookTasks(entries.map(entry => ({ id: entry.key, level: entry.directoryLevel ?? entry.kind, ...(entry.parentId ? { parentId: entry.parentId } : {}) })));
  if (!planned.ok) return planned.error.userMessage;
  let lastPage = 0;
  for (const entry of built.entries) {
    if (entry.printedPage < lastPage) return '印刷页码不能倒退，请核对目录顺序';
    lastPage = entry.printedPage;
  }
  return null;
}
