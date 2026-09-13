/**
 * M2-1 Codex 适配器收敛入口（外观，具名导出）。
 *
 * 只收敛适配器本身（类 + 构造/会话选项类型）；Codex 专有动态工具映射
 *（toolsToDynamicSpecs / sanitizeToolName / resolveToolName /
 * zodToJsonSchema / DynamicToolsBridge）不得出现在此，更不得上浮到
 * agent-runtime 根入口——它们仍在 `@study-studio/agent-codex` 包内。
 * 领域与网关业务代码不得绕过本入口深路径 import 适配器内部文件。
 */
export {
  CodexAdapter,
  CodexSession,
  buildLearnerContextEntry,
} from '@study-studio/agent-codex';
export type {
  CodexAdapterOptions,
  ExternalToolExecutor,
} from '@study-studio/agent-codex';
