import { z } from 'zod';
import {
  type ToolDefinition,
  type ToolExecutionContext,
  ToolPermissions,
  ToolLocations,
} from '@study-studio/tool-core';
import { ok, err, isOk, type Result, BusinessError } from '@study-studio/shared';
import type { LearningRepository } from '../../practice/ports.js';
import type { LearnerRepository } from '@study-studio/learner-core';

export const MistakesResolveInputSchema = z.object({
  userId: z.string().min(1).max(64),
  mistakeId: z.string().min(1).max(128),
});

export type MistakesResolveInput = z.infer<typeof MistakesResolveInputSchema>;

/**
 * 错题攻克 Server Tool（WRITE）。
 * 归属校验：错题须属于该用户，否则拒绝（防跨用户写入）。
 */
export class MistakesResolveTool
  implements ToolDefinition<MistakesResolveInput, { mistakeId: string; resolved: boolean }>
{
  public readonly name = 'mistakes.resolve';
  public readonly description = '将一条错题标为已攻克（须属于该用户）。AI 批改确认掌握后调用。';
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.WRITE;
  public readonly schema = MistakesResolveInputSchema;

  constructor(private readonly learnerRepo: LearningRepository & LearnerRepository) {}

  public async execute(
    input: MistakesResolveInput,
    _context: ToolExecutionContext
  ): Promise<Result<{ mistakeId: string; resolved: boolean }, BusinessError>> {
    void _context;
    const list = await this.learnerRepo.getMistakes(input.userId);
    if (!isOk(list)) return list;
    if (!list.value.some((m) => m.id === input.mistakeId)) {
      return err(
        new BusinessError('E_NOT_FOUND', '该错题不存在或不属于你', 'LEARNER_STATE', false)
      );
    }
    const resolved = await this.learnerRepo.resolveMistake(input.mistakeId);
    if (!isOk(resolved)) return resolved;
    return ok({ mistakeId: input.mistakeId, resolved: true });
  }
}
