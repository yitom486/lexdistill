import { z } from 'zod';
import {
  type ToolDefinition,
  type ToolExecutionContext,
  ToolPermissions,
  ToolLocations,
} from '@study-studio/tool-core';
import { ok, isOk, type Result, type BusinessError } from '@study-studio/shared';
import type { LearnerRepository } from '@study-studio/learner-core';

export const FlashcardsDueInputSchema = z.object({
  userId: z.string().min(1).max(64),
  language: z.enum(['ja', 'en', 'ko']).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export type FlashcardsDueInput = z.infer<typeof FlashcardsDueInputSchema>;

export interface DueCardSummary {
  id: string;
  type: string;
  front: string;
  back: string;
  dueAt: string;
  state: string;
  stability: number;
}

/**
 * 到期闪卡 Server Tool（READ）。
 * 只返复习决策所需字段（不含完整 FSRS 内参）；AI 排今日复习、组抽查卷时调用。
 */
export class FlashcardsDueTool implements ToolDefinition<FlashcardsDueInput, DueCardSummary[]> {
  public readonly name = 'flashcards.due';
  public readonly description =
    '读取用户到期需复习的闪卡（精简字段）。AI 安排复习与抽查的数据入口。';
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.READ;
  public readonly schema = FlashcardsDueInputSchema;

  constructor(private readonly learnerRepo: LearnerRepository) {}

  public async execute(
    input: FlashcardsDueInput,
    _context: ToolExecutionContext
  ): Promise<Result<DueCardSummary[], BusinessError>> {
    void _context;
    const result = await this.learnerRepo.getDueCards(input.userId, input.limit ?? 50, {
      dueOnly: true,
      ...(input.language ? { language: input.language } : {}),
    });
    if (!isOk(result)) return result;
    return ok(
      result.value.map((c) => ({
        id: c.id,
        type: c.type,
        front: c.front,
        back: c.back,
        dueAt: c.fsrs.dueAt,
        state: c.fsrs.state,
        stability: c.fsrs.stability,
      }))
    );
  }
}
