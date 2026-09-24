/**
 * M5.1 Content 领域包公共表面（白名单制）。
 * 首片仅含 `src/pdf`（PDF 摄取纯规则）；E2a 起含 `src/document`
 * （通用文档导入纯解析：来源抽象/种类、mobi/text 解码）；新增导出必须同步更新
 * `__tests__/public-surface.test.ts` 的锁定集合，防表面无声膨胀。
 */
export { DOCUMENT_SOURCE_KINDS } from './document/document-kinds.js';
export type { DocumentSourceKind } from './document/document-kinds.js';
export {
  guessSourceKind,
  type DocumentImporter,
  type ExtractedText,
  type ExtractorInput,
} from './document/document-source.js';
export { extractMobiText } from './document/mobi-reader.js';
export { decodeTextBytes } from './document/text-reader.js';
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
export {
  TOC_SEGMENT_CHUNK_PAGES,
  TOC_SEGMENT_MIN_ENTRIES,
  TOC_LEVEL_HINT,
  fingerprintTocPlan,
  previewTocSegments,
  validateTocEntries,
  sha256HexBytes,
  type TocEntryField,
  type TocEntryIssue,
  type TocLessonMappingReason,
  type TocLessonMappingStatus,
  type TocLessonSegment,
  type TocMappingRegion,
  type TocPlanFingerprintInput,
  type TocSegmentAnchor,
  type TocSegmentAnchorEvidence,
  type TocSegmentChunk,
  type TocSegmentDiagnostics,
  type TocSegmentPreviewInput,
  type TocSegmentPreviewOutput,
  type TocSegmentTocEntry,
} from './pdf/toc-segment-preview.js';
export type {
  FolioCandidate,
  FolioConfidence,
  FolioGeometryItem,
  FolioLocation,
  FolioNormalized,
  FolioSource,
} from './pdf/toc-folio-candidates.js';
