import { ToolRegistry } from '@study-studio/tool-core';
import type { LearnerRepository } from '@study-studio/learner-core';
import type { AgentAdapter } from '@study-studio/agent-core';
import { DrizzleLearnerRepository } from '../../infrastructure/drizzle-learner-repository.js';
import { GenerateAdaptiveQuizTool } from '../../modules/practice/tools/generate-adaptive-quiz.js';
import { GradeSubjectiveQuizTool } from '../../modules/practice/tools/grade-subjective-quiz.js';
import { LearningAssessTool } from '../../modules/practice/tools/learning-assess-tool.js';
import { LearningPracticeTool } from '../../modules/practice/tools/learning-practice-tool.js';
import { LearningProgressTool } from '../../modules/learning-progress/tools/learning-progress-tool.js';
import { MistakesListTool } from '../../modules/learning-progress/tools/mistakes-list-tool.js';
import { MistakesResolveTool } from '../../modules/learning-progress/tools/mistakes-resolve-tool.js';
import { LearningCurriculumTool } from '../../modules/curriculum/tools/learning-curriculum-tool.js';
import { LearningLibraryTool } from '../../modules/library/tools/learning-library-tool.js';
import { LibraryImportTool } from '../../modules/library/tools/library-import-tool.js';
import { DictionaryLookupTool } from '../../modules/dictionary/tools/dictionary-lookup-tool.js';
import { LearningEncountersTool } from '../../modules/dictionary/tools/learning-encounters-tool.js';
import { FlashcardsRenderTool } from '../../modules/flashcards/tools/flashcards-render-tool.js';
import { FlashcardsDueTool } from '../../modules/flashcards/tools/flashcards-due-tool.js';
import { FlashcardsCollectTool } from '../../modules/flashcards/tools/flashcards-collect-tool.js';
import { FlashcardsAnkiPushTool } from '../../modules/flashcards/tools/flashcards-anki-push-tool.js';
import { FlashcardsApkgAnalyzeTool } from '../../modules/flashcards/tools/flashcards-apkg-analyze-tool.js';
import {
  FlashcardsDraftProposeTool,
  FlashcardsDraftsListTool,
  FlashcardsDraftAcceptTool,
  FlashcardsDraftDismissTool,
} from '../../modules/flashcards/tools/flashcards-draft-tools.js';
import { LearningContentTool } from './learning-content-tool.js';
import { LearningPlanTool } from './learning-plan-tool.js';
import { UiNavigateTool, UiPresentTool } from './ui-command-tools.js';

/**
 * 网关 Tool 注册表装配（G3：由 GatewayServer 构造函数迁移而来，行为不变）。
 * 由装配根注入依赖；不在 Tool 内部创建第二个 DB。
 * 注意保留原有 fallback 语义：非 Drizzle 仓储时课程/词典/文库工具使用内存库。
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

  registry.register(new GenerateAdaptiveQuizTool(learnerRepo));
  registry.register(new GradeSubjectiveQuizTool(learnerRepo));
  registry.register(new LearningContentTool(learnerRepo));
  registry.register(new LearningAssessTool(learnerRepo, adapter));
  registry.register(new LearningProgressTool(learnerRepo));
  registry.register(new MistakesListTool(drizzle));
  registry.register(new MistakesResolveTool(drizzle));
  registry.register(new LearningPlanTool(learnerRepo));
  registry.register(new LearningPracticeTool(learnerRepo));
  registry.register(new LearningCurriculumTool(drizzle));
  registry.register(new LearningLibraryTool(drizzle));
  registry.register(new LibraryImportTool(drizzle));
  registry.register(new DictionaryLookupTool(drizzle));
  registry.register(new LearningEncountersTool(drizzle));
  registry.register(new FlashcardsRenderTool(drizzle));
  registry.register(new FlashcardsDueTool(drizzle));
  registry.register(new FlashcardsCollectTool(drizzle));
  registry.register(new FlashcardsAnkiPushTool(drizzle));
  registry.register(new FlashcardsApkgAnalyzeTool());
  registry.register(new FlashcardsDraftProposeTool(drizzle));
  registry.register(new FlashcardsDraftsListTool(drizzle));
  registry.register(new FlashcardsDraftAcceptTool(drizzle));
  registry.register(new FlashcardsDraftDismissTool(drizzle));
  registry.register(new UiNavigateTool());
  registry.register(new UiPresentTool());
}
