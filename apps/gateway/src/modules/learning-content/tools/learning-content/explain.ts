import { err, isOk, ok, type Result, BusinessError } from '@study-studio/shared';
import type { LearningContentRepository } from '../../ports.js';
import type { LearningContentInput, LearningContentOutput } from '../learning-content-tool.js';
import { MSG, loadTemplates } from './shared.js';

export async function handleExampleSetAction(
  repo: LearningContentRepository,
  input: LearningContentInput,
  language: 'ja' | 'en' | 'ko'
): Promise<Result<LearningContentOutput, BusinessError>> {
  const topic = input.topic;
  const skillId = input.skillIds?.[0];
  const templates = await loadTemplates(repo, {
    action: 'example_set',
    language,
    skillId,
  });
  if (!isOk(templates)) return templates;
  const row = templates.value[0];
  if (!row) {
    return err(new BusinessError('E_CONTENT_EMPTY', MSG.emptyExamples(language), 'TOOL_EXECUTION'));
  }
  const targetTopic = topic || row.topic || MSG.coreTopic;
  const examples = (row.payload as { examples: LearningContentOutput['examples'] }).examples;
  return ok({
    action: input.action,
    language,
    summary: MSG.examplesSummary(targetTopic),
    examples,
  });
}

export async function handleExplainAction(
  repo: LearningContentRepository,
  input: LearningContentInput,
  language: 'ja' | 'en' | 'ko'
): Promise<Result<LearningContentOutput, BusinessError>> {
  const topic = input.topic;
  const skillId = input.skillIds?.[0];
  const templates = await loadTemplates(repo, {
    action: 'explain',
    language,
    skillId,
  });
  if (!isOk(templates)) return templates;
  const row = templates.value[0];
  if (!row) {
    return err(new BusinessError('E_CONTENT_EMPTY', MSG.emptyExplain(language), 'TOOL_EXECUTION'));
  }
  const targetTopic = topic || row.topic || MSG.coreTopic;
  const explanation = (
    row.payload as { explanation: LearningContentOutput['explanation'] }
  ).explanation;
  return ok({
    action: input.action,
    language,
    summary: MSG.explainSummary(targetTopic),
    explanation,
  });
}
