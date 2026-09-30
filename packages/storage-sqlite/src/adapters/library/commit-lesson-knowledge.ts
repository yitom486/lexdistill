import { and, eq } from 'drizzle-orm';
import { ok, err, BusinessError, translateToBusinessError, nowIso, type Result } from '@study-studio/shared';
import { TextbookASTSchema, LessonContentSchema, lessonContentIssues, projectLessonContent, planTextbookTasks, type LessonContent, type TextbookAST } from '@study-studio/document-model';
import { documents, textbookLessons } from '../../schema.js';
import type { DrizzleDb } from '../../connection.js';
import { shredIntoTransaction, type ShredTx } from './textbook-shred.js';

export interface CommitLessonKnowledgeInput {
  documentId: string;
  lessonId: string;
  submissionId: string;
  content: LessonContent;
  onTransaction?: (phase: 'begin' | 'committed' | 'rolled_back') => void;
}
export interface CommitLessonKnowledgeOutput {
  documentId: string;
  lessonId: string;
  stats: { vocabCount: number; grammarCount: number; exerciseCount: number; hasPassage: boolean };
  allLessonsReady: boolean;
}

function readAst(tx: ShredTx, docId: string): TextbookAST {
  const doc = tx.select().from(documents).where(eq(documents.id, docId)).get();
  if (!doc?.astJson) throw new BusinessError('E_INVALID_TEXTBOOK_AST', '教材目录底稿缺失，请重新确认目录', 'VALIDATION');
  const parsed = TextbookASTSchema.safeParse(JSON.parse(doc.astJson));
  if (!parsed.success) throw new BusinessError('E_INVALID_TEXTBOOK_AST', '教材底稿损坏，本次写入已撤回', 'VALIDATION');
  return parsed.data;
}
function persistAst(tx: ShredTx, docId: string, ast: TextbookAST): void {
  const parsed = TextbookASTSchema.safeParse(ast);
  if (!parsed.success) throw new BusinessError('E_INVALID_TEXTBOOK_AST', '教材结构无法一致保存，本次写入已撤回', 'VALIDATION');
  tx.update(documents).set({ astJson: JSON.stringify(parsed.data), updatedAt: nowIso() }).where(eq(documents.id, docId)).run();
  shredIntoTransaction(tx, docId, parsed.data);
}

/** 规范 AST 是唯一写入来源；提交身份与派生行在同一事务内保存。 */
export async function commitLessonKnowledge(deps: { db: DrizzleDb }, input: CommitLessonKnowledgeInput): Promise<Result<CommitLessonKnowledgeOutput, BusinessError>> {
  const parsed = LessonContentSchema.safeParse(input.content);
  if (!input.documentId?.trim() || !input.lessonId?.trim() || !input.submissionId?.trim() || !parsed.success || lessonContentIssues(parsed.data).length) {
    return err(new BusinessError('E_LLM_SCHEMA_INVALID', '章节内容或提交身份不符合要求', 'VALIDATION', true));
  }
  try {
    const saved = deps.db.transaction(tx => {
      input.onTransaction?.('begin');
      const slot = tx.select().from(textbookLessons).where(and(eq(textbookLessons.documentId, input.documentId), eq(textbookLessons.lessonId, input.lessonId))).get();
      if (!slot) throw new BusinessError('E_TOC_SLOT_NOT_FOUND', '提交部分不属于已确认目录', 'VALIDATION');
      const ast = readAst(tx, input.documentId);
      const planned = planTextbookTasks(ast.lessons.map(item => ({ ...item, level: item.kind ?? 'lesson' })));
      if (!planned.ok) throw planned.error;
      if (!planned.value.some(task => task.root.id === input.lessonId)) throw new BusinessError('E_TOC_SLOT_NOT_FOUND', '提交节点不是当前目录的独立提取部分', 'VALIDATION');
      const lesson = ast.lessons.find(item => item.id === input.lessonId);
      if (!lesson) throw new BusinessError('E_TOC_SLOT_NOT_FOUND', '教材底稿中没有该课次', 'VALIDATION');
      if (slot.submissionId !== input.submissionId) {
        lesson.content = parsed.data;
        lesson.submissionId = input.submissionId;
        lesson.status = 'ready';
        Object.assign(lesson, projectLessonContent(parsed.data));
        persistAst(tx, input.documentId, ast);
      }
      const content = lesson.content;
      if (!content) throw new BusinessError('E_INVALID_TEXTBOOK_AST', '已提交章节缺少规范内容', 'DATABASE');
      return {
        documentId: input.documentId, lessonId: input.lessonId,
        stats: { vocabCount: content.vocabularies.length, grammarCount: content.knowledgePoints.length, exerciseCount: content.exercises.length, hasPassage: content.blocks.length > 0 },
        allLessonsReady: planned.value.every(task => ast.lessons.find(item => item.id === task.root.id)?.status === 'ready'),
      };
    });
    input.onTransaction?.('committed');
    return ok(saved);
  } catch (cause) {
    input.onTransaction?.('rolled_back');
    return err(cause instanceof BusinessError ? cause : translateToBusinessError(cause, { category: 'DATABASE', fallbackMessage: '章节保存失败，已撤回本次写入，可重试保存' }));
  }
}

