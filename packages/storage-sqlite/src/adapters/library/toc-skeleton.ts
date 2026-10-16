import { eq } from 'drizzle-orm';
import { BusinessError, err, nowIso, ok, translateToBusinessError, type Result } from '@lexdistill/shared';
import { canonicalizeTocEntries, planTextbookTasks, validateTocPageOrder, type TocEntry } from '@lexdistill/document-model';
import { documents, textbookVocabulary, textbookKnowledge, textbookArticles, textbookSentences, textbookExerciseItems, textbookMaterials } from '../../schema.js';
import type { DrizzleDb } from '../../connection.js';
import { ChapterManifestSchema, type ChapterManifest } from './textbook-content.js';
import { textbookStatsInTx } from './textbook-view.js';

export interface SeedTocSkeletonInput {
  documentId: string; userId: string; title: string; language?: string | undefined;
  entries: readonly TocEntry[]; forceOverwrite?: boolean | undefined; sourceFingerprint?: string | undefined;
}
export interface SavedTocSkeleton { documentId: string; title: string; lessonCount: number; totalEntries: number; minPage: number; maxPage: number }
export interface TextbookLessonSlotItem {
  documentId: string; lessonId: string; lessonNumber: number; title: string; sortOrder: number; kind: string; parentId: string | null;
  startPage: number | null; endPage: number | null; status: string; hasPassage: boolean; hasPreview: boolean; hasSummary: boolean;
  tocEntries?: TocEntry[];
}
export interface TextbookAssetStats {
  documentId: string; lessons: number; readyLessons: number; lines: number; vocab: number; grammar: number; exercises: number; passageLessons: number;
  lessonDetails: Array<{ lessonId: string; title: string; status: 'pending' | 'ready' | 'failed'; hasPassage: boolean; lineCount: number;
    vocabCount: number; grammarCount: number; exerciseCount: number; hasPreview: boolean; hasSummary: boolean }>;
}

/** 一级章节保存为任务，子标题只保存为本章的目录参考；学习内容仍在自己的表中。 */
export async function seedTextbookTocSkeleton(deps: { db: DrizzleDb }, input: SeedTocSkeletonInput): Promise<Result<SavedTocSkeleton, BusinessError>> {
  if (!input.documentId.trim() || !input.title.trim()) return err(new BusinessError('E_INVALID_INPUT', '教材身份和标题不能为空', 'VALIDATION'));
  const ordered = validateTocPageOrder(input.entries); if (!ordered.ok) return ordered;
  const planned = planTextbookTasks(canonicalizeTocEntries(input.entries)); if (!planned.ok) return planned;
  try {
    const result = deps.db.transaction(tx => {
      const existing = tx.select().from(documents).where(eq(documents.id, input.documentId)).get();
      const language = input.language ?? 'ja';
      if (existing && existing.userId !== input.userId) throw new BusinessError('E_NOT_FOUND', '未找到当前用户的教材', 'VALIDATION');
      if (existing && existing.language !== language) throw new BusinessError('E_TEXTBOOK_LANGUAGE_CONFLICT', '教材语种与已保存内容不同', 'VALIDATION');
      if (existing?.sourceFingerprint && input.sourceFingerprint && existing.sourceFingerprint !== input.sourceFingerprint) throw new BusinessError('E_SOURCE_FILE_CONFLICT', '所选文件与已保存教材不同', 'VALIDATION');
      const previous: ChapterManifest = existing?.chaptersJson ? ChapterManifestSchema.parse(JSON.parse(existing.chaptersJson)) : [];
      const manifest: ChapterManifest = planned.value.map((task, index) => ({ id: task.root.id, title: task.root.title, order: index + 1,
        kind: task.root.level === 'lesson' || task.root.level === 'session' ? 'lesson' : 'section', startPage: task.root.startPage ?? null, endPage: task.root.endPage ?? null,
        tocEntries: [...task.ancestors, ...task.entries].map(({ sortOrder: _order, ...entry }) => entry),
        status: !input.forceOverwrite ? previous.find(chapter => chapter.id === task.root.id)?.status ?? 'pending' : 'pending' }));
      if (!input.forceOverwrite && previous.some(chapter => chapter.status === 'ready' && !manifest.some(next => next.id === chapter.id))) throw new BusinessError('E_TOC_SLOT_CONFLICT', '新章节清单缺少已经保存的章节', 'VALIDATION');
      if (input.forceOverwrite) for (const table of [textbookVocabulary, textbookKnowledge, textbookArticles, textbookSentences, textbookExerciseItems, textbookMaterials]) tx.delete(table).where(eq(table.documentId, input.documentId)).run();
      const now = nowIso();
      if (existing) tx.update(documents).set({ title: input.title.trim(), chaptersJson: JSON.stringify(manifest), sourceFingerprint: input.sourceFingerprint ?? existing.sourceFingerprint,
        astJson: null, updatedAt: now }).where(eq(documents.id, input.documentId)).run();
      else tx.insert(documents).values({ id: input.documentId, userId: input.userId, title: input.title.trim(), language, sourceKind: 'user_import', content: '',
        chaptersJson: JSON.stringify(manifest), sourceFingerprint: input.sourceFingerprint ?? null, createdAt: now, updatedAt: now }).run();
      return { documentId: input.documentId, title: input.title.trim(), lessonCount: manifest.filter(chapter => chapter.kind === 'lesson').length || manifest.length,
        totalEntries: manifest.length, minPage: Math.min(...manifest.map(chapter => chapter.startPage ?? 0)), maxPage: Math.max(...manifest.map(chapter => chapter.endPage ?? chapter.startPage ?? 0)) };
    });
    return ok(result);
  } catch (cause) { return err(cause instanceof BusinessError ? cause : translateToBusinessError(cause, { category: 'DATABASE', fallbackMessage: '教材章节清单保存失败' })); }
}

export async function listTextbookLessonSlots(deps: { db: DrizzleDb }, documentId: string): Promise<Result<TextbookLessonSlotItem[], BusinessError>> {
  try {
    return ok(deps.db.transaction(tx => {
      const doc = tx.select().from(documents).where(eq(documents.id, documentId)).get();
      const manifest = doc?.chaptersJson ? ChapterManifestSchema.parse(JSON.parse(doc.chaptersJson)) : [];
      const stats = textbookStatsInTx(tx, documentId);
      return manifest.map(chapter => ({ documentId, lessonId: chapter.id, lessonNumber: chapter.order, title: chapter.title, sortOrder: chapter.order,
        kind: chapter.kind, parentId: null, startPage: chapter.startPage, endPage: chapter.endPage, status: chapter.status,
        ...(chapter.tocEntries ? { tocEntries: chapter.tocEntries } : {}),
        hasPassage: stats.lessonDetails.find(item => item.lessonId === chapter.id)?.hasPassage ?? false, hasPreview: false, hasSummary: false }));
    }));
  } catch (cause) { return err(translateToBusinessError(cause, { category: 'DATABASE', fallbackMessage: '章节清单读取失败' })); }
}

export async function getTextbookAssetStats(deps: { db: DrizzleDb }, documentId: string): Promise<Result<TextbookAssetStats, BusinessError>> {
  try { return ok(deps.db.transaction(tx => textbookStatsInTx(tx, documentId))); }
  catch (cause) { return err(translateToBusinessError(cause, { category: 'DATABASE', fallbackMessage: '教材保存统计读取失败' })); }
}
