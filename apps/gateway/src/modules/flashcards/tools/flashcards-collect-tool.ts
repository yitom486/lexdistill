import { z } from 'zod';
import {
  type ToolDefinition,
  type ToolExecutionContext,
  ToolPermissions,
  ToolLocations,
} from '@study-studio/tool-core';
import { ok, isOk, type Result, type BusinessError } from '@study-studio/shared';
import type { LexiconRepository } from '../../dictionary/ports.js';
import type { DictionaryEntryCollection } from '../../dictionary/public.js';

export const FlashcardsCollectInputSchema = z.object({
  userId: z.string().min(1).max(64),
  entryId: z.string().min(1).max(256),
});

export type FlashcardsCollectInput = z.infer<typeof FlashcardsCollectInputSchema>;

/**
 * 生词收藏 Server Tool（WRITE）。
 * 把本地词典条目收为用户 FSRS 生词卡（去重：已收返回 created=false）。
 * 与查词面板“加入生词本”同一命令，保证 AI 与人行为一致。
 */
export class FlashcardsCollectTool
  implements ToolDefinition<FlashcardsCollectInput, DictionaryEntryCollection>
{
  public readonly name = 'flashcards.collect';
  public readonly description =
    '把词典条目加入用户生词本（FSRS 卡，去重）。AI 备课、阅读伴学中替用户收藏生词时调用。';
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.WRITE;
  public readonly schema = FlashcardsCollectInputSchema;

  constructor(private readonly learnerRepo: LexiconRepository) {}

  public async execute(
    input: FlashcardsCollectInput,
    _context: ToolExecutionContext
  ): Promise<Result<DictionaryEntryCollection, BusinessError>> {
    void _context;
    const result = await this.learnerRepo.collectDictionaryEntry(input.userId, input.entryId);
    if (!isOk(result)) return result;
    return ok(result.value);
  }
}
