import { z } from 'zod';
import {
  type ToolDefinition,
  type ToolExecutionContext,
  ToolPermissions,
  ToolLocations,
} from '@lexdistill/tool-core';
import { GeneratedQuestionSchema } from '@lexdistill/protocol';
import { ok, type Result, type BusinessError } from '@lexdistill/shared';

export const UiNavigateInputSchema = z.object({
  target: z.enum([
    'QUIZ',
    'PRACTICE_PLAN',
    'CARDS',
    'KANA',
    'HANGUL',
    'TEXTBOOK',
    'READING',
    'WRITING',
    'SHADOWING',
    'PITCH',
    'MISTAKES',
    'RADAR',
    'TODAY',
    'TUTOR',
  ]),
  openTutor: z.boolean().optional(),
});
export type UiNavigateInput = z.infer<typeof UiNavigateInputSchema>;

export const UiPresentInputSchema = z.object({
  surface: z.enum(['quiz', 'cards', 'kana_drill', 'hangul_drill', 'reading_quiz', 'writing']),
  layout: z.enum(['SPLIT_PASSAGE_QUESTIONS', 'SINGLE_COLUMN']).optional(),
  collectionId: z.string().optional(),
  questions: z.array(GeneratedQuestionSchema).optional(),
  stepIndex: z.number().int().nonnegative().optional(),
  passageId: z.string().optional(),
});
export type UiPresentInput = z.infer<typeof UiPresentInputSchema>;

/**
 * Client Tool：指示前端切换 Tab / 打开导师
 * Gateway 不在服务端执行副作用，只校验参数并经 AGENT_TOOL_CALL 下发
 */
export class UiNavigateTool implements ToolDefinition<UiNavigateInput, UiNavigateInput> {
  public readonly name = 'ui.navigate';
  public readonly description = '切换学习工作台 Tab（含今日学习计划），或打开 AI 导师抽屉。';
  public readonly location = ToolLocations.CLIENT;
  public readonly permission = ToolPermissions.WRITE;
  public readonly schema = UiNavigateInputSchema;

  public async execute(
    input: UiNavigateInput,
    _context: ToolExecutionContext
  ): Promise<Result<UiNavigateInput, BusinessError>> {
    return ok(input);
  }
}

/**
 * Client Tool：把已校验题包 / 练习队列灌入当前 Workbench
 */
export class UiPresentTool implements ToolDefinition<UiPresentInput, UiPresentInput> {
  public readonly name = 'ui.present';
  public readonly description =
    '将结构化题包或练习队列推入 QUIZ / READING / WRITING 等工作台供用户作答。';
  public readonly location = ToolLocations.CLIENT;
  public readonly permission = ToolPermissions.WRITE;
  public readonly schema = UiPresentInputSchema as z.ZodType<UiPresentInput>;

  public async execute(
    input: UiPresentInput,
    _context: ToolExecutionContext
  ): Promise<Result<UiPresentInput, BusinessError>> {
    return ok(input);
  }
}
