import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
} from '@study-studio/shared';
import { parseTextbookAST } from '@study-studio/document-model';
import { and, desc, eq, isNotNull, or } from 'drizzle-orm';
import {
  documents,
  readingPositions,
} from '@study-studio/storage-sqlite';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';
import {
  normalizeTrackLanguage,
  type TrackLanguage,
} from '../../../infrastructure/persistence/language.js';
import { normalizeLessonDisplayTitle } from '../lesson-display-title.js';

export interface TextbookFocus {
  documentId: string;
  bookTitle: string;
  lessonId: string;
  lessonTitle: string;
  lessonNumber: number;
  /**
   * P1-B：展示用标题（网关保守归一，高置信度 token 或 null）。
   * daily-plan 只消费本字段；lessonTitle（raw）/lessonNumber（legacy）仅留诊断，不进用户文本。
   */
  displayTitle: string | null;
}

/**
 * 教材焦点 = 最近读到的教材课次（给今日计划指“学哪课”）。
 * 数据源复用 reading_positions（切课即记，已有链路），只认带 AST 课次的文档；
 * 无记录/课次对不上返回 null（计划保持原样，不挡主路径）。
 */
export async function getTextbookFocus(
  deps: RepoDeps,
  userId: string,
  language: string
): Promise<Result<TextbookFocus | null, BusinessError>> {
  try {
    const track: TrackLanguage = normalizeTrackLanguage(language);
    const rows = await deps.db
      .select({
        documentId: readingPositions.documentId,
        locator: readingPositions.locator,
        docTitle: documents.title,
        docLanguage: documents.language,
        astJson: documents.astJson,
      })
      .from(readingPositions)
      .innerJoin(documents, eq(documents.id, readingPositions.documentId))
      .where(
        and(
          eq(readingPositions.userId, userId),
          or(
            eq(documents.userId, userId),
            eq(documents.sourceKind, 'curriculum_textbook')
          ),
          isNotNull(documents.astJson)
        )
      )
      .orderBy(desc(readingPositions.updatedAt))
      .limit(10);
    for (const row of rows) {
      if ((row.docLanguage || '').toLowerCase() !== track) continue;
      let lessonId = '';
      try {
        const locator = JSON.parse(row.locator || '{}') as { lessonId?: unknown };
        if (typeof locator.lessonId === 'string') lessonId = locator.lessonId;
      } catch {
        continue;
      }
      if (!lessonId) continue;
      let astRaw: unknown = null;
      try {
        astRaw = JSON.parse(row.astJson as string);
      } catch {
        continue;
      }
      const parsed = parseTextbookAST(astRaw);
      if (parsed.ok !== true) continue;
      const lesson = parsed.value.lessons.find((l) => l.id === lessonId);
      if (!lesson) continue;
      return ok({
        documentId: row.documentId,
        bookTitle: row.docTitle,
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        lessonNumber: lesson.lessonNumber,
        displayTitle: normalizeLessonDisplayTitle(lesson.title),
      });
    }
    return ok(null);
  } catch (error) {
    return err(
      translateToBusinessError(error, {
        category: 'DATABASE',
        action: 'getTextbookFocus',
        entityId: userId,
      })
    );
  }
}
