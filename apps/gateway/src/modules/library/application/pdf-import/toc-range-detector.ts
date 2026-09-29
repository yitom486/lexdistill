import { extractTocEntries } from '@study-studio/content';
import type { EmbeddedOutlineItem } from '../../../../infrastructure/pdf-runtime/pdf-runtime.js';

export interface TocPageCandidate {
  page: number;
  text: string;
}

export interface TocDiscoveryCandidate {
  fromPage: number;
  toPage: number;
  score: number;
  reasons: string[];
}

export interface DetectedTocRangeResult {
  startPage: number;
  endPage: number;
  confidence: number;
  reason: string;
  candidates: TocDiscoveryCandidate[];
}

export const TOC_DISCOVERY_SCORE = {
  TITLE: 6,
  LESSON_TOKEN: 4,
  LESSON_CAP: 10,
  DOT_LEADER: 3,
  DOT_CAP: 12,
  TRAILING_PAGE: 2,
  TRAILING_CAP: 15,
  PARSED_ENTRIES: 5,
  PARSED_CAP: 10,
  EXERCISE: -3,
  EXERCISE_CAP: 5,
  CANDIDATE: 8,
} as const;

export const TOC_TITLE_RE = /(目\s*次|も\s*く\s*じ|目\s*录|目\s*録|CONTENTS|TABLE\s+OF\s+CONTENTS|モ\s*ク\s*ジ|INDEX)/i;
export const LESSON_TOKEN_RE = /(第\s*\d+\s*[課课]|復習\s*[A-Z0-9]?|LESSON\s*\d+|UNIT\s*\d+|第\s*\d+\s*章)/i;
export const DOT_LEADER_RE = /…{2,}|(\.\s?){3,}|・{2,}|．{2,}|_{3,}|-{3,}/;
export const TRAILING_PAGE_RE = /^(.*\S)\s+(\d{1,4})$/;
export const EXERCISE_RE = /^(問|问)\s*\d+|^Q\s*\d+[\.\)]?|^(練習|练习|EXERCISE)\s*\d+/i;

export interface TocPageFeatures {
  hasTocTitle: boolean;
  lessonTokenLines: number;
  dotLeaderLines: number;
  trailingPageLines: number;
  parsedEntryCount: number;
  exerciseLines: number;
}

export function extractTocPageFeatures(markdown: string): TocPageFeatures {
  const features: TocPageFeatures = {
    hasTocTitle: false,
    lessonTokenLines: 0,
    dotLeaderLines: 0,
    trailingPageLines: 0,
    parsedEntryCount: 0,
    exerciseLines: 0,
  };
  const lines = markdown.split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!features.hasTocTitle && TOC_TITLE_RE.test(line)) features.hasTocTitle = true;
    if (LESSON_TOKEN_RE.test(line)) features.lessonTokenLines++;
    if (DOT_LEADER_RE.test(line)) features.dotLeaderLines++;
    if (TRAILING_PAGE_RE.test(line)) features.trailingPageLines++;
    if (EXERCISE_RE.test(line)) features.exerciseLines++;
  }
  const parsed = extractTocEntries(markdown);
  features.parsedEntryCount = parsed.length;
  return features;
}

export function scoreTocPageFeatures(features: TocPageFeatures): number {
  const w = TOC_DISCOVERY_SCORE;
  return (
    (features.hasTocTitle ? w.TITLE : 0) +
    w.LESSON_TOKEN * Math.min(features.lessonTokenLines, w.LESSON_CAP) +
    w.DOT_LEADER * Math.min(features.dotLeaderLines, w.DOT_CAP) +
    w.TRAILING_PAGE * Math.min(features.trailingPageLines, w.TRAILING_CAP) +
    w.PARSED_ENTRIES * Math.min(features.parsedEntryCount, w.PARSED_CAP) +
    w.EXERCISE * Math.min(features.exerciseLines, w.EXERCISE_CAP)
  );
}

export interface TocScoredPage {
  page: number;
  score: number;
  candidate: boolean;
  reasons: string[];
}

