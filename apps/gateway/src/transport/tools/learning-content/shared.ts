import type { ToolExecutionContext } from '@study-studio/tool-core';
import type { GeneratedQuestion } from '@study-studio/protocol';
import { ok, isOk, nowIso, type Result, type BusinessError } from '@study-studio/shared';
import type { LearnerRepository } from '@study-studio/learner-core';
import {
  inferLanguageFromSkillId,
  normalizeTrackLanguage,
} from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import type { LearningRepository } from '../../../modules/practice/ports.js';
import type { LearningContentInput, LearningContentOutput } from '../learning-content-tool.js';

export type TemplateRow = {
  id: string;
  language: string;
  action: string;
  format: string | null;
  skillId: string | null;
  difficulty: number;
  topic: string | null;
  genre: string | null;
  sortOrder: number;
  payload: Record<string, unknown>;
};

/** Learner-facing Chinese copy kept as unicode escapes to avoid editor encoding corruption. */
export const MSG = {
  description:
    '\u4e07\u80fd\u5916\u8bed\u5b66\u4e60\u5185\u5bb9\u5f15\u64ce\uff1a\u6309\u6559\u5b66\u610f\u56fe\u4ece SQLite \u5185\u5bb9\u6a21\u677f\u5e93\u7ec4\u9898\u3001\u8bb2\u89e3\u3001\u4f8b\u53e5\u3001\u5047\u540d/\u8c1a\u6587\u5c0f\u6d4b\u6216\u9605\u8bfb\u5199\u4f5c\u6750\u6599\u3002',
  repoUnsupported:
    '\u5f53\u524d\u4ed3\u50a8\u4e0d\u652f\u6301\u5185\u5bb9\u6a21\u677f\u5e93\uff0c\u8bf7\u4f7f\u7528 DrizzleLearnerRepository',
  collectSkip:
    '\uff08\u5f53\u524d\u4ed3\u50a8\u4e0d\u652f\u6301\u7ec3\u4e60\u961f\u5217 collect\uff0c\u5df2\u8df3\u8fc7\u5165\u5e93\uff09',
  practicePrefix: '\u7ec3\u4e60',
  collectedInto: '\u5df2\u6536\u5165\u7ec3\u4e60\u961f\u5217\u300c',
  collectedIntoEnd: '\u300d\u3002',
  emptyQuiz: (lang: string, skill: string) =>
    `\u5185\u5bb9\u6a21\u677f\u5e93\u4e2d\u6682\u65e0 ${lang} / ${skill} \u7684\u7ec3\u4e60\u9898\uff0c\u8bf7\u5148\u79cd\u5b50\u6216\u63a5\u5165 LLM \u751f\u6210`,
  quizSummary: (n: number, skill: string) =>
    `\u5df2\u4ece\u5185\u5bb9\u5e93\u7ec4\u51fa ${n} \u9053\u81ea\u9002\u5e94\u7ec3\u4e60\u9898\uff08${skill}\uff09\u3002`,
  emptyExamples: (lang: string) => `\u5185\u5bb9\u6a21\u677f\u5e93\u4e2d\u6682\u65e0 ${lang} \u4f8b\u53e5\u5305`,
  examplesSummary: (topic: string) =>
    `\u5df2\u4e3a\u8003\u70b9\u3010${topic}\u3011\u4ece\u5185\u5bb9\u5e93\u8f7d\u5165\u5730\u9053\u4f8b\u53e5\u3002`,
  emptyExplain: (lang: string) => `\u5185\u5bb9\u6a21\u677f\u5e93\u4e2d\u6682\u65e0 ${lang} \u8bb2\u89e3\u5927\u7eb2`,
  explainSummary: (topic: string) =>
    `\u9488\u5bf9\u3010${topic}\u3011\u7684\u8bed\u6cd5\u5256\u6790\u5927\u7eb2\u5df2\u4ece\u5185\u5bb9\u5e93\u8f7d\u5165\u3002`,
  emptyKana: 'curriculum_kana \u8bfe\u7a0b\u5e95\u5ea7\u4e3a\u7a7a\uff0c\u65e0\u6cd5\u7ec4\u5047\u540d\u5c0f\u6d4b',
  kanaPrompt: '\u770b\u5047\u540d\u9009\u51fa\u6b63\u786e\u7684\u7f57\u9a6c\u97f3\uff1a',
  kanaSummary: (n: number) =>
    `\u5df2\u4ece curriculum_kana \u7ec4\u51fa ${n} \u9053\u5047\u540d\u8ba4\u8bfb\u9898\u3002`,
  emptyHangul: 'curriculum_hangul \u8bfe\u7a0b\u5e95\u5ea7\u4e3a\u7a7a\uff0c\u65e0\u6cd5\u7ec4\u8c1a\u6587\u5c0f\u6d4b',
  hangulPrompt: '\u770b\u8c1a\u6587\u5b57\u6bcd\u9009\u51fa\u6b63\u786e\u7684\u7f57\u9a6c\u97f3\uff1a',
  hangulSummary: (n: number) =>
    `\u5df2\u4ece curriculum_hangul \u7ec4\u51fa ${n} \u9053\u8c1a\u6587\u8ba4\u8bfb\u9898\u3002`,
  emptyWriting: (lang: string) => `\u5185\u5bb9\u6a21\u677f\u5e93\u4e2d\u6682\u65e0 ${lang} \u5199\u4f5c\u9898\u5e72`,
  writingEmail: (lv: number) => `\u90ae\u4ef6\u5199\u4f5c \u00b7 Lv.${lv}`,
  writingDiary: (lv: number) => `\u65e5\u8bb0\u4f53 \u00b7 Lv.${lv}`,
  writingNews: (lv: number) => `\u8bfb\u540e\u7eed\u5199 \u00b7 Lv.${lv}`,
  writingSummary: (genre: string, n: number) =>
    `\u5df2\u6309\u4f53\u88c1\u300c${genre}\u300d\u4ece\u5185\u5bb9\u5e93\u8f7d\u5165 ${n} \u9053\u5199\u4f5c/\u7ffb\u8bd1\u9898\u5e72\u3002`,
  emptyPassage: (lang: string) => `\u5185\u5bb9\u6a21\u677f\u5e93\u4e2d\u6682\u65e0 ${lang} \u77ed\u6587\u6a21\u677f`,
  passageSummary: (topic: string) =>
    `\u5df2\u6309\u4e3b\u9898\u300c${topic}\u300d\u4ece\u5185\u5bb9\u5e93\u751f\u6210\u5206\u7ea7\u77ed\u6587\u8349\u7a3f\u3002`,
  doneAction: (action: string) => `\u5df2\u5b8c\u6210\u3010${action}\u3011\u5904\u7406\u3002`,
  emptyDictation: (lang: string) => `\u5185\u5bb9\u6a21\u677f\u5e93\u4e2d\u6682\u65e0 ${lang} \u542c\u5199\u9898`,
  dictationSummary: (n: number) =>
    `\u5df2\u4ece\u5185\u5bb9\u5e93\u7ec4\u51fa ${n} \u9053\u6316\u8bcd\u542c\u5199\u9898\u3002`,
  execFailed: (m: string) => `\u5b66\u4e60\u5185\u5bb9\u5f15\u64ce\u6267\u884c\u5931\u8d25: ${m}`,
  coreTopic: '\u6838\u5fc3\u8003\u70b9',
  dailyJa: '\u65e5\u5e38\u751f\u6d3b',
  dailyEn: 'daily life',
} as const;

