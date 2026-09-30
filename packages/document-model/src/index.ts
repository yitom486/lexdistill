/**
 * M8-1 教材 AST 正典契约公共入口（自 protocol 迁入，行为不变）。
 * - 教材 AST schema、类型与安全解析；
 * - lesson.id 唯一性校验与 Result/BusinessError 信封。
 * 只依赖 shared 与 zod；不触 Gateway/learner/Agent/Web/SQLite/Drizzle。
 */
export * from './textbook.js';
export * from './lesson-content.js';
export * from './textbook-tasks.js';
export * from './import-monitor.js';
export * from './directory-content.js';
export * from './lesson-projection.js';
export * from './textbook-pipeline-settings.js';
export * from './toc.js';
