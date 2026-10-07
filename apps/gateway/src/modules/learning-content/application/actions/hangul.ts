import type { GeneratedQuestion, HangulType } from '@study-studio/protocol';
import { err, generateId, isOk, type Result, BusinessError } from '@study-studio/shared';
import type { LearningContentCurriculumRepository } from '../../ports.js';
import type { LearningContentInput, LearningContentOutput, LearningContentContext } from '../../contracts.js';
import { MSG, maybeCollect } from './shared.js';

const HANGUL_SKILL_BY_TYPE: Record<HangulType, string> = {
  CONSONANT: 'ko.hangul.consonant',
  VOWEL: 'ko.hangul.vowel',
  YVOWEL: 'ko.hangul.compound',
  COMPOUND: 'ko.hangul.compound',
  CODA: 'ko.hangul.compound',
};

/**
 * 谚文认读小测：从 curriculum_hangul 组看字母选罗马字选择题（系统随机，零成本）。
 * 题干约束全部来自课程表种子，模型不得自造字母。
 */
export async function handleHangulDrillAction(
  repo: LearningContentCurriculumRepository,
  context: LearningContentContext,
  input: LearningContentInput
): Promise<Result<LearningContentOutput, BusinessError>> {
  const count = input.count ?? 1;
  const hangulRes = await repo.getCurriculumHangul();
  if (!isOk(hangulRes)) return hangulRes;
  const pool = hangulRes.value.filter((h) => h.jamo && h.romanization);
  if (pool.length < 4) {
    return err(new BusinessError('E_CONTENT_EMPTY', MSG.emptyHangul, 'TOOL_EXECUTION'));
  }

  const questions: GeneratedQuestion[] = [];
  const used = new Set<string>();
  for (let i = 0; i < Math.min(count, pool.length); i++) {
    const remaining = pool.filter(candidate => !used.has(candidate.id));
    const item = remaining[Math.floor(Math.random() * remaining.length)]!;
    used.add(item.id);

    // 选项罗马字逐项去重：跨类同音（子音 ㅋ k / 收音 ㄱ k）既不能与题干重复，彼此也不能重复
    const seenRoman = new Set<string>([item.romanization]);
    const distractors = pool
      .filter((h) => h.id !== item.id)
      .sort(() => Math.random() - 0.5)
      .filter((h) => {
        if (seenRoman.has(h.romanization)) return false;
        seenRoman.add(h.romanization);
        return true;
      })
      .slice(0, 3);
    const options = [item.romanization, ...distractors.map((d) => d.romanization)].sort(() =>
      Math.random() > 0.5 ? 1 : -1
    );

    questions.push({
      id: generateId('q_hangul'),
      type: 'MULTIPLE_CHOICE',
      prompt: MSG.hangulPrompt,
      content: `\u300c${item.jamo}\u300d${item.type === 'CODA' ? ' (收音)' : ''}`,
      options,
      correctAnswer: item.romanization,
      explanation:
        item.mnemonic ||
        `\u8c1a\u6587\u300c${item.jamo}\u300d\u6807\u51c6\u7f57\u9a6c\u97f3\u4e3a ${item.romanization}\u3002`,
      testedSkillId: HANGUL_SKILL_BY_TYPE[item.type],
      difficultyTier: 1,
    });
  }

  return maybeCollect(
    repo,
    context,
    input,
    'ko',
    questions,
    MSG.hangulSummary(questions.length)
  );
}
