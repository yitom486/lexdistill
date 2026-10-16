/**
 * M1-2 学习（learning）领域共享表面（暂宿 learning-progress，M6 合并时迁移）。
 *
 * practice / review 跨模块消费 learning-progress 的共享能力只许走本文件
 *（R5 allowlist 登记到 public.js，不再登记深路径）；本文件只转出已查证符号，
 * 不搬业务实现。学习域仓储契约见 `modules/practice/ports.ts`（LearningRepository）。
 */
export { resolveActiveLanguage } from '@lexdistill/storage-sqlite';
export { buildAnalysisSnapshot, type AnalysisSnapshot } from './application/learning-analysis.js';
export { setTrackLevel } from './persistence/level.js';
export {
  handleProfileGet,
  handleProfileUpdate,
  handleTaskActivityRecord,
  handleTaskProgressGet,
} from './websocket/learner-handlers.js';
export type {
  LearningProgressWebSocketDependencies,
  LearningProgressWebSocketRepository,
} from './websocket/learner-handlers.js';
