import type { ToolRegistry } from '@study-studio/tool-core';
import type { ContentRepository } from '../ports.js';
import { LearningLibraryTool } from './learning-library-tool.js';
import { LibraryImportTool } from './library-import-tool.js';
import { LibraryKnowledgeSaveTool } from './library-knowledge-tool.js';

/**
 * E4b 文库域工具注册（纯组装）。
 * Registry 生命周期与 fallback 由 Gateway 装配根拥有；`drizzle` 为装配根收窄后的
 * 仓储实例。
 */
export function registerLibraryTools(
  registry: ToolRegistry,
  drizzle: ContentRepository
): void {
  registry.register(new LearningLibraryTool(drizzle));
  registry.register(new LibraryImportTool(drizzle));
  registry.register(new LibraryKnowledgeSaveTool(drizzle));
}
