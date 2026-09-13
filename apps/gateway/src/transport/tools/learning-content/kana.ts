import type { ToolExecutionContext } from '@study-studio/tool-core';
import type { GeneratedQuestion } from '@study-studio/protocol';
import { err, generateId, isOk, type Result, BusinessError } from '@study-studio/shared';
import type { ContentRepository } from '../../../modules/library/ports.js';
import type { LearnerRepository } from '@study-studio/learner-core';
import type { LearningContentInput, LearningContentOutput } from '../learning-content-tool.js';
import { MSG, maybeCollect } from './shared.js';

export async function handleKanaDrillAction(
  repo: ContentRepository & LearnerRepository,
  context: ToolExecutionContext,
  input: LearningContentInput
): Promise<Result<LearningContentOutput, BusinessError>> {
  const count = input.count ?? 1;
  const kanaRes = await repo.getCurriculumKana();
  if (!isOk(kanaRes)) return kanaRes;
  const pool = kanaRes.value.filter((k) => k.hiragana && k.romaji);
  if (pool.length < 4) {
    return err(new BusinessError('E_CONTENT_EMPTY', MSG.emptyKana, 'TOOL_EXECUTION'));
  }

  const questions: GeneratedQuestion[] = [];
  const used = new Set<string>();
  for (let i = 0; i < Math.min(count, pool.length); i++) {
    let item = pool[Math.floor(Math.random() * pool.length)]!;
    let guard = 0;
    while (used.has(item.id) && guard < 20) {
      item = pool[Math.floor(Math.random() * pool.length)]!;
      guard++;
    }
    used.add(item.id);

    const distractors = pool
      .filter((k) => k.id !== item.id)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);
    const options = [item.romaji, ...distractors.map((d) => d.romaji)].sort(() =>
      Math.random() > 0.5 ? 1 : -1
    );

    questions.push({
      id: generateId('q_kana'),
      type: 'MULTIPLE_CHOICE',
      prompt: MSG.kanaPrompt,
      content: `\u300c${item.hiragana}\u300d`,
      options,
      correctAnswer: item.romaji,
      explanation:
        item.learningGuide
          ? `${item.learningGuide.soundDescription} ${item.learningGuide.memoryTip}`
          : item.mnemonic ||
            `\u5e73\u5047\u540d\u300c${item.hiragana}\u300d\u6807\u51c6\u7f57\u9a6c\u97f3\u4e3a ${item.romaji}\u3002`,
      testedSkillId: 'jp.kana.hiragana',
      difficultyTier: 1,
    });
  }

  return maybeCollect(
    repo,
    context,
    input,
    'ja',
    questions,
    MSG.kanaSummary(questions.length)
  );
}
