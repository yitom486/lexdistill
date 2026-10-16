import { ok, err, type Result, BusinessError, translateToBusinessError } from '@lexdistill/shared';
import type { LearningContentContext, LearningContentInput, LearningContentOutput } from '../contracts.js';
import type { LearningContentCommandRepository } from '../ports.js';
import { MSG, resolveContentLanguage } from './actions/shared.js';
import { handleQuizAction, buildDictation } from './actions/quiz.js';
import { handleExplainAction, handleExampleSetAction } from './actions/explain.js';
import { handleKanaDrillAction } from './actions/kana.js';
import { handleHangulDrillAction } from './actions/hangul.js';
import { handleHangulWordsAction } from './actions/hangul-words.js';
import { handleKanaWordsAction } from './actions/kana-words.js';
import { handleWritingPromptAction } from './actions/writing.js';
import { handlePassageAction } from './actions/passage.js';
import { generateForBlock } from './actions/synthesize-content.js';

export async function executeLearningContent(
  repo: LearningContentCommandRepository,
  input: LearningContentInput,
  context: LearningContentContext
): Promise<Result<LearningContentOutput, BusinessError>> {
  try {
    const action = input.action;
    const language = resolveContentLanguage(input);

    if (action === 'generate_for_block') {
      return generateForBlock(input, context, language, (synth, ctx) =>
        executeLearningContent(repo, synth, ctx));
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
      default:
        if (input.format === 'LISTENING_DICTATION') {
          return buildDictation(repo, context, input, language);
        }
        return ok({ action, language, summary: MSG.doneAction(action) });
    }
  } catch (cause: unknown) {
    const translated = translateToBusinessError(cause, 'learning.content');
    return err(new BusinessError(
      translated.code,
      '\u5b66\u4e60\u5185\u5bb9\u751f\u6210\u6682\u65f6\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002',
      translated.category,
      translated.retryable,
      translated.internalDetails
    ));
  }
}