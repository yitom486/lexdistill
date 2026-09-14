/**
 * 文档来源种类（持久层定义；application 复用，避免持久层反向依赖上层）。
 */
export type DocumentSourceKind = 'pdf' | 'epub' | 'mobi' | 'text' | 'url';

export const DOCUMENT_SOURCE_KINDS: DocumentSourceKind[] = ['pdf', 'epub', 'mobi', 'text', 'url'];
