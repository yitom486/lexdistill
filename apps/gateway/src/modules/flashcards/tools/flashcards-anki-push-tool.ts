import { z } from 'zod';
import {
  type ToolDefinition,
  type ToolExecutionContext,
  ToolPermissions,
  ToolLocations,
} from '@lexdistill/tool-core';
import { ok, type Result, type BusinessError } from '@lexdistill/shared';
import type { FlashcardsRepository } from '../ports.js';
import type { AnkiPushResult } from '../application/anki-push.js';

const AnkiPushTtsSchema = z.object({
  provider: z.string().min(1).max(32),
  baseUrl: z.string().max(256).optional(),
  region: z.string().max(64).optional(),
  apiKey: z.string().max(512).optional(),
  voice: z.string().max(128).optional(),
  model: z.string().max(128).optional(),
  rate: z.number().optional(),
  gender: z.enum(['FEMALE', 'MALE']).optional(),
});

export const FlashcardsAnkiPushInputSchema = z.object({
  userId: z.string().min(1).max(64),
  cardId: z.string().min(1).max(128),
  formatId: z.string().min(1).max(64).optional(),
  deckName: z.string().min(1).max(64).optional(),
  /** TTS 凭证仅本次调用内存，网关永不落盘；不提供则音频字段留空。 */
  tts: AnkiPushTtsSchema.optional(),
});

export type FlashcardsAnkiPushInput = z.infer<typeof FlashcardsAnkiPushInputSchema>;

/**
 * 生词卡推送本机 Anki（WRITE，默认因开关关闭而拒绝）。
 * AI 调用前须经用户审批；与 HTTP 推送同命令，保证行为一致。
 */
export class FlashcardsAnkiPushTool
  implements ToolDefinition<FlashcardsAnkiPushInput, AnkiPushResult>
{
  public readonly name = 'flashcards.anki_push';
  public readonly description =
    '把用户生词本中的卡片推送到本机 Anki（需用户先在设置中启用；音频需随调用提供 TTS 凭证）。';
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.WRITE;
  public readonly schema = FlashcardsAnkiPushInputSchema;

  constructor(private readonly learnerRepo: FlashcardsRepository) {}

  public async execute(
    input: FlashcardsAnkiPushInput,
    _context: ToolExecutionContext
  ): Promise<Result<AnkiPushResult, BusinessError>> {
    void _context;
    const result = await this.learnerRepo.pushCardToAnki({
      userId: input.userId,
      cardId: input.cardId,
      ...(input.formatId ? { formatId: input.formatId } : {}),
      ...(input.deckName ? { deckName: input.deckName } : {}),
      ...(input.tts ? { tts: input.tts } : {}),
    });
    if (!result.ok) return result;
    return ok(result.value);
  }
}
