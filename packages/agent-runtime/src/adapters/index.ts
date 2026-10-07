/**
 * M2-1 适配器聚合出口（Codex / Responses；一律具名，禁 `export *`）。
 */
export {
  CodexAdapter,
  CodexSession,
  buildLearnerContextEntry,
  mapAppServerNotificationToEvents,
  resolveCodexBinary,
  backgroundCodexArgs,
} from './codex/index.js';
export type {
  CodexAdapterOptions,
  ExternalToolExecutor,
} from './codex/index.js';
export {
  ResponsesAdapter,
  ResponsesSession,
  buildLightweightReply,
} from './responses/index.js';
// Phase 1：ACP 适配器（网关按 runtime 选用；Approval/中断语义见文件头）。
export { AcpAdapter, AcpAgentSession } from './acp/acp-adapter.js';
export type { AcpAdapterOptions } from './acp/acp-adapter.js';
