/**
 * M5.1 Content 领域包公共表面（白名单制）。
 * 首片仅含 `src/pdf`（PDF 摄取纯规则）；新增导出必须同步更新
 * `__tests__/public-surface.test.ts` 的锁定集合，防表面无声膨胀。
 */
export {
  extractHeadingsFromMarkdown,
  extractTocEntries,
} from './pdf/extract-headings.js';
export type {
  PageHeading,
  TocEntry,
} from './pdf/extract-headings.js';

export {
  detectDocScript,
  groundClassesByTitle,
  groupSectionsByClasses,
  groupSectionsByLesson,
  markdownToAst,
  newProvisionalBookId,
  promoteLessonHeadings,
  splitInlineChinese,
} from './pdf/markdown-to-ast.js';

export {
  buildOcrOverflowError,
  buildPdfConvertReport,
  buildPdfMapReport,
} from './pdf/pdf-import-report.js';
export type {
  PdfConvertReport,
  PdfOcrOverflowDetails,
} from './pdf/pdf-import-report.js';

export {
  MIN_SEMANTIC_RATIO,
  MIN_SEMANTIC_TITLES,
  classifyEmbeddedOutline,
  isSemanticOutlineTitle,
} from './pdf/embedded-outline-quality.js';
export type {
  EmbeddedOutlineEntry,
  EmbeddedOutlineInspector,
  EmbeddedOutlineQuality,
  EmbeddedOutlineQualityReason,
  EmbeddedOutlineQualityReport,
  EmbeddedOutlineSource,
  EmbeddedOutlineSourceItem,
} from './pdf/embedded-outline-quality.js';

export {
  layoutItemsToCandidates,
  mergeHeadingCandidates,
} from './pdf/layout-headings.js';
export type {
  LayoutHeadingsOptions,
  LayoutStructRole,
  LayoutTextItem,
} from './pdf/layout-headings.js';

export {
  FOLIO_CANDIDATE_MAX_PAGES,
  FOLIO_OCR_MIN_CONFIDENCE,
  detectFolioCandidates,
} from './pdf/toc-folio-candidates.js';
export type {
  FolioCandidate,
  FolioConfidence,
  FolioGeometryItem,
  FolioLocation,
  FolioNormalized,
  FolioSource,
} from './pdf/toc-folio-candidates.js';
