import type { GeneratedQuestion } from '@lexdistill/protocol';
import { err, generateId, isOk, ok, type Result, BusinessError } from '@lexdistill/shared';
import {
  isLessonLocked,
  isQuestionAllowed,
  isSkillAllowedForLevel,
  NOVICE_SAFE_SKILL,
  resolveStudyGate,
  tierCapForLevel,
} from '@lexdistill/learner-core';
import type { LearningContentTemplateRepository } from '../../ports.js';
import type { LearningContentInput, LearningContentOutput, LearningContentContext } from '../../contracts.js';
import {
  MSG,
  defaultQuizSkill,
  loadTemplates,
  maybeCollect,
} from './shared.js';

export async function handleQuizAction(
  repo: LearningContentTemplateRepository,
  context: LearningContentContext,
  input: LearningContentInput,
  language: 'ja' | 'en' | 'ko'
): Promise<Result<LearningContentOutput, BusinessError>> {
  if (input.format === 'LISTENING_DICTATION') {
    return buildDictation(repo, context, input, language);
  }

  const count = input.count ?? 1;
  const difficulty = input.difficulty ?? 2;
  const skillId = input.skillIds?.[0];
  // 出题门：用户点名要的 skillIds 是明确意图，全豁免；系统默认的一律过门
  // （档位 + 讲义锁）。快照读不到降级为纯档位门（旧行为），永不挡主路径。
  const gate = await resolveStudyGate(repo, context.userId, language, null);
  const gateLevel = gate.level;
  let targetSkill = skillId || defaultQuizSkill(language);
  let gateNote = '';
  if (!skillId) {
    // 候选顺序：默认考点 → 本轨道安全默认；取第一个档位够 + 讲义不锁的。
    const ordered = [targetSkill, NOVICE_SAFE_SKILL[language]].filter(
      (s, i, arr) => arr.indexOf(s) === i
    );
    const picked = ordered.find(
      (s) => isSkillAllowedForLevel(s, gateLevel) && !isLessonLocked(s, gate)
    );
    if (!picked) {
      const firstLocked = ordered.find((s) => isLessonLocked(s, gate)) ?? ordered[0]!;
      return err(
        new BusinessError(
          'E_CONTENT_EMPTY',
          `【${firstLocked}】的讲义还没学完：先去语法讲义学完它，学完自动解锁这类题`,
          'TOOL_EXECUTION'
        )
      );
    }
    if (picked !== targetSkill) {
      gateNote = `（系统默认考点超纲或讲义未学，已降级为基础考点 ${picked}）`;
      targetSkill = picked;
    }
  }
  const effectiveDifficulty = !skillId ? Math.min(difficulty, tierCapForLevel(gateLevel)) : difficulty;
  const templates = await loadTemplates(repo, {
    action: 'generate_quiz',
    language,
    skillId: targetSkill,
    format: input.format,
  });
  if (!isOk(templates)) return templates;
  if (templates.value.length === 0) {
    return err(
      new BusinessError('E_CONTENT_EMPTY', MSG.emptyQuiz(language, targetSkill), 'TOOL_EXECUTION')
    );
  }

  const picked = templates.value.slice(0, count);
  // P4-2 来源补链：行 id 与题目配对携带，门过滤后仍对齐（被滤掉的行 id 不进 sourceRef）。
  const built = picked.map((row) => {
    const q = (row.payload as { question: Omit<GeneratedQuestion, 'id'> }).question;
    return {
      rowId: row.id,
      question: {
        ...q,
        id: generateId('q_dyn'),
        testedSkillId: targetSkill.includes('particle')
          ? targetSkill
          : q.testedSkillId || targetSkill,
        difficultyTier: effectiveDifficulty,
      } as GeneratedQuestion,
    };
  });
  // 模板行自带 tier 可能超标、技能可能带锁：系统路径过完整门，用户点名的不动。
  const gated = !skillId
    ? built.filter((b) => isQuestionAllowed(b.question.testedSkillId, b.question.difficultyTier, gateLevel, gate))
    : built;
  if (gated.length === 0) {
    return err(
      new BusinessError('E_CONTENT_EMPTY', MSG.emptyQuiz(language, targetSkill), 'TOOL_EXECUTION')
    );
  }

  return maybeCollect(
    repo,
    context,
    input,
    language,
    gated.map((b) => b.question),
    `${MSG.quizSummary(gated.length, targetSkill)}${gateNote}`,
    undefined,
    gated.map((b) => b.rowId)
  );
}

export async function buildDictation(
  repo: LearningContentTemplateRepository,
  context: LearningContentContext,
  input: LearningContentInput,
  language: string
): Promise<Result<LearningContentOutput, BusinessError>> {
  const count = input.count ?? 1;
  const difficulty = input.difficulty ?? 2;
  const skillId = input.skillIds?.[0];
  const templates = await loadTemplates(repo, {
    action: 'dictation',
    language,
    skillId,
    format: 'LISTENING_DICTATION',
  });
  if (!isOk(templates)) return templates;
  if (templates.value.length === 0) {
    return err(new BusinessError('E_CONTENT_EMPTY', MSG.emptyDictation(language), 'TOOL_EXECUTION'));
  }

  const picked = templates.value.slice(0, count);
  const pickedRowIds = picked.map((row) => row.id);
  const dictationItems = picked.map((row) => {
    const item = (
      row.payload as {
        item: Omit<NonNullable<LearningContentOutput['dictationItems']>[number], 'id'>;
      }
    ).item;
    return {
      ...item,
      id: generateId('dict'),
      testedSkillId: skillId || item.testedSkillId,
    };
  });

  const questions: GeneratedQuestion[] = dictationItems.map((d) => ({
    id: d.id,
    type: 'LISTENING_DICTATION' as const,
    prompt: d.blankPrompt,
    content: d.clozeDisplay,
    correctAnswer: d.targetWord,
    explanation: d.grammarExplanation,
    testedSkillId: d.testedSkillId,
    difficultyTier: difficulty,
    // P5-E8：完整语料随题走（TTS 播原句；UI 可展示挖空提示）
    dictation: {
      fullJapanese: d.fullJapanese,
      speaker: d.speaker,
      chinese: d.chinese,
      furiganaHint: d.furiganaHint,
    },
  }));

  return maybeCollect(
    repo,
    context,
    input,
    language,
    questions,
    MSG.dictationSummary(dictationItems.length),
    { dictationItems },
    pickedRowIds
  );
}
