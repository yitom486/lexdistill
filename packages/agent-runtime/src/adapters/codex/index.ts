/**
 * C3 Codex 适配器收敛入口（外观，具名导出；实现已并入本目录）。
 *
 * 只收敛适配器本身（类 + 构造/会话选项类型 + 通知映射）；Codex 专有动态
 * 工具映射（toolsToDynamicSpecs / sanitizeToolName / resolveToolName /
 * zodToJsonSchema / DynamicToolsBridge）不得出现在此，更不得上浮到
 * agent-runtime 根入口——它们仍留在本目录的 tools-bridge 内。
 * 领域与网关业务代码不得绕过本入口深路径 import 适配器内部文件。
 */
export {
  CodexAdapter,
  CodexSession,
  buildLearnerContextEntry,
} from './codex-adapter.js';
export type {
  CodexAdapterOptions,
  ExternalToolExecutor,
} from './codex-adapter.js';
export { mapAppServerNotificationToEvents } from './event-mapper.js';
export { resolveCodexBinary } from './app-server-protocol.js';
export { backgroundCodexArgs } from './windows-launch-policy.js';
