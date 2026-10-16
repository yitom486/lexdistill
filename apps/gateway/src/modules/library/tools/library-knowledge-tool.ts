import { z } from 'zod';
import {
  type ToolDefinition,
  type ToolExecutionContext,
  ToolPermissions,
  ToolLocations,
} from '@lexdistill/tool-core';
import { ok, type Result, BusinessError } from '@lexdistill/shared';
import type { ContentRepository } from '../ports.js';
import { KNOWLEDGE_POINT_KINDS } from '@lexdistill/storage-sqlite';

export const LibraryKnowledgePointSchema = z.object({
  concept: z.string().min(1).max(200).describe('知识点概念（归一后的术语或规则名，如“に vs で”）'),
  kind: z
    .enum(KNOWLEDGE_POINT_KINDS)
    .optional()
    .describe('concept=通用概念，vocab_ref=挂词条，grammar_ref=挂文法，rule=用法规则；缺省 concept'),
  explanationMd: z.string().max(4000).optional().describe('讲解正文（Markdown，缺省空串）'),
  sourceRefs: z
    .array(z.string().min(1).max(256))
    .max(32)
    .optional()
    .describe('原文行 id 数组；可空＝悬空知识点，照常可学可考'),
  ord: z.number().int().min(0).optional().describe('课内序号，缺省按传入顺序'),
});

export const LibraryKnowledgeSaveInputSchema = z.object({
  documentId: z.string().min(1).max(128).describe('教材文档 id'),
  lessonId: z.string().min(1).max(128).describe('目录节点 id（课或章）'),
  points: z.array(LibraryKnowledgePointSchema).min(1).max(100).describe('蒸馏知识点（1–100 条）'),
});

export type LibraryKnowledgeSaveInput = z.infer<typeof LibraryKnowledgeSaveInputSchema>;

export interface LibraryKnowledgeSaveOutput {
  saved: number;
  updated: number;
}

/**
 * 目录挂载知识点写入 Server Tool（WRITE：幂等 upsert）。
 * AI 从教材目录/课文提取蒸馏点、用户追问讲解入库时调用；
 * 同键重存刷新释义，不增行，可放心重提。
 */
export class LibraryKnowledgeSaveTool
  implements ToolDefinition<LibraryKnowledgeSaveInput, LibraryKnowledgeSaveOutput>
{
  public readonly name = 'library.save_knowledge_points';
  public readonly description =
    '保存目录挂载的蒸馏知识点（概念+讲解，可悬空原文；同键幂等）。AI 从教材提取知识点或用户追问讲解入库时调用。';
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.WRITE;
  public readonly schema = LibraryKnowledgeSaveInputSchema;

  constructor(private readonly learnerRepo: ContentRepository) {}

  public async execute(
    input: LibraryKnowledgeSaveInput,
    _context: ToolExecutionContext
  ): Promise<Result<LibraryKnowledgeSaveOutput, BusinessError>> {
    void _context;
    return this.learnerRepo.saveKnowledgePoints({
      documentId: input.documentId,
      lessonId: input.lessonId,
      points: input.points.map((p) => ({
        concept: p.concept,
        ...(p.kind ? { kind: p.kind } : {}),
        ...(p.explanationMd !== undefined ? { explanationMd: p.explanationMd } : {}),
        ...(p.sourceRefs ? { sourceRefs: p.sourceRefs } : {}),
        ...(p.ord !== undefined ? { ord: p.ord } : {}),
      })),
    });
  }
}
