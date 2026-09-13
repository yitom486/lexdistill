import { z } from 'zod';
import {
  type ToolDefinition,
  type ToolExecutionContext,
  ToolPermissions,
  ToolLocations,
} from '@study-studio/tool-core';
import { ok, type Result, BusinessError, isOk } from '@study-studio/shared';
import type { LexiconRepository } from '../ports.js';
import type { LocalDictionaryEntry } from '../persistence/dictionary.js';
import type { TargetLanguage } from '@study-studio/learner-core';
import { buildOjadSearchUrl } from '../application/dictionary-external-links.js';

export const DictionaryLookupInputSchema = z.object({
  language: z.enum(['ja', 'en', 'ko']),
  query: z.string().trim().min(1).max(64),
});

export type DictionaryLookupInput = z.infer<typeof DictionaryLookupInputSchema>;

export interface DictionaryExternalLookup {
  provider: 'OJAD';
  url: string;
  opensExternally: true;
}

export interface DictionaryLookupOutput {
  entries: LocalDictionaryEntry[];
  externalLookup?: DictionaryExternalLookup | undefined;
}

/**
 * 本地可再分发词典的统一读取入口。
 *
 * OJAD 仅作为日语未命中时的用户主动外部检索深链：不请求、不爬取、不缓存其页面内容。
 */
export class DictionaryLookupTool
  implements ToolDefinition<DictionaryLookupInput, DictionaryLookupOutput>
{
  public readonly name = 'dictionary.lookup';
  public readonly description =
    '查询本地词典资产。日语未命中时仅返回可由用户主动打开的 OJAD 检索深链；绝不抓取 OJAD。';
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.READ;
  public readonly schema = DictionaryLookupInputSchema;

  constructor(private readonly learnerRepo: LexiconRepository) {}

  public async execute(
    input: DictionaryLookupInput,
    context: ToolExecutionContext
  ): Promise<Result<DictionaryLookupOutput, BusinessError>> {
    const result = await this.learnerRepo.searchLocalDictionary(
      input.language as TargetLanguage,
      input.query
    );
    if (!isOk(result)) return result;

    // 查词历史（画像信号；伪用户不记；失败静默不影响主路径）
    // 相遇词弱信号（见过）与 history 同 provenance、同定级：只记真人发起的查词。
    if (context.userId && context.userId !== 'dictionary_http') {
      const entries = result.value;
      void this.learnerRepo
        .recordDictionarySearch(
          context.userId,
          input.language as TargetLanguage,
          input.query,
          entries.length,
          entries[0]?.id
        )
        .catch(() => {});
      const top = entries[0];
      if (top) {
        void this.learnerRepo
          .recordTermExposure({
            userId: context.userId,
            language: input.language,
            headword: top.headword,
            ...(top.reading ? { reading: top.reading } : {}),
            source: 'lookup',
          })
          .catch(() => {});
      }
    }

    const externalUrl =
      result.value.length === 0 && input.language === 'ja'
        ? buildOjadSearchUrl(input.query)
        : undefined;

    return ok({
      entries: result.value,
      ...(externalUrl
        ? {
            externalLookup: {
              provider: 'OJAD' as const,
              url: externalUrl,
              opensExternally: true as const,
            },
          }
        : {}),
    });
  }
}
