/**
 * M7-8 AI 内容确定性规则公共入口（自 Gateway 学习分析迁入，行为不变）。
 * - 学习快照纯数据类型；
 * - 模型 JSON 宽容解析；
 * - 本地规则回退报告（确定性，时间戳由调用方传入，本包不读当前时间）。
 * provider-neutral：不依赖 AgentAdapter、Gateway、SQLite、Web 或具体模型 SDK。
 */
export * from './analysis-rules.js';
export * from './analysis-generate.js';
