import { z } from 'zod';
import {
  type ToolDefinition,
  type ToolExecutionContext,
  ToolPermissions,
  ToolLocations,
} from '@lexdistill/tool-core';
import { ok, isOk, type Result, type BusinessError } from '@lexdistill/shared';
import type { LexiconRepository } from '../ports.js';

export const LearningEncountersInputSchema = z.object({
  userId: z.string().min(1).max(64),
  language: z.enum(['ja', 'en', 'ko']).optional(),
  minExposures: z.number().int().min(1).max(100).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export type LearningEncountersInput = z.infer<typeof LearningEncountersInputSchema>;

export interface EncounterHotTerm {
  headword: string;
  reading?: string | undefined;
  exposureCount: number;
  lastSeenAt: string;
}

export interface LearningEncountersOutput {
  /** 见过词总数（该语种） */
  seen: number;
  /** 已收藏数 */
  collected: number;
  /** 见过≥阈值但未收藏数 */
  uncollectedHot: number;
  /** 最热的未收藏词（按相遇次数倒序；只有词面/读音，无释义——释义走 dictionary.lookup 现查） */
  hot: EncounterHotTerm[];
}

/**
 * 相遇词信号 Server Tool（READ）。
 * 存储在词典域（随查词/收藏漏斗写），消费方是学习闭环，故挂 learning.* 命名。
 * Agent 伴学/复习规划时调用：提醒用户收词（“这个词你见过 5 次了”），
 * 或拿词面去查词典后再组回炉话题。绝不编造释义。
 */
export class LearningEncountersTool
  implements ToolDefinition<LearningEncountersInput, LearningEncountersOutput>
{
  public readonly name = 'learning.encounters';
  public readonly description =
    '读取用户见过多次但未收藏的词（相遇词信号）。伴学提醒收词、规划回炉时调用；只给词面与次数，无释义。';
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.READ;
  public readonly schema = LearningEncountersInputSchema;

  constructor(private readonly learnerRepo: LexiconRepository) {}

  public async execute(
    input: LearningEncountersInput,
    _context: ToolExecutionContext
  ): Promise<Result<LearningEncountersOutput, BusinessError>> {
    void _context;
    const minExposures = input.minExposures ?? 3;
    const limit = input.limit ?? 10;
    const result = await this.learnerRepo.listEncounteredTerms(
      input.userId,
      input.language ?? 'ja',
      100
    );
    if (!isOk(result)) return result;
    const terms = result.value;
    const hot = terms
      .filter((t) => t.status === 'new' && t.exposureCount >= minExposures)
      .sort((a, b) => b.exposureCount - a.exposureCount)
      .slice(0, limit)
      .map((t): EncounterHotTerm => ({
        headword: t.headword,
        exposureCount: t.exposureCount,
        lastSeenAt: t.lastSeenAt,
        ...(t.reading ? { reading: t.reading } : {}),
      }));
    return ok({
      seen: terms.length,
      collected: terms.filter((t) => t.status !== 'new').length,
      uncollectedHot: terms.filter((t) => t.status === 'new' && t.exposureCount >= minExposures)
        .length,
      hot,
    });
  }
}
