import { z } from 'zod';
import {
  type ToolDefinition,
  type ToolExecutionContext,
  ToolLocations,
  ToolPermissions,
} from '@study-studio/tool-core';
import { BusinessError, err, ok, type Result } from '@study-studio/shared';
import { TocLevelSchema, validateTocPageOrder, type TocEntry } from '@study-studio/document-model';

export const ProposedTocEntrySchema = z.object({
  parentIndex: z.number().int().nonnegative().optional().describe(
    '父节点在 entries 中的从 0 开始的下标：lesson 指向所属 unit（若教材无单元外壳则省略）；section 指向所属直接主课；顶层单元省略'
  ),
  title: z.string().trim().min(1).describe(
    '目录中印刷的条目标题原文（保持原文，包括课次名称、课下次级句型/语法条目、对话会话主题、复习测试等）'
  ),
  level: TocLevelSchema.describe(
    '目录语义类型枚举：unit(单元外壳)、lesson(核心成课或与课平齐的单元总结/独立学习切分面)、section(课内附属小节，如会话主题、语法点等)'
  ),
  startPage: z.number().int().positive().describe(
    '条目对应的教材印刷起始页码（正整数）。若课内次级条目与所属成课同页，填入同页页码。'
  ),
  endPage: z.number().int().positive().optional().describe('印刷结束页码（看不清或未标明时省略）'),
}).strict();

export const ProposedTocSchema = z.object({
  title: z.string().trim().min(1).optional().describe('教材标题；目录页未写明时省略'),
  tocEndPage: z.number().int().positive().describe('实际目录最后一页在原 PDF 中的物理页码；不是提供文件的结束页'),
  pageOffset: z.number().int().optional().describe('已从页面实际确认的物理页减印刷页偏移；无法确认则省略'),
  entries: z.array(ProposedTocEntrySchema).min(1).describe('按目录页阅读顺序列出的完整条目'),
}).strict();

export type ProposedToc = z.infer<typeof ProposedTocSchema>;

interface ActiveProposal {
  userId: string;
  value: ProposedToc | null;
  physicalPages?: readonly number[];
  onValidation?: (result: { accepted: boolean; code?: string; entryCount?: number; callId?: string; message?: string }) => void;
}

/** 目录识别专用草稿工具：模型可提交、检查并修正草稿；绝不写入学习资产。 */
export class LibraryProposeTocTool implements ToolDefinition<ProposedToc, ProposedToc> {
  readonly name = 'library.propose_toc';
  readonly description =
    '提交当前 PDF 中的树状目录草稿，父子关系用 parentIndex；条目使用印刷页码，tocEndPage 使用实际目录末页的原 PDF 物理页码。没有目录时说明问题，不编造。草稿不入库。';
  readonly location = ToolLocations.SERVER;
  readonly permission = ToolPermissions.READ;
  readonly schema = ProposedTocSchema;

  private readonly active = new Map<string, ActiveProposal>();

  begin(
    sessionId: string,
    userId: string,
    onValidation?: ActiveProposal['onValidation'],
    physicalPages?: readonly number[]
  ): void {
    this.active.set(sessionId, {
      userId,
      value: null,
      ...(physicalPages ? { physicalPages } : {}),
      ...(onValidation ? { onValidation } : {}),
    });
  }

  take(sessionId: string): ProposedToc | null {
    return this.active.get(sessionId)?.value ?? null;
  }

  end(sessionId: string): void {
    this.active.delete(sessionId);
  }

  async execute(
    input: ProposedToc,
    context: ToolExecutionContext
  ): Promise<Result<ProposedToc, BusinessError>> {
    const active = this.active.get(context.sessionId);
    if (!active || active.userId !== context.userId) {
      return err(new BusinessError('E_TOC_SESSION_INVALID', '目录草稿会话已失效，请重新识别', 'VALIDATION'));
    }
    active.value = null;
    // Adapter 的原生工具回调不经过 ToolRegistry.execute；此处必须再次收窄参数。
    const parsed = this.schema.safeParse(input);
    if (!parsed.success) {
      active.onValidation?.({ accepted: false, code: 'E_LLM_SCHEMA_INVALID' });
      return err(new BusinessError('E_LLM_SCHEMA_INVALID', '目录草稿字段不完整，请按工具说明补齐条目和实际目录结束页', 'VALIDATION', true));
    }
    const value = parsed.data;
    if (active.physicalPages && !active.physicalPages.includes(value.tocEndPage)) {
      active.onValidation?.({ accepted: false, code: 'E_TOC_RANGE_INVALID', message: 'tocEndPage 必须是本次文件中实际目录末页的原 PDF 物理页码' });
      return err(new BusinessError('E_TOC_RANGE_INVALID', 'tocEndPage 超出本次文件，请核对原 PDF 物理页码后修正', 'VALIDATION', true));
    }
    for (let index = 0; index < value.entries.length; index++) {
      let parent = value.entries[index]!.parentIndex;
      const visited = new Set([index]);
      while (parent !== undefined) {
        if (!value.entries[parent] || visited.has(parent)) {
          active.onValidation?.({ accepted: false, code: 'E_TOC_HIERARCHY_INVALID', message: `目录第 ${index + 1} 项的父节点不存在或形成循环`, ...(context.callId ? { callId: context.callId } : {}) });
          return err(new BusinessError('E_TOC_HIERARCHY_INVALID', '目录父节点不存在或形成循环，请核对层级', 'VALIDATION', true));
        }
        visited.add(parent); parent = value.entries[parent]!.parentIndex;
      }
    }
    const entries: TocEntry[] = value.entries.map((entry, index) => ({
      id: `toc-${index + 1}`,
      level: entry.level,
      title: entry.title,
      startPage: entry.startPage,
      ...(entry.parentIndex !== undefined ? { parentId: `toc-${entry.parentIndex + 1}` } : {}),
      ...(entry.endPage !== undefined ? { endPage: entry.endPage } : {}),
    }));
    // 这里校验的是印刷页码；物理页映射必须由后续确认流程单独完成。
    const validated = validateTocPageOrder(entries);
    if (!validated.ok) {
      active.onValidation?.({ accepted: false, code: validated.error.code });
      return err(validated.error);
    }
    for (let index = 1; index < entries.length; index++) {
      if (entries[index]!.startPage < entries[index - 1]!.startPage) {
        active.onValidation?.({ accepted: false, code: 'E_TOC_PAGE_ORDER_INVALID' });
        return err(new BusinessError(
          'E_TOC_PAGE_ORDER_INVALID',
          `目录第 ${index + 1} 条的印刷页码倒退，请核对目录PDF`,
          'VALIDATION'
        ));
      }
    }
    active.value = value;
    active.onValidation?.({ accepted: true, entryCount: entries.length });
    return ok(value);
  }
}
