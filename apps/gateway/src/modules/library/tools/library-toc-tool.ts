import { z } from 'zod';
import {
  type ToolDefinition,
  type ToolExecutionContext,
  ToolPermissions,
  ToolLocations,
} from '@lexdistill/tool-core';
import { ok, type Result, BusinessError } from '@lexdistill/shared';
import type { ContentRepository } from '../ports.js';
import { TocLevelSchema } from '@lexdistill/document-model';

export const LibrarySubmitTocInputSchema = z.object({
  documentId: z.string().min(1).describe('所属教材文档ID'),
  userId: z.string().min(1).describe('操作用户ID'),
  title: z.string().min(1).describe('教材全名'),
  language: z.enum(['ja', 'en', 'ko']).optional().describe('目标语言，默认 ja'),
  entries: z
    .array(
      z.object({
        id: z.string().min(1).describe('章节唯一槽位ID，如 l1, l2, ch1, u1'),
        level: TocLevelSchema.describe(
          '目录层级枚举：unit(单元/大篇)|chapter(章)|lesson(核心课次/Day)|section(节/课内细目)'
        ),
        title: z.string().min(1).describe('标准标题'),
        startPage: z.number().int().positive().describe('教材真实起始物理页码（必须为严格递增的正整数）'),
        endPage: z.number().int().positive().optional().describe('教材真实结束物理页码（可选）'),
        parentId: z.string().optional().describe('父级节点ID（用于树形目录折叠）'),
      })
    )
    .min(1)
    .describe('大模型多图视觉识别后整理出的全书层级目录条目列表'),
});

export type LibrarySubmitTocInput = z.infer<typeof LibrarySubmitTocInputSchema>;

export interface LibrarySubmitTocOutput {
  success: boolean;
  documentId: string;
  title: string;
  lessonCount: number;
  totalEntries: number;
  minPage: number;
  maxPage: number;
  message: string;
}

/**
 * 教材多图目录识别提交与优先落库工具（Native Server Tool）：
 * - 专供视觉大模型识别 5~6 张目录图片后调用；
 * - 强制执行页码严格单调递增自动校验（E_TOC_PAGE_ORDER_INVALID）；
 * - 校验通过后，原子创建 documents 元数据并批量预置全量待填充章节槽位（status='pending'）；
 * - 优先落库后，整书骨架秒级呈现，并成为后续所有章节并发提炼任务的基准真理锚点。
 */
export class LibrarySubmitTocTool implements ToolDefinition<LibrarySubmitTocInput, LibrarySubmitTocOutput> {
  public readonly name = 'library.submit_toc';
  public readonly description =
    '视觉大模型识别多张教材目录页图片后调用此工具提交目录。后端将自动执行页码严格单调递增校验，并通过同一事务完成全书章节槽位的优先落库。';
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.WRITE;
  public readonly schema = LibrarySubmitTocInputSchema;

  constructor(private readonly repo: ContentRepository) {}

  public async execute(
    input: LibrarySubmitTocInput,
    _context: ToolExecutionContext
  ): Promise<Result<LibrarySubmitTocOutput, BusinessError>> {
    void _context;

    const result = await this.repo.seedTextbookTocSkeleton({
      documentId: input.documentId,
      userId: input.userId,
      title: input.title,
      language: input.language,
      entries: input.entries,
    });

    if (!result.ok) {
      return result;
    }

    return ok({
      success: true,
      documentId: result.value.documentId,
      title: result.value.title,
      lessonCount: result.value.lessonCount,
      totalEntries: result.value.totalEntries,
      minPage: result.value.minPage,
      maxPage: result.value.maxPage,
      message: `目录成功落库！共识别 ${result.value.totalEntries} 个条目（含 ${result.value.lessonCount} 节核心课次），页码范围 P${result.value.minPage}~P${result.value.maxPage}。全量槽位已就绪，可开展后续章节并发提炼。`,
    });
  }
}
