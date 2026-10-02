import { and, eq, max } from 'drizzle-orm';
import { TextbookLearningContentSchema, type TextbookContentChange, type TextbookLearningContent } from '@study-studio/document-model';
import { BusinessError, err, ok, translateToBusinessError, type Result } from '@study-studio/shared';
import type { DrizzleDb } from '../../connection.js';
import { textbookVocabulary, textbookKnowledge, textbookArticles, textbookSentences, textbookExerciseItems, textbookMaterials } from '../../schema.js';
import { getBoundChapter, writeTextbookContentInTx, type TextbookScope } from './textbook-content.js';
import { completeTextbookChapterInTx, textbookViewInTx, type CommitLessonKnowledgeOutput } from './textbook-view.js';
import { rebuildTextbookSearchInTx } from './textbook-search-index.js';

export async function readTextbookChapter(deps: { db: DrizzleDb }, scope: TextbookScope): Promise<Result<TextbookLearningContent, BusinessError>> {
  try {
    return ok(deps.db.transaction(tx => {
      getBoundChapter(tx, scope);
      const chapter = textbookViewInTx(tx, scope.documentId)?.lessons.find(lesson => lesson.id === scope.chapterId);
      return TextbookLearningContentSchema.parse(chapter?.learningContent);
    }));
  } catch (cause) { return err(translateToBusinessError(cause, 'readTextbookChapter')); }
}

/** Content changes wait until the model has finished; all lesson effects share one write transaction. */
export async function commitTextbookLesson(deps: { db: DrizzleDb }, scope: TextbookScope, changes: readonly TextbookContentChange[]): Promise<Result<CommitLessonKnowledgeOutput, BusinessError>> {
  try {
    return ok(deps.db.transaction(tx => {
      getBoundChapter(tx, scope);
      for (const change of changes) {
        if (change.kind === 'material') {
          if (change.action === 'delete') tx.delete(textbookMaterials).where(and(eq(textbookMaterials.documentId, scope.documentId), eq(textbookMaterials.chapterId, scope.chapterId))).run();
          else writeTextbookContentInTx(tx, scope, change.kind, change.input);
          continue;
        }
        const table = { grammar: textbookKnowledge, vocabulary: textbookVocabulary, exercises: textbookExerciseItems, articles: textbookArticles, sentences: textbookSentences }[change.kind];
        const where = and(eq(table.id, change.id), eq(table.documentId, scope.documentId), eq(table.chapterId, scope.chapterId));
        const current = tx.select({ ord: table.ord }).from(table).where(where).get();
        if (change.action !== 'add' && !current) throw new BusinessError('E_CONTENT_REF_STALE', '待修改内容已经变化，请重新读取本课内容', 'VALIDATION', true);
        if (change.action !== 'add') tx.delete(table).where(where).run();
        if (change.action !== 'delete') {
          const ord = current?.ord ?? (tx.select({ n: max(table.ord) }).from(table).where(and(eq(table.documentId, scope.documentId), eq(table.chapterId, scope.chapterId))).get()?.n ?? -1) + 1;
          const written = writeTextbookContentInTx(tx, scope, change.kind, change.input, { id: change.id, ord });
          if (written.saved !== 1) throw new BusinessError('E_CONTENT_CONFLICT', '本课已有相同内容，请读取后用 ref 修改，不要重复新增', 'VALIDATION', true);
        }
      }
      rebuildTextbookSearchInTx(tx, scope.documentId);
      return completeTextbookChapterInTx(tx, scope);
    }));
  } catch (cause) { return err(translateToBusinessError(cause, { category: 'DATABASE', fallbackMessage: '整课保存失败，本次变更已撤回，已保存版本保留' })); }
}
