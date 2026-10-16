import { z } from 'zod';
import {
  type ToolDefinition,
  type ToolExecutionContext,
  ToolPermissions,
  ToolLocations,
} from '@lexdistill/tool-core';
import { ok, isOk, type Result, type BusinessError } from '@lexdistill/shared';
import type { MistakeEntry } from '@lexdistill/learner-core';
import type { LearnerRepository } from '@lexdistill/learner-core';

export const MistakesListInputSchema = z.object({
  userId: z.string().min(1).max(64),
  resolved: z.boolean().optional(),
  language: z.enum(['ja', 'en', 'ko']).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export type MistakesListInput = z.infer<typeof MistakesListInputSchema>;

/**
 * 错题本读取 Server Tool（READ）。
 * AI 分析薄弱点、组回炉卷前先读错题（题目+作答+批改全量返回，上限 50）。
 */
export class MistakesListTool implements ToolDefinition<MistakesListInput, MistakeEntry[]> {
  public readonly name = 'mistakes.list';
  public readonly description =
    '读取用户错题本（含题目、作答、批改结果）。AI 组回炉复习与薄弱分析的数据入口。';
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.READ;
  public readonly schema = MistakesListInputSchema;

  constructor(private readonly learnerRepo: LearnerRepository) {}

  public async execute(
    input: MistakesListInput,
    _context: ToolExecutionContext
  ): Promise<Result<MistakeEntry[], BusinessError>> {
    void _context;
    const result = await this.learnerRepo.getMistakes(input.userId, {
      ...(input.resolved !== undefined ? { resolved: input.resolved } : {}),
      ...(input.language ? { language: input.language } : {}),
    });
    if (!isOk(result)) return result;
    return ok(result.value.slice(0, input.limit ?? 20));
  }
}
