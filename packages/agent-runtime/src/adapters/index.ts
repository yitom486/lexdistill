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
