import { z } from 'zod';
import {
  type ToolDefinition,
  type ToolExecutionContext,
  ToolPermissions,
  ToolLocations,
} from '@study-studio/tool-core';
import { ok, isOk, type Result, type BusinessError } from '@study-studio/shared';
import type { FlashcardsRepository } from '../ports.js';
import type {
  CardDraft,
  ProposeCardDraftInput,
} from '../persistence/card-drafts.js';

const DraftSourceSchema = z.enum(['ai-enrich', 'agent', 'import']);
const DraftKindSchema = z.enum(['word', 'sentence']).optional();
const DraftCardTypeSchema = z.enum(['VOCABULARY', 'GRAMMAR', 'CONFUSION_PAIR', 'SENTENCE']).optional();

const DraftItemSchema = z.object({
  language: z.enum(['ja', 'en', 'ko']),
  headword: z.string().min(1).max(500),
  reading: z.string().max(64).optional(),
  meanings: z.array(z.string()).min(1).max(12),
  partOfSpeech: z.string().max(32).optional(),
  source: DraftSourceSchema,
  sourceRef: z.string().max(256).optional(),
  kind: DraftKindSchema,
  cardType: DraftCardTypeSchema,
  /** P4-1 选区关联（可选；归属由 Repository 校验）。 */
  selectionContextId: z.string().min(1).max(64).optional(),
});

const DraftProposeSchema = z.object({
  userId: z.string().min(1).max(64),
  drafts: z.array(DraftItemSchema).min(1).max(50),
});

export type FlashcardsDraftProposeInput = z.infer<typeof DraftProposeSchema>;

/**
 * 生词草稿提议 Server Tool（WRITE）。
 * AI 备课/阅读伴学中把候选生词先放草稿箱（幂等去重），等人逐条确认再入库。
 * 用户已改过的 pending 草稿不会被覆写。
 */
export class FlashcardsDraftProposeTool
  implements ToolDefinition<FlashcardsDraftProposeInput, CardDraft[]>
{
  public readonly name = 'flashcards.draft_propose';
  public readonly description =
    '把候选生词放入草稿箱待用户确认（幂等去重，不直接建卡）。AI 备课、阅读伴学中整理生词时调用。';
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.WRITE;
  public readonly schema = DraftProposeSchema;

  constructor(private readonly learnerRepo: FlashcardsRepository) {}

  public async execute(
    input: FlashcardsDraftProposeInput,
    _context: ToolExecutionContext
  ): Promise<Result<CardDraft[], BusinessError>> {
    void _context;
    const withUser: ProposeCardDraftInput[] = input.drafts.map((d) => ({
      userId: input.userId,
      language: d.language,
      headword: d.headword,
      meanings: d.meanings,
      source: d.source,
      ...(d.reading !== undefined ? { reading: d.reading } : {}),
      ...(d.partOfSpeech !== undefined ? { partOfSpeech: d.partOfSpeech } : {}),
      ...(d.sourceRef !== undefined ? { sourceRef: d.sourceRef } : {}),
      ...(d.selectionContextId !== undefined ? { selectionContextId: d.selectionContextId } : {}),
    }));
    return this.learnerRepo.proposeCardDrafts(withUser);
  }
}

const DraftsListSchema = z.object({
  userId: z.string().min(1).max(64),
  language: z.enum(['ja', 'en', 'ko']).optional(),
  status: z.enum(['pending', 'accepted', 'dismissed']).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export type FlashcardsDraftsListInput = z.infer<typeof DraftsListSchema>;

/** 草稿箱列表 Server Tool（READ）：待确认/已接受/已驳回。 */
export class FlashcardsDraftsListTool
  implements ToolDefinition<FlashcardsDraftsListInput, CardDraft[]>
{
  public readonly name = 'flashcards.drafts_list';
  public readonly description = '读取用户生词草稿箱（默认待确认）。向用户汇报待确认事项时调用。';
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.READ;
  public readonly schema = DraftsListSchema;

  constructor(private readonly learnerRepo: FlashcardsRepository) {}

  public async execute(
    input: FlashcardsDraftsListInput,
    _context: ToolExecutionContext
  ): Promise<Result<CardDraft[], BusinessError>> {
    void _context;
    const result = await this.learnerRepo.listCardDrafts(
      input.userId,
      input.language ?? 'ja',
      input.status ?? 'pending',
      input.limit ?? 50
    );
    if (!isOk(result)) return result;
    return ok(result.value);
  }
}

/**
 * 草稿接受入库 Server Tool（WRITE）。
 * 用户明确说“接受/确认入库”时调用；建卡 + 相遇词回填与收藏漏斗同级。
 */
export class FlashcardsDraftAcceptTool
  implements ToolDefinition<{ userId: string; draftId: string }, { draft: CardDraft; cardId: string }>
{
  public readonly name = 'flashcards.draft_accept';
  public readonly description =
    '接受一条生词草稿并建成正式闪卡（用户已明确确认时调用；用改后字段建卡）。';
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.WRITE;
  public readonly schema = z.object({
    userId: z.string().min(1).max(64),
    draftId: z.string().min(1).max(64),
  });

  constructor(private readonly learnerRepo: FlashcardsRepository) {}

  public async execute(
    input: { userId: string; draftId: string },
    _context: ToolExecutionContext
  ): Promise<Result<{ draft: CardDraft; cardId: string }, BusinessError>> {
    void _context;
    return this.learnerRepo.acceptCardDraft(input.userId, input.draftId);
  }
}

/**
 * 草稿驳回 Server Tool（WRITE）。用户明确说“不要/丢弃”时调用；保留审计行。
 */
export class FlashcardsDraftDismissTool
  implements ToolDefinition<{ userId: string; draftId: string }, CardDraft>
{
  public readonly name = 'flashcards.draft_dismiss';
  public readonly description = '驳回一条生词草稿（用户明确不要时调用）。';
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.WRITE;
  public readonly schema = z.object({
    userId: z.string().min(1).max(64),
    draftId: z.string().min(1).max(64),
  });

  constructor(private readonly learnerRepo: FlashcardsRepository) {}

  public async execute(
    input: { userId: string; draftId: string },
    _context: ToolExecutionContext
  ): Promise<Result<CardDraft, BusinessError>> {
    void _context;
    return this.learnerRepo.dismissCardDraft(input.userId, input.draftId);
  }
}
