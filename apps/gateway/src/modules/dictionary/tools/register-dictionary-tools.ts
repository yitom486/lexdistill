import type { ToolRegistry } from '@study-studio/tool-core';
import type { LexiconRepository } from '../ports.js';
import { DictionaryLookupTool } from './dictionary-lookup-tool.js';
import { LearningEncountersTool } from './learning-encounters-tool.js';

/**
 * E4b 词典域工具注册（纯组装）。
 * Registry 生命周期与 fallback 由 Gateway 装配根拥有；`drizzle` 为装配根收窄后的
 * 仓储实例。
 */
export function registerDictionaryTools(
  registry: ToolRegistry,
  drizzle: LexiconRepository
): void {
  registry.register(new DictionaryLookupTool(drizzle));
  registry.register(new LearningEncountersTool(drizzle));
}
