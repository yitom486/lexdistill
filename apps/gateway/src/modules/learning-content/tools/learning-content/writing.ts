import type { ToolExecutionContext } from '@study-studio/tool-core';
import type { GeneratedQuestion } from '@study-studio/protocol';
import { err, generateId, isOk, type Result, BusinessError } from '@study-studio/shared';
import type { LearningContentRepository } from '../../ports.js';
import type { LearnerRepository } from '@study-studio/learner-core';
import type { LearningContentInput, LearningContentOutput } from '../learning-content-tool.js';
import { MSG, loadTemplates, maybeCollect, pickCycled } from './shared.js';

export async function handleWritingPromptAction(
  repo: LearningContentRepository & LearnerRepository,
  context: ToolExecutionContext,
  input: LearningContentInput,
  language: 'ja' | 'en' | 'ko'
): Promise<Result<LearningContentOutput, BusinessError>> {
  const count = input.count ?? 1;
  const difficulty = input.difficulty ?? 2;
  const skillId = input.skillIds?.[0];
  const genre = input.genre || 'translation';
  const templates = await loadTemplates(repo, {
    action: 'generate_writing_prompt',
    language,
    skillId,
    genre,
  });
  if (!isOk(templates)) return templates;
  if (templates.value.length === 0) {
    return err(new BusinessError('E_CONTENT_EMPTY', MSG.emptyWriting(language), 'TOOL_EXECUTION'));
  }

  const picked = pickCycled(templates.value, count);
  const writingPrompts = picked.map((row, i) => {
    const p = (
      row.payload as {
        prompt: Omit<
          NonNullable<LearningContentOutput['writingPrompts']>[number],
          'id'
        >;
      }
    ).prompt;
    const category =
      genre === 'email'
        ? MSG.writingEmail(difficulty)
        : genre === 'diary'
          ? MSG.writingDiary(difficulty)
          : genre === 'news_response'
            ? MSG.writingNews(difficulty)
            : p.category;
    return {
      ...p,
      id: generateId('write'),
      category,
      testedSkillId: i === 0 && skillId ? skillId : p.testedSkillId,
    };
  });

  const questions: GeneratedQuestion[] = writingPrompts.map((p) => ({
    id: p.id,
    type: 'TRANSLATION' as const,
    prompt: p.chinesePrompt,
    content: p.chinesePrompt,
    correctAnswer: p.standardAnswer,
    explanation: p.grammarFocus,
    testedSkillId: p.testedSkillId,
    difficultyTier: difficulty,
  }));

  return maybeCollect(
    repo,
    context,
    input,
    language,
    questions,
    MSG.writingSummary(genre, writingPrompts.length),
    { writingPrompts }
  );
}
