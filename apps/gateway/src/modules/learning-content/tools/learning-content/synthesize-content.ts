import type { ToolExecutionContext } from '@study-studio/tool-core';
import type { PracticeBlockSpec } from '@study-studio/protocol';
import { err, isOk, ok, type Result, BusinessError } from '@study-studio/shared';
import type { LearningContentInput, LearningContentOutput } from '../learning-content-tool.js';

/**
 * P5-E7：练习计划块规格 → 既有生成路径的合成输入（模板驱动，不调 LLM）。
 * READING 返回 null：阅读套题走 generate_passage 篇目链路（无独立配题），v1 不在 run 内生成。
 */
export function synthesizeContentInputForBlock(
  block: PracticeBlockSpec,
  language: 'ja' | 'en' | 'ko'
): LearningContentInput | null {
  const base = {
    count: Math.min(block.count, 20),
    difficulty: block.difficulty ?? 2,
    language,
    ...(block.skillIds && block.skillIds.length > 0 ? { skillIds: block.skillIds } : {}),
    ...(block.topic ? { topic: block.topic } : {}),
    collect: false,
  };
  switch (block.kind) {
    case 'QUIZ':
    case 'VOCAB_REVIEW':
    case 'VOCAB_NEW': {
      const quizLike = ['MULTIPLE_CHOICE', 'FILL_IN_BLANK', 'SENTENCE_REORDER'] as const;
      const formats =
        block.questionFormats && block.questionFormats.length > 0
          ? block.questionFormats
          : (['MULTIPLE_CHOICE'] as const);
      const format =
        formats.find((f): f is (typeof quizLike)[number] =>
          (quizLike as readonly string[]).includes(f)
        ) ?? 'MULTIPLE_CHOICE';
      return { ...base, action: 'generate_quiz', format };
    }
    case 'DICTATION':
      return { ...base, action: 'generate_quiz', format: 'LISTENING_DICTATION' };
    case 'TRANSLATION':
      return { ...base, action: 'generate_writing_prompt', genre: 'translation' };
    case 'WRITING':
      return { ...base, action: 'generate_writing_prompt', genre: 'diary' };
    case 'READING':
      return null;
    default:
      return null;
  }
}

type ExecuteFn = (
  input: LearningContentInput,
  context: ToolExecutionContext
) => Promise<Result<LearningContentOutput, BusinessError>>;

/**
 * P5-E7：按块规格逐块生成题目（复用既有模板生成路径，collect=false 不自动入库）。
 * 输出按 blockId 对齐；不可生成（READING）或模板缺失时返回 errorCode，由装配层回退。
 */
export async function generateForBlock(
  input: LearningContentInput,
  context: ToolExecutionContext,
  language: 'ja' | 'en' | 'ko',
  execute: ExecuteFn
): Promise<Result<LearningContentOutput, BusinessError>> {
  const blocks = input.blocks;
  if (!blocks || blocks.length === 0) {
    return err(new BusinessError('E_INVALID_INPUT', 'generate_for_block 需要 blocks', 'VALIDATION'));
  }
  const perBlock: NonNullable<LearningContentOutput['perBlock']> = [];
  let generated = 0;
  for (const block of blocks) {
    const synth = synthesizeContentInputForBlock(block, language);
    if (!synth) {
      perBlock.push({ blockId: block.id, kind: block.kind, errorCode: 'E_BLOCK_KIND_NOT_GENERABLE' });
      continue;
    }
    const res = await execute(synth, context);
    if (!isOk(res)) {
      perBlock.push({ blockId: block.id, kind: block.kind, errorCode: res.error.code });
      continue;
    }
    const questions = res.value.questions ?? [];
    generated += questions.length;
    perBlock.push({ blockId: block.id, kind: block.kind, questions });
  }
  return ok({
    action: 'generate_for_block',
    language,
    summary:
      generated > 0
        ? `\u5df2\u6309\u5757\u89c4\u683c\u751f\u6210 ${generated} \u9053\u7ec3\u4e60\u9898\u3002`
        : '\u6682\u65e0\u53ef\u751f\u6210\u7684\u5757\u9898\u76ee\uff0c\u8bf7\u68c0\u67e5\u5185\u5bb9\u6a21\u677f\u5e93\u3002',
    perBlock,
  });
}
