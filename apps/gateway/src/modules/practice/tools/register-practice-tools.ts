import type { ToolRegistry } from '@study-studio/tool-core';
import type { LearnerRepository } from '@study-studio/learner-core';
import type { AgentAdapter } from '@study-studio/agent-runtime';
import { GenerateAdaptiveQuizTool } from './generate-adaptive-quiz.js';
import { GradeSubjectiveQuizTool } from './grade-subjective-quiz.js';
import { LearningAssessTool } from './learning-assess-tool.js';
import { LearningPracticeTool } from './learning-practice-tool.js';
import { SubmitExerciseGradeTool } from './submit-exercise-grade.js';

/**
 * E4b 练习域工具注册（纯组装）。
 * Registry 生命周期、fallback、adapter 由 Gateway 装配根（register-tools.ts）
 * 拥有并传入；本函数只 new 本域 tool，不创建 DB/Adapter/Registry。
 */
export function registerPracticeTools(
  registry: ToolRegistry,
  learnerRepo: LearnerRepository,
  adapter?: AgentAdapter | undefined
): void {
  registry.register(new GenerateAdaptiveQuizTool(learnerRepo));
  registry.register(new GradeSubjectiveQuizTool(learnerRepo));
  registry.register(new LearningAssessTool(learnerRepo, adapter));
  registry.register(new LearningPracticeTool(learnerRepo));
  registry.register(new SubmitExerciseGradeTool());
}
