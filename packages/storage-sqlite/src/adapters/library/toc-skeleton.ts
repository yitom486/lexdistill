import { and, count, eq } from 'drizzle-orm';
import { savePipelineAstInTx } from './commit-lesson-knowledge.js';
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
  planTextbookTasks,
  type TocEntry,
  type TocValidationResult,
} from '@study-studio/document-model';
import {
  documents,
  textbookLessons,
  textbookLines,
  textbookVocab,
  textbookGrammar,
  textbookExercises,
} from '../../schema.js';
import type { DrizzleDb } from '../../connection.js';

export interface SeedTocSkeletonInput {
  documentId: string;
  userId: string;
  title: string;
  language?: string | undefined;
  entries: readonly TocEntry[];
  forceOverwrite?: boolean | undefined;
  sourceFingerprint?: string | undefined;
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
 *    - 若 forceOverwrite=false，检查并保留现有槽位已就绪状态及生成内容；
 *    - 清空旧槽位，批量插入初始化的 textbook_lessons 槽位；
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
        if (existingDoc[0]?.userId !== input.userId) {
          throw new BusinessError('E_NOT_FOUND', '未找到当前用户的教材', 'VALIDATION');
        }
        if (existingDoc[0]?.language !== lang) throw new BusinessError('E_TEXTBOOK_LANGUAGE_CONFLICT', '已有教材的语种与当前提取配置不同，请核对教材语种后重试', 'VALIDATION');
        if (input.sourceFingerprint && existingDoc[0]?.astJson) {
          const previous: unknown = JSON.parse(existingDoc[0].astJson);
          if (previous && typeof previous === 'object' && 'sourceFingerprint' in previous &&
              typeof previous.sourceFingerprint === 'string' && previous.sourceFingerprint !== input.sourceFingerprint) {
            throw new BusinessError('E_SOURCE_FILE_CONFLICT', '所选 PDF 与这本教材原来的文件不同，请作为新教材导入，避免混入不同版本的内容', 'VALIDATION');
          }
        }
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

      // 检查现有课次槽位（若存在且未强制覆盖，保留已 ready 状态与内容）
      const existingLessons = tx
        .select()
        .from(textbookLessons)
        .where(eq(textbookLessons.documentId, input.documentId))
        .all();
      const existingLessonMap = new Map(existingLessons.map((l) => [l.lessonId, l]));

      if (!input.forceOverwrite && existingLessons.some(prev => prev.status === 'ready' && !canonicalEntries.some(entry => entry.id === prev.lessonId))) {
        throw new BusinessError('E_TOC_SLOT_CONFLICT', '新目录缺少已有正文的课次，请核对目录，避免删除已保存内容', 'VALIDATION');
      }

      for (const entry of canonicalEntries) {
        const prev = existingLessonMap.get(entry.id);
        if (!input.forceOverwrite && prev?.status === 'ready' &&
            (prev.title !== entry.title || (prev.startPage !== null && prev.startPage !== entry.startPage))) {
          throw new BusinessError('E_TOC_SLOT_CONFLICT', '目录中的课次身份与已导入内容不一致，请重新核对目录，避免把旧课文放入新课次', 'VALIDATION');
        }
      }
      for (const prev of existingLessons) {
        const preserved = !input.forceOverwrite && prev.status === 'ready' && canonicalEntries.some((e) => e.id === prev.lessonId);
        if (preserved) continue;
        for (const table of [textbookVocab, textbookGrammar, textbookExercises, textbookLines]) {
          tx.delete(table).where(and(eq(table.documentId, input.documentId), eq(table.lessonId, prev.lessonId))).run();
        }
      }

      // 幂等清理该文档现有章节槽位
      tx.delete(textbookLessons).where(eq(textbookLessons.documentId, input.documentId)).run();

      // 批量插入章节槽位（若旧槽位存在且已 ready 且未强制覆盖，保留状态与生成内容）
      const lessonRows: Array<typeof textbookLessons.$inferInsert> = canonicalEntries.map((entry) => {
        const prev = existingLessonMap.get(entry.id);
        const shouldPreserve = Boolean(!input.forceOverwrite && prev && prev.status === 'ready');
        return {
          documentId: input.documentId,
          lessonId: entry.id,
          lessonNumber: entry.sortOrder,
          title: entry.title,
          sortOrder: entry.sortOrder,
          kind: entry.level,
          parentId: entry.parentId ?? null,
          startPage: entry.startPage,
          endPage: entry.endPage ?? null,
          status: shouldPreserve && prev ? prev.status : 'pending',
          passageMd: shouldPreserve && prev ? prev.passageMd : null,
          previewJson: shouldPreserve && prev ? prev.previewJson : null,
          summaryJson: shouldPreserve && prev ? prev.summaryJson : null,
        };
      });

