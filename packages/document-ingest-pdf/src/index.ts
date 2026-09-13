/**
 * M8-3/M8-4/M8-5/M8-6 纯 PDF 文档摄取规则公共入口（自 Gateway 迁入，行为不变）。
 * - 目录/标题抽取（extract-headings）；
 * - Markdown → TextbookAST 初版结构化（markdown-to-ast，含 ID 生成口径）；
 * - PDF 导入报告纯规则（pdf-import-report：convert/map 摘要与 OCR 超限引导）；
 * - 内嵌目录质量门（embedded-outline-quality：none/usable/unusable 三态判定）；
 * - 版式标题候选纯规则（layout-headings：条目聚行 → 候选 → 正则/版式合并）。
 * 纯解析层：不依赖 Gateway、SQLite/Drizzle、learner-core、Agent、Web、
 * 网络或 PDF runtime。
 */
export * from './extract-headings.js';
export * from './markdown-to-ast.js';
export * from './pdf-import-report.js';
export * from './embedded-outline-quality.js';
export * from './layout-headings.js';
