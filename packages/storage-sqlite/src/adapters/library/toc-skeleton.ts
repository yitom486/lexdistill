import { eq } from 'drizzle-orm';
import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
  nowIso,
} from '@study-studio/shared';
import {
  validateTocPageOrder,
  canonicalizeTocEntries,
  type TocEntry,
  type TocValidationResult,
} from '@study-studio/document-model';
import { documents, textbookLessons } from '../../schema.js';
import type { DrizzleDb } from '../../connection.js';

export interface SeedTocSkeletonInput {
  documentId: string;
  userId: string;
  title: string;
  language?: string | undefined;
  entries: readonly TocEntry[];
}

export interface SavedTocSkeleton {
  documentId: string;
  title: string;
  lessonCount: number;
  totalEntries: number;
  minPage: number;
  maxPage: number;
}

/**
 * 目录优先落库服务（骨架优先 Seed）：
 * 1. 自动执行页码单调递增强校验（validateTocPageOrder）；
 * 2. 规范化补齐每课 endPage 并赋予从 1 开始严格单调连续的 sortOrder；
 * 3. 在同一 SQLite 事务中：
 *    - 插入或更新 documents 主表元数据；
 *    - 清空旧槽位，批量插入初始化的 textbook_lessons 槽位（status='pending'）；
 * 4. 返回落库成功摘要。
 */
export async function seedTextbookTocSkeleton(
  deps: { db: DrizzleDb },
  input: SeedTocSkeletonInput
): Promise<Result<SavedTocSkeleton, BusinessError>> {
  if (!input.documentId?.trim()) {
    return err(new BusinessError('E_INVALID_INPUT', '缺少文档标识 documentId', 'VALIDATION', false));
  }
  if (!input.title?.trim()) {
    return err(new BusinessError('E_INVALID_INPUT', '教材标题不能为空', 'VALIDATION', false));
  }

  // 1. 严格单调递增自动校验门禁
  const validated = validateTocPageOrder(input.entries);
  if (!validated.ok) {
    return err(validated.error);
  }

  // 2. 规范化条目
  const canonicalEntries = canonicalizeTocEntries(input.entries);
  const now = nowIso();
  const docTitle = input.title.trim();
  const lang = (input.language ?? 'ja').toLowerCase();

  try {
    deps.db.transaction((tx) => {
      // 写入或更新 documents
      const existingDoc = tx
        .select()
        .from(documents)
        .where(eq(documents.id, input.documentId))
        .limit(1)
        .all();

      if (existingDoc.length > 0) {
        tx.update(documents)
          .set({
            title: docTitle,
            language: lang,
            updatedAt: now,
          })
          .where(eq(documents.id, input.documentId))
          .run();
      } else {
        tx.insert(documents)
          .values({
            id: input.documentId,
            userId: input.userId,
            title: docTitle,
            sourceKind: 'user_import',
            language: lang,
            content: `教材大纲：${docTitle}`,
            astJson: null,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }

      // 幂等清理该文档现有章节槽位
      tx.delete(textbookLessons).where(eq(textbookLessons.documentId, input.documentId)).run();

      // 批量插入章节槽位（status='pending'）
      const lessonRows: Array<typeof textbookLessons.$inferInsert> = canonicalEntries.map((entry) => ({
        documentId: input.documentId,
        lessonId: entry.id,
        lessonNumber: entry.sortOrder,
        title: entry.title,
        sortOrder: entry.sortOrder,
        kind: entry.level === 'unit' || entry.level === 'chapter' ? 'chapter' : 'lesson',
        parentId: entry.parentId ?? null,
        startPage: entry.startPage,
        endPage: entry.endPage ?? null,
        status: 'pending',
        passageMd: null,
      }));

      if (lessonRows.length > 0) {
        tx.insert(textbookLessons).values(lessonRows).run();
      }
    });

    return ok({
      documentId: input.documentId,
      title: docTitle,
      lessonCount: validated.value.lessonCount,
      totalEntries: validated.value.totalEntries,
      minPage: validated.value.minPage,
      maxPage: validated.value.maxPage,
    });
  } catch (e) {
    return err(translateToBusinessError(e, 'seedTextbookTocSkeleton'));
  }
}

export interface TextbookLessonSlotItem {
  documentId: string;
  lessonId: string;
  lessonNumber: number;
  title: string;
  sortOrder: number;
  kind: string;
  parentId: string | null;
  startPage: number | null;
  endPage: number | null;
  status: string;
  hasPassage: boolean;
  hasPreview: boolean;
  hasSummary: boolean;
}

/**
 * 查询指定文档已创建的教材章节槽位列表（按 sortOrder 升序排列）
 */
export async function listTextbookLessonSlots(
  deps: { db: DrizzleDb },
  documentId: string
): Promise<Result<TextbookLessonSlotItem[], BusinessError>> {
  if (!documentId?.trim()) {
    return err(new BusinessError('E_INVALID_INPUT', '缺少文档标识 documentId', 'VALIDATION', false));
  }
  try {
    const rows = deps.db
      .select()
      .from(textbookLessons)
      .where(eq(textbookLessons.documentId, documentId.trim()))
      .orderBy(textbookLessons.sortOrder)
      .all();

    const items: TextbookLessonSlotItem[] = rows.map((r) => ({
      documentId: r.documentId,
      lessonId: r.lessonId,
      lessonNumber: r.lessonNumber,
      title: r.title,
      sortOrder: r.sortOrder ?? 0,
      kind: r.kind,
      parentId: r.parentId,
      startPage: r.startPage,
      endPage: r.endPage,
      status: r.status,
      hasPassage: Boolean(r.passageMd?.trim()),
      hasPreview: Boolean(r.previewJson?.trim()),
      hasSummary: Boolean(r.summaryJson?.trim()),
    }));

    return ok(items);
  } catch (e) {
    return err(translateToBusinessError(e, 'listTextbookLessonSlots'));
  }
}