      if (lessonRows.length > 0) {
        tx.insert(textbookLessons).values(lessonRows).run();
      }
      savePipelineAstInTx(tx, input.documentId, {
        outlineConfirmed: true,
        ...(input.sourceFingerprint ? { sourceFingerprint: input.sourceFingerprint } : {}),
      });
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
    if (e instanceof BusinessError) return err(e);
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

export interface TextbookAssetStats {
  documentId: string;
  lessons: number;
  readyLessons: number;
  lines: number;
  vocab: number;
  grammar: number;
  exercises: number;
  passageLessons: number;
  lessonDetails: Array<{
    lessonId: string;
    title: string;
    status: 'pending' | 'ready' | 'failed';
    hasPassage: boolean;
    lineCount: number;
    vocabCount: number;
    grammarCount: number;
    exerciseCount: number;
    hasPreview: boolean;
    hasSummary: boolean;
  }>;
}

/**
 * 极速统计指定教材文档在 SQLite 中的真实结构化学习资产（行数、课次、生词、语法、练习）。
 * 毫秒级返回，作为网关权威诊断决策的第一事实源（SSOT）。
 */
export async function getTextbookAssetStats(
  deps: { db: DrizzleDb },
  documentId: string
): Promise<Result<TextbookAssetStats, BusinessError>> {
  if (!documentId?.trim()) {
    return err(new BusinessError('E_INVALID_INPUT', '缺少文档标识 documentId', 'VALIDATION', false));
  }
  try {
    const docId = documentId.trim();
    const rows = deps.db
      .select()
      .from(textbookLessons)
      .where(eq(textbookLessons.documentId, docId))
      .orderBy(textbookLessons.sortOrder)
      .all();
    const planned = rows.length ? planTextbookTasks(rows.map(row => ({ ...row, id: row.lessonId, level: row.kind }))) : ok([]);
    if (!planned.ok) return planned;
    const lessonRows = planned.value.map(task => task.root);

    const countsByLesson = (table: typeof textbookLines | typeof textbookVocab | typeof textbookGrammar | typeof textbookExercises) =>
      new Map(deps.db.select({ lessonId: table.lessonId, count: count() }).from(table)
        .where(eq(table.documentId, docId)).groupBy(table.lessonId).all().map((r) => [r.lessonId, r.count]));
    const lines = countsByLesson(textbookLines);
    const vocab = countsByLesson(textbookVocab);
    const grammar = countsByLesson(textbookGrammar);
    const exercises = countsByLesson(textbookExercises);
    const lessonDetails: TextbookAssetStats['lessonDetails'] = lessonRows.map((r) => {
      const lineCount = lines.get(r.lessonId) ?? 0;
      const vocabCount = vocab.get(r.lessonId) ?? 0;
      const grammarCount = grammar.get(r.lessonId) ?? 0;
      const exerciseCount = exercises.get(r.lessonId) ?? 0;
      const hasPassage = Boolean(r.passageMd?.trim() || lineCount > 0);
      const hasContent = hasPassage || vocabCount > 0 || grammarCount > 0 || exerciseCount > 0;
      return {
        lessonId: r.lessonId, title: r.title,
        status: r.status === 'ready' && hasContent ? 'ready' : r.status === 'failed' ? 'failed' : 'pending',
        hasPassage, lineCount, vocabCount, grammarCount, exerciseCount,
        hasPreview: Boolean(r.previewJson?.trim()), hasSummary: Boolean(r.summaryJson?.trim()),
      };
    });

    return ok({
      documentId: docId,
      lessons: lessonDetails.length,
      readyLessons: lessonDetails.filter((r) => r.status === 'ready').length,
      lines: lessonDetails.reduce((sum, r) => sum + r.lineCount, 0),
      vocab: lessonDetails.reduce((sum, r) => sum + r.vocabCount, 0),
      grammar: lessonDetails.reduce((sum, r) => sum + r.grammarCount, 0),
      exercises: lessonDetails.reduce((sum, r) => sum + r.exerciseCount, 0),
      passageLessons: lessonDetails.filter((r) => r.hasPassage).length,
      lessonDetails,
    });
  } catch (e) {
    return err(translateToBusinessError(e, 'getTextbookAssetStats'));
  }
}