export function resolveContentLanguage(input: LearningContentInput): 'ja' | 'en' | 'ko' {
  const skillId = input.skillIds?.[0];
  if (skillId) return inferLanguageFromSkillId(skillId);
  return normalizeTrackLanguage(input.language);
}

export function defaultQuizSkill(language: 'ja' | 'en' | 'ko'): string {
  if (language === 'en') return 'en.grammar.subjunctive';
  if (language === 'ko') return 'ko.grammar.particle_eseo';
  return 'jp.particle.ni_vs_de';
}

export function applyPlaceholders(
  text: string,
  vars: { topic: string; difficulty: number }
): string {
  return text
    .replaceAll('{{topic}}', vars.topic)
    .replaceAll('{{difficulty}}', String(vars.difficulty));
}

export function pickCycled<T>(items: T[], count: number): T[] {
  if (items.length === 0) return [];
  const out: T[] = [];
  for (let i = 0; i < count; i++) {
    out.push(items[i % items.length]!);
  }
  return out;
}

export async function loadTemplates(
  repo: LearningRepository,
  options: {
    action: string;
    language: string;
    skillId?: string | undefined;
    format?: string | undefined;
    genre?: string | undefined;
  }
): Promise<Result<TemplateRow[], BusinessError>> {
  return repo.listContentTemplates(options);
}

export async function maybeCollect(
  learnerRepo: LearnerRepository,
  context: ToolExecutionContext,
  input: LearningContentInput,
  language: string,
  questions: GeneratedQuestion[] | undefined,
  summary: string,
  extras?: Partial<LearningContentOutput>
): Promise<Result<LearningContentOutput, BusinessError>> {
  const base: LearningContentOutput = {
    action: input.action,
    language,
    summary,
    questions,
    ...extras,
  };

  if (!input.collect || !questions?.length) {
    return ok(base);
  }

  if (!(learnerRepo instanceof DrizzleLearnerRepository)) {
    return ok({
      ...base,
      summary: `${summary}${MSG.collectSkip}`,
    });
  }

  const collected = await learnerRepo.collectPracticeQuestions({
    userId: context.userId,
    title:
      input.collectionTitle ||
      `${MSG.practicePrefix} ? ${input.action} ? ${nowIso().slice(0, 10)}`,
    intent: 'GENERATE_QUIZ',
    questions,
    sourceRef: input.skillIds?.[0],
  });

  if (!isOk(collected)) {
    return collected;
  }

  return ok({
    ...base,
    summary: `${summary} ${MSG.collectedInto}${collected.value.collection.title}${MSG.collectedIntoEnd}`,
    collectionId: collected.value.collection.id,
  });
}
