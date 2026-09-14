import type { ToolRegistry } from '@study-studio/tool-core';
import type { ContentRepository } from '../../library/ports.js';
import { LearningCurriculumTool } from './learning-curriculum-tool.js';

/**
 * E4b 课程域工具注册（纯组装）。
 * Registry 生命周期与 fallback 由 Gateway 装配根拥有；`drizzle` 为装配根收窄后的
 * 仓储实例。跨模块类型引用（library/ports）已在 module-boundaries allowlist 登记。
 */
export function registerCurriculumTools(
  registry: ToolRegistry,
  drizzle: ContentRepository
): void {
  registry.register(new LearningCurriculumTool(drizzle));
}
