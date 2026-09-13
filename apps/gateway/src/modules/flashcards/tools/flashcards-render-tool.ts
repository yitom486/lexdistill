import { z } from 'zod';
import {
  type ToolDefinition,
  type ToolExecutionContext,
  ToolPermissions,
  ToolLocations,
} from '@study-studio/tool-core';
import { ok, err, type Result, BusinessError } from '@study-studio/shared';
import type { RenderedCard, AnkiCardFormat } from '@study-studio/flashcard-core';
import type { FlashcardsRepository } from '../ports.js';
import { narrowCardSourceEntry } from '../application/card-preview.js';
import { narrowSaveCardFormatInput } from '../persistence/card-formats.js';

export const FlashcardsRenderInputSchema = z.object({
  /** 已存模板 id（与 inlineFormat 二选一；都不给则用内置 study-basic）。 */
  formatId: z.string().min(1).max(64).optional(),
  /** 未保存的模板草稿（只渲染不入库）。 */
  inlineFormat: z.unknown().optional(),
  entry: z.object({
    headword: z.string().trim().min(1).max(128),
    reading: z.string().max(128).optional(),
    meanings: z.array(z.string()).min(1).max(24),
    partOfSpeech: z.string().max(64).optional(),
    pitchLabel: z.string().max(256).optional(),
    frequency: z.number().optional(),
    sentence: z.string().max(1000).optional(),
    sourceUrl: z.string().max(500).optional(),
    tags: z.array(z.string()).max(16).optional(),
  }),
});

export type FlashcardsRenderInput = z.infer<typeof FlashcardsRenderInputSchema>;

export interface FlashcardsRenderOutput {
  format: AnkiCardFormat;
  rendered: RenderedCard;
  issues: string[];
}

/**
 * 卡片渲染 Server Tool（READ）。
 * AI 生成/批改卡片前先验算呈现效果；与 HTTP 预览同命令，保证所见即所得。
 */
export class FlashcardsRenderTool
  implements ToolDefinition<FlashcardsRenderInput, FlashcardsRenderOutput>
{
  public readonly name = 'flashcards.render';
  public readonly description =
    '按卡片模板渲染条目为字段/正反面 HTML（只渲染不入库）。AI 写卡前验算呈现；模板问题随 issues 返回。';
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.READ;
  public readonly schema = FlashcardsRenderInputSchema;

  constructor(private readonly learnerRepo: FlashcardsRepository) {}

  public async execute(
    input: FlashcardsRenderInput,
    _context: ToolExecutionContext
  ): Promise<Result<FlashcardsRenderOutput, BusinessError>> {
    void _context;
    const entry = narrowCardSourceEntry(input.entry);
    if (!entry) {
      return err(
        new BusinessError(
          'E_INVALID_INPUT',
          '预览条目不正确：需要 headword 与 meanings',
          'VALIDATION',
          false
        )
      );
    }
    let inlineFormat: AnkiCardFormat | undefined;
    if (input.inlineFormat && typeof input.inlineFormat === 'object') {
      const narrowed = narrowSaveCardFormatInput(input.inlineFormat);
      if (!narrowed) {
        return err(
          new BusinessError(
            'E_INVALID_INPUT',
            '模板草稿结构不正确，请检查字段后重试',
            'VALIDATION',
            false
          )
        );
      }
      inlineFormat = {
        id: narrowed.id,
        name: narrowed.name,
        entryType: narrowed.entryType ?? 'term',
        fields: narrowed.fields,
        frontTemplate: narrowed.frontTemplate,
        backTemplate: narrowed.backTemplate,
        css: narrowed.css,
        templateVersion: 0,
        userModified: true,
        ...(narrowed.deckName ? { deckName: narrowed.deckName } : {}),
        ...(narrowed.modelName ? { modelName: narrowed.modelName } : {}),
      };
    }
    const result = await this.learnerRepo.previewCardFormat({
      ...(input.formatId ? { formatId: input.formatId } : {}),
      ...(inlineFormat ? { inlineFormat } : {}),
      entry,
    });
    if (!result.ok) return result;
    return ok({
      format: result.value.format,
      rendered: result.value.rendered,
      issues: result.value.issues,
    });
  }
}
