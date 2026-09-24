/** Public API for Gateway modules that consume learning-content capabilities. */
export {
  LearningContentInputSchema,
  type LearningContentInput,
  type LearningContentOutput,
} from './contracts.js';
export { executeLearningContent } from './application/execute-learning-content.js';
export { synthesizeContentInputForBlock } from './application/actions/synthesize-content.js';
export { LearningContentTool } from './tools/learning-content-tool.js';