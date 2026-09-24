import { err, isOk, ok, type Result, BusinessError } from '@study-studio/shared';
import type { LearningContentRepository } from '../../ports.js';
import type { LearningContentInput, LearningContentOutput, LearningContentContext } from '../../contracts.js';
import { MSG, applyPlaceholders, loadTemplates } from './shared.js';

export async function handlePassageAction(
  repo: LearningContentRepository,
  input: LearningContentInput,
  language: 'ja' | 'en' | 'ko'
): Promise<Result<LearningContentOutput, BusinessError>> {
  const topic = input.topic;
  const difficulty = input.difficulty ?? 2;
  const templates = await loadTemplates(repo, {
    action: 'generate_passage',
    language,
  });
  if (!isOk(templates)) return templates;
  const row = templates.value[0];
  if (!row) {
    return err(new BusinessError('E_CONTENT_EMPTY', MSG.emptyPassage(language), 'TOOL_EXECUTION'));
  }
  const topicLabel =
    topic || row.topic || (language === 'en' ? MSG.dailyEn : language === 'ko' ? '????' : MSG.dailyJa);
  const payload = row.payload as {
    titleTemplate: string;
    bodyTemplate: string;
  };
  return ok({
    action: input.action,
    language,
    summary: MSG.passageSummary(topicLabel),
    passage: {
      title: applyPlaceholders(payload.titleTemplate, {
        topic: topicLabel,
        difficulty,
      }),
      body: applyPlaceholders(payload.bodyTemplate, {
        topic: topicLabel,
        difficulty,
      }),
      topic: topicLabel,
    },
  });
}
