import { ToolRegistry } from '@study-studio/tool-core';
import type { LearnerRepository } from '@study-studio/learner-core';
import type { AgentAdapter } from '@study-studio/agent-runtime';
import { DrizzleLearnerRepository } from '../../infrastructure/drizzle-learner-repository.js';
import { registerPracticeTools } from '../../modules/practice/tools/register-practice-tools.js';
import { registerLearningProgressTools } from '../../modules/learning-progress/tools/register-learning-progress-tools.js';
import { registerCurriculumTools } from '../../modules/curriculum/tools/register-curriculum-tools.js';
import { registerLibraryTools } from '../../modules/library/tools/register-library-tools.js';
import { registerDictionaryTools } from '../../modules/dictionary/tools/register-dictionary-tools.js';
import { registerVocabularyLearningTools } from '../../modules/vocabulary-learning/tools/vocabulary-learning-tools.js';
import { registerFlashcardsTools } from '../../modules/flashcards/tools/register-flashcards-tools.js';
import { LearningContentTool } from '../../modules/learning-content/public.js';
import { LearningPlanTool } from './learning-plan-tool.js';
import { UiNavigateTool, UiPresentTool } from './ui-command-tools.js';

/**
 * 网关 Tool 注册表装配（G3：由 GatewayServer 构造函数迁移而来，行为不变）。
 * 由装配根注入依赖；不在 Tool 内部创建第二个 DB。
 * 注意保留原有 fallback 语义：非 Drizzle 仓储时课程/词典/文库工具使用内存库。
 *
 * E4b：各域工具构造下沉到 `register<Domain>Tools`（纯组装，不碰 Registry
 * 生命周期/fallback/adapter）；本函数保留 fallback 计算、adapter 注入与调用顺序。
 * 注册顺序保持 learning.content 先于 mistakes.list（turn-tools 相对断言）。
 */
export function registerGatewayTools(
  registry: ToolRegistry,
  learnerRepo: LearnerRepository,
  /** P6-3：模型适配器（AgentAdapter 接口）；缺省时 learning.assess 的 ai 模式自动回退规则 */
  adapter?: AgentAdapter | undefined
): void {
  const drizzle =
    learnerRepo instanceof DrizzleLearnerRepository
      ? learnerRepo
      : new DrizzleLearnerRepository(':memory:');

  registerPracticeTools(registry, learnerRepo, adapter);
  registry.register(new LearningContentTool(learnerRepo));
  registerLearningProgressTools(registry, learnerRepo, drizzle);
  registry.register(new LearningPlanTool(learnerRepo));
  registerCurriculumTools(registry, drizzle);
  registerLibraryTools(registry, drizzle);
  registerDictionaryTools(registry, drizzle);
  registerVocabularyLearningTools(registry, drizzle);
  registerFlashcardsTools(registry, drizzle);
  registry.register(new UiNavigateTool());
  registry.register(new UiPresentTool());
}
