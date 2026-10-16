import type { ToolRegistry } from '@lexdistill/tool-core';
import type { LearnerRepository } from '@lexdistill/learner-core';
import type { LearningRepository } from '../../practice/ports.js';
import { LearningProgressTool } from './learning-progress-tool.js';
import { MistakesListTool } from './mistakes-list-tool.js';
import { MistakesResolveTool } from './mistakes-resolve-tool.js';

/**
 * E4b 学习进度域工具注册（纯组装）。
 * Registry 生命周期与 fallback 由 Gateway 装配根拥有；`drizzle` 为装配根收窄后的
 * 仓储实例（同时满足 LearningRepository 与 LearnerRepository）。
 * 跨模块类型引用（practice/ports）已在 module-boundaries allowlist 登记。
 */
export function registerLearningProgressTools(
  registry: ToolRegistry,
  learnerRepo: LearnerRepository,
  drizzle: LearningRepository & LearnerRepository
): void {
  registry.register(new LearningProgressTool(learnerRepo));
  registry.register(new MistakesListTool(drizzle));
  registry.register(new MistakesResolveTool(drizzle));
}
