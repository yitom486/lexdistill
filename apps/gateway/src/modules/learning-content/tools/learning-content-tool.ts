import {
  type ToolDefinition,
  type ToolExecutionContext,
  ToolPermissions,
  ToolLocations,
} from '@lexdistill/tool-core';
import type { LearnerRepository } from '@lexdistill/learner-core';
import { err, type Result, BusinessError } from '@lexdistill/shared';
import { LearningContentInputSchema, type LearningContentInput, type LearningContentOutput } from '../contracts.js';
import { executeLearningContent } from '../application/execute-learning-content.js';
import { MSG } from '../application/actions/shared.js';
import type { LearningContentCommandRepository } from '../ports.js';

export { LearningContentInputSchema, type LearningContentInput, type LearningContentOutput } from '../contracts.js';
export { synthesizeContentInputForBlock } from '../application/actions/synthesize-content.js';

function supportsContentCommand(repo: LearnerRepository): repo is LearnerRepository & LearningContentCommandRepository {
  return 'listContentTemplates' in repo &&
    typeof repo.listContentTemplates === 'function' &&
    'getCurriculumKana' in repo &&
    typeof repo.getCurriculumKana === 'function' &&
    'getCurriculumHangul' in repo &&
    typeof repo.getCurriculumHangul === 'function' &&
    'sampleLocalDictionaryEntries' in repo &&
    typeof repo.sampleLocalDictionaryEntries === 'function';
}
/** Agent Tool adapter; the same domain command can be invoked from other entry points. */
export class LearningContentTool
  implements ToolDefinition<LearningContentInput, LearningContentOutput>
{
  public readonly name = 'learning.content';
  public readonly description = MSG.description;
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.READ;
  public readonly schema = LearningContentInputSchema;

  constructor(private readonly learnerRepo: LearnerRepository) {}

  public async execute(
    input: LearningContentInput,
    context: ToolExecutionContext
  ): Promise<Result<LearningContentOutput, BusinessError>> {
    if (!supportsContentCommand(this.learnerRepo)) {
      return err(new BusinessError(
        'E_TOOL_UNSUPPORTED',
        MSG.repoUnsupported,
        'TOOL_EXECUTION'
      ));
    }
    return executeLearningContent(this.learnerRepo, input, context);
  }
}
