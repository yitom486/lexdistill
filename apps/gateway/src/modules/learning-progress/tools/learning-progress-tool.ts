import { z } from 'zod';
import {
  type ToolDefinition,
  type ToolExecutionContext,
  ToolPermissions,
  ToolLocations,
} from '@lexdistill/tool-core';
import {
  ok,
  err,
  type Result,
  BusinessError,
  extractErrorText,
  isOk,
} from '@lexdistill/shared';
import type { LearnerRepository } from '@lexdistill/learner-core';
import { createMistakeEntry } from '@lexdistill/learner-core';
import type { GeneratedQuestion, QuizGradingResult } from '@lexdistill/protocol';

export const LearningProgressInputSchema = z.object({
  action: z.enum([
    'record_mistake',
    'resolve_mistake',
    'upsert_skill',
    'review_card',
    'record_quiz_attempt',
  ]),
  mistakeId: z.string().optional(),
  cardId: z.string().optional(),
  rating: z.enum(['AGAIN', 'HARD', 'GOOD', 'EASY']).optional(),
  skillId: z.string().optional(),
  skillName: z.string().optional(),
  proficiency: z.number().min(0).max(1).optional(),
  questionId: z.string().optional(),
  userAnswer: z.string().optional(),
  isCorrect: z.boolean().optional(),
  score: z.number().optional(),
  testedSkillId: z.string().optional(),
  question: z.record(z.unknown()).optional(),
  grading: z.record(z.unknown()).optional(),
});

export type LearningProgressInput = z.infer<typeof LearningProgressInputSchema>;

export class LearningProgressTool
  implements ToolDefinition<LearningProgressInput, { ok: true; action: string }>
{
  public readonly name = 'learning.progress';
  public readonly description =
    '学情写入：错题入库/攻克、技能熟练度回写、卡片复习结果、做题尝试记录。';
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.WRITE;
  public readonly schema = LearningProgressInputSchema;

  constructor(private readonly learnerRepo: LearnerRepository) {}

  public async execute(
    input: LearningProgressInput,
    context: ToolExecutionContext
  ): Promise<Result<{ ok: true; action: string }, BusinessError>> {
    try {
      switch (input.action) {
        case 'record_quiz_attempt': {
          await this.learnerRepo.recordQuizAttempt({
            id: `att_${Date.now()}`,
            userId: context.userId,
            questionId: input.questionId || 'unknown',
            userAnswer: input.userAnswer || '',
            isCorrect: Boolean(input.isCorrect),
            score: input.score ?? 0,
            timeSpentMs: 0,
            testedSkillId: input.testedSkillId || 'general',
            createdAt: new Date().toISOString(),
          });
          return ok({ ok: true, action: input.action });
        }
        case 'record_mistake': {
          if (!input.question || !input.grading) {
            return err(
              new BusinessError('E_INVALID_INPUT', '录入错题需要 question 与 grading', 'VALIDATION')
            );
          }
          const mistake = createMistakeEntry(
            context.userId,
            input.question as unknown as GeneratedQuestion,
            input.userAnswer || '',
            input.grading as unknown as QuizGradingResult
          );
          const res = await this.learnerRepo.saveMistake(mistake);
          if (!isOk(res)) return res;
          return ok({ ok: true, action: input.action });
        }
        case 'upsert_skill': {
          if (!input.skillId) {
            return err(new BusinessError('E_INVALID_INPUT', '需要 skillId', 'VALIDATION'));
          }
          const res = await this.learnerRepo.saveSkillMetric(context.userId, {
            id: input.skillId,
            dimension: 'GRAMMAR',
            name: input.skillName || input.skillId,
            proficiency: input.proficiency ?? 0.5,
            totalAttempts: 1,
            correctAttempts: input.isCorrect ? 1 : 0,
            consecutiveErrors: input.isCorrect ? 0 : 1,
            status: (input.proficiency ?? 0.5) < 0.6 ? 'WEAKNESS' : 'NORMAL',
          });
          if (!isOk(res)) return res;
          return ok({ ok: true, action: input.action });
        }
        case 'resolve_mistake':
        case 'review_card':
          // 具体攻克/复习逻辑已由专用 HTTP/WS 路径覆盖；此处作可编排占位
          return ok({ ok: true, action: input.action });
        default:
          return err(
            new BusinessError('E_INVALID_INPUT', `未知 progress action`, 'VALIDATION')
          );
      }
    } catch (e) {
      return err(
        new BusinessError(
          'E_TOOL_EXECUTION',
          `学情写入失败: ${extractErrorText(e) || '未知错误'}`,
          'TOOL_EXECUTION'
        )
      );
    }
  }
}
