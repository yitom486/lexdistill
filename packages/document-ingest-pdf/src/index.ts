/**
 * M8-3 纯 PDF 文档摄取规则公共入口（自 Gateway 迁入，行为不变）。
 * - 目录/标题抽取（extract-headings）；
 * - Markdown → TextbookAST 初版结构化（markdown-to-ast，含 ID 生成口径）。
 * 纯解析层：不依赖 Gateway、SQLite/Drizzle、learner-core、Agent、Web、
 * 网络或 PDF runtime。
 */
export * from './extract-headings.js';
export * from './markdown-to-ast.js';
