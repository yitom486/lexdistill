import { z } from 'zod';
import { ok, err, Result, BusinessError } from '@study-studio/shared';
import { planTextbookTasks } from './textbook-tasks.js';

/**
 * 教材目录层级枚举（语义枚举）：
 * - unit: 单元 / Part / 编（顶级容器）
 * - chapter: 章 / 篇（中级聚合容器）
 * - lesson: 课 / 主题单元 / Day（核心学习实体，承载生词与语法）
 * - section: 节 / 课内细分模块（如会话、语法讲义、课后练习）
 */
export const TocLevelSchema = z.enum(['unit', 'chapter', 'lesson', 'section']);
export type TocLevel = z.infer<typeof TocLevelSchema>;

export const TocEntrySchema = z.object({
  id: z.string().min(1).describe('条目唯一标识，如 l1, ch1, u1'),
  level: TocLevelSchema.describe('目录层级：unit | chapter | lesson | section'),
  title: z.string().min(1).describe('章节标题（去除前后空格）'),
  startPage: z.number().int().positive().describe('教材真实起始页码（正整数）'),
  endPage: z.number().int().positive().optional().describe('教材真实结束页码（可选）'),
  parentId: z.string().optional().describe('父级节点ID（用于多级目录树）'),
});
export type TocEntry = z.infer<typeof TocEntrySchema>;

/** 用户确认后的独立目录保存；页码已换算为 PDF 物理页。 */
export const SaveTextbookOutlineRequestSchema = z.object({
  traceId: z.string().min(1).optional(),
  documentId: z.string().min(1).optional(),
  title: z.string().trim().min(1),
  filePath: z.string().trim().min(1),
  language: z.enum(['ja', 'en', 'ko']),
  tocEntries: z.array(TocEntrySchema).min(1),
});
export type SaveTextbookOutlineRequest = z.infer<typeof SaveTextbookOutlineRequestSchema>;
export const SaveTextbookOutlineResultSchema = z.object({
  documentId: z.string().min(1), title: z.string(),
  lessonCount: z.number().int().nonnegative(), totalEntries: z.number().int().positive(),
  minPage: z.number().int().positive(), maxPage: z.number().int().positive(),
  entries: z.array(TocEntrySchema).min(1),
});
export type SaveTextbookOutlineResult = z.infer<typeof SaveTextbookOutlineResultSchema>;

export const TextbookTocPlanSchema = z.object({
  documentId: z.string().min(1).describe('所属教材文档ID'),
  title: z.string().min(1).describe('教材全名'),
  entries: z.array(TocEntrySchema).min(1).describe('全书目录条目树状列表'),
});
export type TextbookTocPlan = z.infer<typeof TextbookTocPlanSchema>;

export interface TocValidationResult {
  lessonCount: number;
  totalEntries: number;
  minPage: number;
  maxPage: number;
}

/**
 * 目录页码单调递增自动校验器：
 * 1. 按父子关系提取一级标题（不按语义类型筛选）；
 * 2. 强制校验 startPage 严格单调递增：Page_{i+1} >= Page_i；
 * 3. 校验 endPage 是否大于等于自身的 startPage；
 * 4. 若出现页码回退或倒错，返回友好的业务诊断错误 E_TOC_PAGE_ORDER_INVALID。
 */
export function validateTocPageOrder(entries: readonly TocEntry[]): Result<TocValidationResult, BusinessError> {
  if (!entries || entries.length === 0) {
    return err(new BusinessError('E_TOC_EMPTY', '目录条目不能为空', 'VALIDATION', false));
  }

  // 1. 验证 ID 唯一性
  const seenIds = new Set<string>();
  for (const entry of entries) {
    if (seenIds.has(entry.id)) {
      return err(
        new BusinessError(
          'E_TOC_DUPLICATE_ID',
          `目录条目 ID 重复: "${entry.id}" (${entry.title})`,
          'VALIDATION',
          false
        )
      );
    }
    seenIds.add(entry.id);

    // 自身 startPage 与 endPage 校验
    if (typeof entry.endPage === 'number' && entry.endPage < entry.startPage) {
      return err(
        new BusinessError(
          'E_TOC_PAGE_RANGE_INVALID',
          `条目 "${entry.title}" 的结束页 (${entry.endPage}) 小于起始页 (${entry.startPage})`,
          'VALIDATION',
          false
        )
      );
    }
  }

  // 2. 独立部分也属于内容任务；课内小节不作为另一份独立任务检查。
  const lessons = entries.filter((e) => e.level === 'lesson');
  const planned = planTextbookTasks(entries);
  if (!planned.ok) return planned;
  const roots = planned.value.map(task => task.root);
  for (let i = 0; i < roots.length - 1; i++) {
    const curr = roots[i]!;
    const next = roots[i + 1]!;

    if (next.startPage < curr.startPage) {
      return err(
        new BusinessError(
          'E_TOC_PAGE_ORDER_INVALID',
          `目录页码未单调递增：第 ${i + 1} 课 "${curr.title}" (第 ${curr.startPage} 页) 后面紧跟的第 ${i + 2} 课 "${next.title}" (第 ${next.startPage} 页) 出现了页码倒退，请核对这几页图片并修正`,
          'VALIDATION',
          false
        )
      );
    }
  }

  const allPages = entries.flatMap((e) => [e.startPage, ...(e.endPage ? [e.endPage] : [])]);
  const minPage = Math.min(...allPages);
  const maxPage = Math.max(...allPages);

  return ok({
    lessonCount: lessons.length,
    totalEntries: entries.length,
    minPage,
    maxPage,
  });
}

/**
 * 一级标题切到下一个一级标题之前；子标题仅在本章内推断范围，最后一章保留用户结束页。
 */
export function canonicalizeTocEntries(entries: readonly TocEntry[]): Array<TocEntry & { sortOrder: number }> {
  const planned = planTextbookTasks(entries);
  const tasks = planned.ok ? planned.value : [];
  return entries.map((entry, index) => {
    let inferredEndPage = entry.endPage;
    const taskIndex = tasks.findIndex(task => task.entries.some(child => child.id === entry.id));
    const task = tasks[taskIndex];
    const nextRoot = tasks[taskIndex + 1]?.root;
    if (task?.root.id === entry.id && nextRoot) {
      inferredEndPage = Math.max(entry.startPage, nextRoot.startPage - 1);
    } else if (task && inferredEndPage === undefined) {
      const nextSibling = entries.slice(index + 1).find(child => child.parentId === entry.parentId);
      const boundary = nextSibling?.startPage ?? nextRoot?.startPage;
      inferredEndPage = boundary === undefined ? task.root.endPage : Math.max(entry.startPage, boundary - 1);
    }

    return {
      ...entry,
      title: entry.title.trim(),
      ...(inferredEndPage ? { endPage: Math.max(entry.startPage, inferredEndPage) } : {}),
      sortOrder: index + 1,
    };
  });
}
