import { z } from 'zod';
import {
  type ToolDefinition,
  type ToolExecutionContext,
  ToolPermissions,
  ToolLocations,
} from '@study-studio/tool-core';
import { ok, err, type Result, BusinessError, isOk } from '@study-studio/shared';
import type { HangulItem, KanaItem } from '@study-studio/protocol';
import type { ContentRepository } from '../../library/ports.js';
import { lookupPitchEntries, PITCH_LEXICON, type PitchLexiconEntry } from '../../../infrastructure/db/seeds/pitch-seed.js';

export const LearningCurriculumInputSchema = z.object({
  action: z.enum([
    'get_kana_chart',
    'get_hangul_chart',
    'search_entry',
    'list_pitch_benchmarks',
    'lookup_pitch',
  ]),
  filters: z
    .object({
      type: z.string().optional(),
      query: z.string().optional(),
    })
    .optional(),
});

export type LearningCurriculumInput = z.infer<typeof LearningCurriculumInputSchema>;

export class LearningCurriculumTool
  implements
    ToolDefinition<
      LearningCurriculumInput,
      {
        action: string;
        kana?: KanaItem[];
        hangul?: HangulItem[];
        matched?: KanaItem[];
        pitchEntries?: PitchLexiconEntry[];
      }
    >
{
  public readonly name = 'learning.curriculum';
  public readonly description =
    '只读课程资产：五十音表、谚文字母表、假名检索、声调基准词表。禁止由模型编造假名/谚文/声调。';
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.READ;
  public readonly schema = LearningCurriculumInputSchema;

  constructor(private readonly learnerRepo: ContentRepository) {}

  public async execute(
    input: LearningCurriculumInput,
    _context: ToolExecutionContext
  ): Promise<
    Result<
      {
        action: string;
        kana?: KanaItem[];
        hangul?: HangulItem[];
        matched?: KanaItem[];
        pitchEntries?: PitchLexiconEntry[];
      },
      BusinessError
    >
  > {
    if (input.action === 'get_kana_chart') {
      const res = await this.learnerRepo.getCurriculumKana(input.filters?.type);
      if (!isOk(res)) return res;
      return ok({ action: input.action, kana: res.value });
    }

    if (input.action === 'get_hangul_chart') {
      const res = await this.learnerRepo.getCurriculumHangul(input.filters?.type);
      if (!isOk(res)) return res;
      return ok({ action: input.action, hangul: res.value });
    }

    if (input.action === 'search_entry') {
      const res = await this.learnerRepo.getCurriculumKana();
      if (!isOk(res)) return res;
      const q = (input.filters?.query || '').trim().toLowerCase();
      const matched = q
        ? res.value.filter(
            (k) =>
              k.hiragana.includes(q) ||
              k.katakana.includes(q) ||
              k.romaji.toLowerCase().includes(q)
          )
        : res.value.slice(0, 20);
      return ok({ action: input.action, matched });
    }

    if (input.action === 'list_pitch_benchmarks') {
      return ok({ action: input.action, pitchEntries: [...PITCH_LEXICON] });
    }

    if (input.action === 'lookup_pitch') {
      const q = input.filters?.query || '';
      return ok({ action: input.action, pitchEntries: lookupPitchEntries(q) });
    }

    return err(new BusinessError('E_INVALID_INPUT', '未知 curriculum action', 'VALIDATION'));
  }
}
