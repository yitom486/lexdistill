/**
 * Content `document` 子入口（Node-only）。
 *
 * 完整文档域表面（含需 Node 全局能力的 EPUB 解析）；浏览器安全根表面见
 * `../public.ts`（纯可移植子集：kinds/source/mobi/text），禁把 epub 符号上浮到根。
 * E2b 起含 `epub-reader`（前身 gateway modules/library/...；逻辑不变）。
 */
export { DOCUMENT_SOURCE_KINDS } from './document-kinds.js';
export type { DocumentSourceKind } from './document-kinds.js';
export {
  guessSourceKind,
  type DocumentImporter,
  type ExtractedText,
  type ExtractorInput,
} from './document-source.js';
export { extractMobiText } from './mobi-reader.js';
export { decodeTextBytes } from './text-reader.js';
export {
  extractEpubText,
  xhtmlToMarkdown,
  parseNcxToc,
  parseNavToc,
  type EpubTocItem,
} from './epub-reader.js';
