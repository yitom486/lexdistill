import { z } from 'zod';
import { ok, err, Result, BusinessError } from '@study-studio/shared';

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
 * 1. 提取所有核心教学实体（level === 'lesson'）；
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

  // 2. 提取所有课（lesson）节点检查单调递增
  const lessons = entries.filter((e) => e.level === 'lesson');
  if (lessons.length === 0) {
    return err(
      new BusinessError(
        'E_TOC_NO_LESSONS',
        '目录中未检测到任何核心课次（level: "lesson"），请至少保留具体的课次条目',
        'VALIDATION',
        false
      )
    );
  }

  for (let i = 0; i < lessons.length - 1; i++) {
    const curr = lessons[i]!;
    const next = lessons[i + 1]!;

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
 * 规范化目录条目：自动推断并补齐每课未填写的 endPage，并自动分配连续的 sortOrder 序号
 */
export function canonicalizeTocEntries(entries: readonly TocEntry[]): Array<TocEntry & { sortOrder: number }> {
  return entries.map((entry, index) => {
    let inferredEndPage = entry.endPage;
    if (inferredEndPage === undefined) {
      // 尝试根据下一个同级或高级节点的 startPage 推断
      const rank = TocLevelSchema.options.indexOf(entry.level);
      const nextEntry = entries.slice(index + 1).find((e) =>
        TocLevelSchema.options.indexOf(e.level) <= rank && e.startPage > entry.startPage
      );
      if (nextEntry && nextEntry.startPage > entry.startPage) {
        inferredEndPage = nextEntry.startPage - 1;
      }
    }

    return {
      ...entry,
      title: entry.title.trim(),
      ...(inferredEndPage ? { endPage: Math.max(entry.startPage, inferredEndPage) } : {}),
      sortOrder: index + 1,
    };
  });
}