/** 目录更新保留已确认内容；待提取槽位只生成空底稿，不从旧正文猜测结构。 */
export function savePipelineAstInTx(tx: ShredTx, docId: string, metadata?: { sourceFingerprint?: string; outlineConfirmed?: boolean }): void {
  const doc = tx.select().from(documents).where(eq(documents.id, docId)).get();
  if (!doc) return;
  let previous: TextbookAST | undefined;
  if (doc.astJson) {
    const parsed = TextbookASTSchema.safeParse(JSON.parse(doc.astJson));
    if (!parsed.success) throw new BusinessError('E_INVALID_TEXTBOOK_AST', '教材底稿损坏，请重新核对教材', 'VALIDATION');
    previous = parsed.data;
  }
  const slots = tx.select().from(textbookLessons).where(eq(textbookLessons.documentId, docId)).orderBy(textbookLessons.sortOrder).all();
  const language = doc.language?.toUpperCase();
  if (language !== 'JA' && language !== 'EN' && language !== 'KO') throw new BusinessError('E_INVALID_INPUT', '请选择教材语种', 'VALIDATION');
  const ast: TextbookAST = {
    id: docId, title: doc.title, shortTitle: doc.title, level: previous?.level ?? '', language,
    ...(previous?.sourceFingerprint ? { sourceFingerprint: previous.sourceFingerprint } : {}),
    totalLessons: slots.filter(slot => slot.kind === 'lesson').length,
    ...metadata,
    lessons: slots.map((slot, index) => {
      const prior = slot.status === 'ready' ? previous?.lessons.find(item => item.id === slot.lessonId) : undefined;
      // 页码以当前目录槽位为准，不能从保存的内容带回已移除的范围。
      const retained = prior ? { ...prior } : {};
      if ('startPage' in retained) delete retained.startPage;
      if ('endPage' in retained) delete retained.endPage;
      return {
        vocabularies: [], grammarPoints: [], dialogues: [], exercises: [], ...retained,
        id: slot.lessonId, lessonNumber: slot.lessonNumber || index + 1, title: slot.title,
        kind: slot.kind === 'unit' || slot.kind === 'chapter' || slot.kind === 'section' ? slot.kind : 'lesson', parentId: slot.parentId,
        ...(slot.startPage !== null ? { startPage: slot.startPage } : {}),
        ...(slot.endPage !== null ? { endPage: slot.endPage } : {}),
        status: slot.status === 'ready' ? 'ready' : 'pending',
      };
    }),
  };
  persistAst(tx, docId, ast);
}
