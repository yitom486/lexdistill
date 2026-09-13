/**
 * C5 纯卡片模板与渲染核心公共入口（浏览器安全子入口，见包根注释）。
 * - 卡片模板、字段渲染、预览、校验、内置格式、字段映射推断；
 * - 假名声调阶梯图（SVG 纯字符串）。
 * 零依赖纯逻辑：不触 Gateway/SQLite/Agent/Web/网络。
 * 本子目录为公开的浏览器安全入口（Web 可直引，Vite 打包安全）。
 */
export * from './pitch-graph.js';
export * from './card-templates.js';