export function scoreTocDiscoveryPage(page: number, markdown: string): TocScoredPage {
  const features = extractTocPageFeatures(markdown);
  const score = scoreTocPageFeatures(features);
  const reasons: string[] = [];
  if (features.hasTocTitle) reasons.push('包含目录标题');
  if (features.lessonTokenLines > 0) reasons.push(`发现 ${features.lessonTokenLines} 处课次序号`);
  if (features.dotLeaderLines > 0) reasons.push(`发现 ${features.dotLeaderLines} 处点线引导符`);
  if (features.parsedEntryCount > 0) reasons.push(`提取出 ${features.parsedEntryCount} 条成形条目`);

  const hasAnchor = features.hasTocTitle || features.lessonTokenLines > 0 || features.parsedEntryCount > 0;
  return { page, score, candidate: hasAnchor && score >= TOC_DISCOVERY_SCORE.CANDIDATE, reasons };
}

export function mergeTocCandidateRanges(pages: TocScoredPage[]): TocDiscoveryCandidate[] {
  const ordered = pages
    .filter((p) => p.candidate)
    .slice()
    .sort((a, b) => a.page - b.page);
  const ranges: TocDiscoveryCandidate[] = [];
  for (const item of ordered) {
    const last = ranges[ranges.length - 1];
    if (last && item.page === last.toPage + 1) {
      last.toPage = item.page;
      last.score = Math.max(last.score, item.score);
      for (const r of item.reasons) {
        if (!last.reasons.includes(r)) last.reasons.push(r);
      }
    } else {
      ranges.push({ fromPage: item.page, toPage: item.page, score: item.score, reasons: [...item.reasons] });
    }
  }
  return ranges.sort((a, b) => b.score - a.score);
}

export function detectTocPageRange(
  pages: TocPageCandidate[],
  embeddedOutline?: EmbeddedOutlineItem[]
): DetectedTocRangeResult | null {
  const candidateRanges: TocDiscoveryCandidate[] = [];

  // 1. 遍历前 35 页进行逐页多维特征评分（高密度课次、点线页码对、目次标题、成形条目）
  if (pages && pages.length > 0) {
    const candidatesPages = pages.filter((p) => p.page <= 35);
    const scored = candidatesPages.map((p) => scoreTocDiscoveryPage(p.page, p.text));
    const textRanges = mergeTocCandidateRanges(scored);
    candidateRanges.push(...textRanges);
  }

  // 2. 结合 PDF 内置书签大纲：
  // 查找是否有「目次/目录/Contents」等书签；若有，通过下一个有效书签界定目录真实起止区间
  if (embeddedOutline && embeddedOutline.length > 0) {
    const bookmarkIdx = embeddedOutline.findIndex((item) =>
      TOC_TITLE_RE.test(item.title.trim())
    );
    if (bookmarkIdx >= 0) {
      const hit = embeddedOutline[bookmarkIdx]!;
      if (typeof hit.physicalPage === 'number' && hit.physicalPage >= 1) {
        const startP = hit.physicalPage;
        let endP = startP + 1;
        for (let i = bookmarkIdx + 1; i < embeddedOutline.length; i++) {
          const next = embeddedOutline[i]!;
          if (typeof next.physicalPage === 'number' && next.physicalPage > startP) {
            endP = Math.max(startP, next.physicalPage - 1);
            break;
          }
        }
        // 如果文本打分中已经探测到了该起始页附近的区间，进行精准强化合并
        const matchingTextRange = candidateRanges.find(
          (r) => Math.abs(r.fromPage - startP) <= 1
        );
        if (matchingTextRange) {
          matchingTextRange.score += 50;
          matchingTextRange.fromPage = Math.min(startP, matchingTextRange.fromPage);
          matchingTextRange.reasons.unshift(`命中 PDF 书签「${hit.title.trim()}」（物理页 ${startP}）`);
        } else {
          candidateRanges.push({
            fromPage: startP,
            toPage: Math.max(startP, Math.min(startP + 1, endP)),
            score: 80,
            reasons: [`命中 PDF 书签「${hit.title.trim()}」（物理页 ${startP}）`],
          });
        }
      }
    }
  }

  // 按得分由高到低排序所有候选区间
  candidateRanges.sort((a, b) => b.score - a.score);

  if (candidateRanges.length === 0) {
    return null;
  }

  const best = candidateRanges[0]!;
  return {
    startPage: best.fromPage,
    endPage: best.toPage,
    confidence: Math.min(best.score / 50, 0.95),
    reason: best.reasons.slice(0, 3).join('、') || '识别出目录结构特征',
    candidates: candidateRanges,
  };
}
