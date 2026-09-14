import type { ToolRegistry } from '@study-studio/tool-core';
import type { LearnerRepository } from '@study-studio/learner-core';
import type { LexiconRepository } from '../../dictionary/ports.js';
import type { FlashcardsRepository } from '../ports.js';
import { FlashcardsRenderTool } from './flashcards-render-tool.js';
import { FlashcardsDueTool } from './flashcards-due-tool.js';
import { FlashcardsCollectTool } from './flashcards-collect-tool.js';
import { FlashcardsAnkiPushTool } from './flashcards-anki-push-tool.js';
import { FlashcardsApkgAnalyzeTool } from './flashcards-apkg-analyze-tool.js';
import {
  FlashcardsDraftProposeTool,
  FlashcardsDraftsListTool,
  FlashcardsDraftAcceptTool,
  FlashcardsDraftDismissTool,
} from './flashcards-draft-tools.js';

/**
 * E4b 卡片域工具注册（纯组装）。
 * Registry 生命周期与 fallback 由 Gateway 装配根拥有；`drizzle` 为装配根收窄后的
 * 仓储实例（同时满足三契约；due/collect/render 等在旧注册链中同样接收该同一实例，
 * 语义不变——due 取 LearnerRepository 面，collect 取 LexiconRepository 面）。
 * 跨模块类型引用（dictionary/ports）已在 module-boundaries allowlist 登记。
 */
export function registerFlashcardsTools(
  registry: ToolRegistry,
  drizzle: FlashcardsRepository & LexiconRepository & LearnerRepository
): void {
  registry.register(new FlashcardsRenderTool(drizzle));
  registry.register(new FlashcardsDueTool(drizzle));
  registry.register(new FlashcardsCollectTool(drizzle));
  registry.register(new FlashcardsAnkiPushTool(drizzle));
  registry.register(new FlashcardsApkgAnalyzeTool());
  registry.register(new FlashcardsDraftProposeTool(drizzle));
  registry.register(new FlashcardsDraftsListTool(drizzle));
  registry.register(new FlashcardsDraftAcceptTool(drizzle));
  registry.register(new FlashcardsDraftDismissTool(drizzle));
}
