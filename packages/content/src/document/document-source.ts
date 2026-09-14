/**
 * 文档导入源抽象（clean-room）。
 *
 * 上层（HTTP 路由 / Tool / 未来 WS 任务）只认 DocumentImporter：
 * 给定来源字节 → 产出 {title, markdown} → 统一走 markdownToAst + 入库 + 任务记录。
 * OCR/运行时是源之外的能力层（pdf-runtime），不在本抽象内——与词语链路无关。
 *
 * E2a 起家在 content/src/document（前身 gateway modules/library/...；逻辑不变）。
 */

export type { DocumentSourceKind } from './document-kinds.js';
export { DOCUMENT_SOURCE_KINDS } from './document-kinds.js';
import type { DocumentSourceKind } from './document-kinds.js';

export interface ExtractedText {  title: string;
  markdown: string;
  /** 目录单元标签（EPUB 目录驱动；无目录缺省） */
  units?: string[] | undefined;
}

export interface DocumentImporter {
  readonly kind: DocumentSourceKind;
  /** 来源 → 可结构化的 markdown（重活：解包/解码/抓取/清洗；抛 BusinessError 中文错）。 */
  extract: (input: ExtractorInput) => Promise<ExtractedText>;
}

export interface ExtractorInput {
  bytes?: Uint8Array | undefined;
  /** kind=url 时必填（经 SSRF 防护后抓取） */
  url?: string | undefined;
  filename: string;
}

/** 文件名推断来源（扩展名；URL 与猜不出的返回 undefined，不猜）。 */
export function guessSourceKind(filename: string): DocumentSourceKind | undefined {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.epub')) return 'epub';
  if (lower.endsWith('.mobi') || lower.endsWith('.azw')) return 'mobi';
  if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text';
  return undefined;
}
