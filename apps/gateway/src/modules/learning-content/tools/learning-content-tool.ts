import { z } from 'zod';
import {
  type ToolDefinition,
  type ToolExecutionContext,
  ToolPermissions,
  ToolLocations,
} from '@study-studio/tool-core';
import type { GeneratedQuestion } from '@study-studio/protocol';
import { PracticeBlockSpecSchema } from '@study-studio/protocol';
import { ok, err, type Result, BusinessError, isOk } from '@study-studio/shared';
import type { LearnerRepository } from '@study-studio/learner-core';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { MSG, resolveContentLanguage } from './learning-content/shared.js';
import { handleQuizAction, buildDictation } from './learning-content/quiz.js';
import { handleExplainAction, handleExampleSetAction } from './learning-content/explain.js';
import { handleKanaDrillAction } from './learning-content/kana.js';
import { handleHangulDrillAction } from './learning-content/hangul.js';
import { handleHangulWordsAction, type HangulWord } from './learning-content/hangul-words.js';
import { handleKanaWordsAction, type KanaWord } from './learning-content/kana-words.js';
import { handleWritingPromptAction } from './learning-content/writing.js';
import { handlePassageAction } from './learning-content/passage.js';
import { generateForBlock } from './learning-content/synthesize-content.js';

export { synthesizeContentInputForBlock } from './learning-content/synthesize-content.js';

export const LearningContentInputSchema = z.object({
  action: z.enum([
    'generate_quiz',
    'explain',
    'example_set',
    'kana_drill',
    // 谚文认读小测：从 curriculum_hangul 随机组看字母选罗马字题（系统随机，零成本）
    'hangul_drill',
    // 韩语单词听写/词义巩固：从本地词典随机抽取韩语词语（系统随机，零成本）
    'generate_hangul_words',
    // 假名单词听写/词义巩固：从本地词典随机抽取带假名读音的词语（系统随机，零成本）
    'generate_kana_words',
    'generate_passage',
    'generate_writing_prompt',
    // P5-E7：按练习计划块规格批量生成（模板驱动，不调 LLM；READING 走篇目链路另行接入）
    'generate_for_block',
  ]),
  count: z.number().int().min(1).max(20).optional(),
  format: z
    .enum([
      'MULTIPLE_CHOICE',
      'FILL_IN_BLANK',
      'SENTENCE_REORDER',
      'KANA_READ',
      'READING_MCQ',
      'TRANSLATION',
      'LISTENING_DICTATION',
      'WRITING_PROMPT',
    ])
    .optional(),
  skillIds: z.array(z.string()).optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
  language: z.enum(['ja', 'en', 'ko']).optional(),
  topic: z.string().optional(),
  /** translation | email | essay | diary | news_response */
  genre: z.string().optional(),
  /** generate_kana_words：目标书写体（缺省 HIRAGANA；不足时另一书写体补齐） */
  script: z.enum(['HIRAGANA', 'KATAKANA']).optional(),
  /** Persist into practice_collections / practice_items when true */
  collect: z.boolean().optional(),
  collectionTitle: z.string().optional(),
  /** generate_for_block：块规格列表（逐块映射到既有生成路径） */
  blocks: z.array(PracticeBlockSpecSchema).optional(),
});

export type LearningContentInput = z.infer<typeof LearningContentInputSchema>;

export interface LearningContentOutput {
  action: string;
  language: string;
  summary: string;
  questions?: GeneratedQuestion[] | undefined;
  examples?: Array<{ sentence: string; translation: string; grammarPoint: string }> | undefined;
  explanation?: {
    coreConcept: string;
    rules: string[];
    commonMistakes: string[];
    mnemonicTip: string;
  } | undefined;
  passage?: {
    title: string;
    body: string;
    topic: string;
  } | undefined;
  writingPrompts?: Array<{
    id: string;
    category: string;
    chinesePrompt: string;
    contextHint: string;
    testedSkillId: string;
    standardAnswer: string;
    grammarFocus: string;
  }> | undefined;
  dictationItems?: Array<{
    id: string;
    sourceLesson: string;
    speaker: string;
    fullJapanese: string;
    chinese: string;
    blankPrompt: string;
    clozeDisplay: string;
    targetWord: string;
    furiganaHint: string;
    categoryTag: string;
    testedSkillId: string;
    grammarExplanation: string;
  }> | undefined;
  /** generate_for_block：按块对齐的生成结果（questions 为空/errorCode 时由装配层回退） */
  perBlock?: Array<{
    blockId: string;
    kind: string;
    questions?: GeneratedQuestion[];
    errorCode?: string;
  }> | undefined;
  /** generate_kana_words：带假名读音的词语（含词典 entryId，可一键转生词卡） */
  kanaWords?: KanaWord[] | undefined;
  /** generate_hangul_words：韩语词语（含词典 entryId，可一键转生词卡） */
  hangulWords?: HangulWord[] | undefined;
  collectionId?: string | undefined;
}

export class LearningContentTool
  implements ToolDefinition<LearningContentInput, LearningContentOutput>
{
  public readonly name = 'learning.content';
  public readonly description = MSG.description;
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.READ;
  public readonly schema = LearningContentInputSchema;

  constructor(private readonly learnerRepo: LearnerRepository) {}

  private requireDrizzle(): Result<DrizzleLearnerRepository, BusinessError> {
    if (!(this.learnerRepo instanceof DrizzleLearnerRepository)) {
      return err(new BusinessError('E_TOOL_UNSUPPORTED', MSG.repoUnsupported, 'TOOL_EXECUTION'));
    }
    return ok(this.learnerRepo);
  }

  public async execute(
    input: LearningContentInput,
    context: ToolExecutionContext
  ): Promise<Result<LearningContentOutput, BusinessError>> {
    try {
      const drizzle = this.requireDrizzle();
      if (!isOk(drizzle)) return drizzle;
      const repo = drizzle.value;

      const action = input.action;
      const language = resolveContentLanguage(input);

      if (action === 'generate_for_block') {
        return generateForBlock(input, context, language, (synth, ctx) => this.execute(synth, ctx));
      }

      switch (action) {
        case 'generate_quiz':
          return handleQuizAction(repo, context, input, language);
        case 'example_set':
          return handleExampleSetAction(repo, input, language);
        case 'explain':
          return handleExplainAction(repo, input, language);
        case 'kana_drill':
          return handleKanaDrillAction(repo, context, input);
        case 'hangul_drill':
          return handleHangulDrillAction(repo, context, input);
        case 'generate_hangul_words':
          return handleHangulWordsAction(repo, context, input);
        case 'generate_kana_words':
          return handleKanaWordsAction(repo, context, input);
        case 'generate_writing_prompt':
          return handleWritingPromptAction(repo, context, input, language);
        case 'generate_passage':
          return handlePassageAction(repo, input, language);
        default: {
          if (input.format === 'LISTENING_DICTATION') {
            return buildDictation(repo, context, input, language);
          }
          return ok({
            action,
            language,
            summary: MSG.doneAction(action),
          });
        }
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'unknown';
      return err(new BusinessError('E_TOOL_EXECUTION', MSG.execFailed(message), 'TOOL_EXECUTION'));
    }
  }
}
