import { BusinessError, err, ok, generateId, nowIso, type Result } from '@study-studio/shared';
import { parseTextbookAST, type TextbookAST } from '@study-studio/document-model';
import { and, eq, sql } from 'drizzle-orm';
import { documents, globalVocabulary, textbookVocabulary, textbookKnowledge, textbookArticles, textbookSentences, textbookExerciseItems, textbookMaterials } from '../../schema.js';
import type { DrizzleDb } from '../../connection.js';
import { rebuildTextbookSearchInTx } from './textbook-search-index.js';

/** Explicit structured-file import. Content is stored only in the learning tables. */
export interface ShredStats { lessons: number; vocab: number; grammar: number; lines: number; exercises: number; ftsRows: number; mappedEntries: number; unmapped: number }
export type ShredTx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];
export function tryParseTextbookAst(raw: unknown): TextbookAST | null {
  try { const parsed = parseTextbookAST(typeof raw === 'string' ? JSON.parse(raw) : raw); return parsed.ok ? parsed.value : null; } catch { return null; }
}
export function termMapDedupKey(documentId: string, lessonId: string, kind: string, refText: string): string { return JSON.stringify([documentId, lessonId, kind, refText]); }
export function shredDocument(deps: { db: DrizzleDb }, documentId: string, book: TextbookAST): Result<ShredStats, BusinessError> {
  try { return ok(deps.db.transaction(tx => shredIntoTransaction(tx, documentId, book))); }
  catch (cause) { return err(cause instanceof BusinessError ? cause : new BusinessError('E_TEXTBOOK_SAVE_FAILED', '教材内容保存失败，本次写入已撤回', 'DATABASE', true)); }
}
export function shredIntoTransaction(tx: ShredTx, documentId: string, book: TextbookAST): ShredStats {
  const doc = tx.select().from(documents).where(eq(documents.id, documentId)).get();
  if (!doc) throw new BusinessError('E_NOT_FOUND', '教材不存在', 'VALIDATION');
  for (const table of [textbookVocabulary, textbookKnowledge, textbookArticles, textbookSentences, textbookExerciseItems, textbookMaterials]) tx.delete(table).where(eq(table.documentId, documentId)).run();
  const stats: ShredStats = { lessons: book.lessons.length, vocab: 0, grammar: 0, lines: 0, exercises: 0, ftsRows: 0, mappedEntries: 0, unmapped: 0 };
  const manifest = book.lessons.map((lesson, index) => ({ id: lesson.id, title: lesson.title, order: index+1, kind: lesson.kind === 'section' ? 'section' : 'lesson', startPage: lesson.startPage ?? null, endPage: lesson.endPage ?? null, status: lesson.status ?? 'ready' }));
  tx.update(documents).set({ chaptersJson: JSON.stringify(manifest), sourceFingerprint: book.sourceFingerprint ?? null, astJson: null }).where(eq(documents.id, documentId)).run();
  for (const lesson of book.lessons) {
    const base = (id: string, ord: number) => ({ id, documentId, chapterId: lesson.id, ord });
    for (const [ord, word] of lesson.vocabularies.entries()) {
      let global = tx.select().from(globalVocabulary).where(and(eq(globalVocabulary.userId, doc.userId), eq(globalVocabulary.language, doc.language), eq(globalVocabulary.word, word.kanji.trim()), eq(globalVocabulary.reading, word.kana.trim()))).get();
      if (!global) {
        const id = generateId('vocabulary');
        tx.insert(globalVocabulary).values({ id, userId: doc.userId, language: doc.language, word: word.kanji.trim(), reading: word.kana.trim(), meaning: word.chinese, jlptLevel: null, levelSource: null, createdAt: nowIso() }).run();
        global = tx.select().from(globalVocabulary).where(eq(globalVocabulary.id, id)).get();
      }
      if (!global) throw new BusinessError('E_TEXTBOOK_SAVE_FAILED', '词汇保存失败', 'DATABASE');
      const original = lesson.content?.vocabularies[ord];
      const examples = original?.examples.map(e => ({ text: e.text, ...(e.translation ? { translation: e.translation } : {}) })) ?? (word.example ? [{ text: word.example.japanese, translation: word.example.chinese }] : []);
      tx.insert(textbookVocabulary).values({ ...base(word.id || generateId('word'), ord), vocabularyId: global.id, meaning: word.chinese, partOfSpeech: word.pos, pitch: word.pitchAccent, explanation: original?.aiExplanation ?? null, examplesJson: JSON.stringify(examples) }).onConflictDoNothing().run();
      stats.vocab++; stats.unmapped++;
    }
    for (const [ord, point] of lesson.grammarPoints.entries()) {
      const original = lesson.content?.knowledgePoints[ord];
      tx.insert(textbookKnowledge).values({ ...base(point.id || generateId('knowledge'), ord), kind: 'GRAMMAR', title: point.title, explanation: point.explanation, connection: point.connection, aiExplanation: original?.aiExplanation ?? null, examplesJson: JSON.stringify(point.examples.map(e => ({ text: e.japanese, translation: e.chinese }))), source: original?.source ?? 'TEXTBOOK' }).run(); stats.grammar++;
    }
    if (lesson.content) {
      for (const [ord, block] of lesson.content.blocks.entries()) {
        const row = { ...base(block.id, ord), text: block.text, translation: block.translation ?? null, source: block.source };
        if (block.kind === 'DIALOGUE') tx.insert(textbookSentences).values({ ...row, speaker: block.speaker ?? null }).run();
        else tx.insert(textbookArticles).values(row).run();
        stats.lines++;
      }
    } else {
      for (const [ord, line] of lesson.dialogues.entries()) {
        const row = { ...base(generateId('text'), ord), text: line.japanese, translation: line.chinese, source: 'TEXTBOOK' };
        if (line.speaker) tx.insert(textbookSentences).values({ ...row, speaker: line.speaker }).run();
        else tx.insert(textbookArticles).values(row).run();
        stats.lines++;
      }
      if (!lesson.dialogues.length && lesson.passageMd) { tx.insert(textbookArticles).values({ ...base(generateId('article'), 0), text: lesson.passageMd, source: 'TEXTBOOK' }).run(); stats.lines++; }
    }
    for (const [ord, exercise] of lesson.exercises.entries()) {
      const original = lesson.content?.exercises[ord];
      const answer = original?.answer;
      const actualAnswer = answer?.text ?? (answer?.optionIds ? answer.optionIds.map(id => original?.options?.find(option => option.id === id)?.text ?? '') : answer?.pairs ? answer.pairs.map(pair => ({ left: original?.left?.find(item => item.id === pair.leftId)?.text ?? '', right: original?.right?.find(item => item.id === pair.rightId)?.text ?? '' })) : exercise.answer);
      tx.insert(textbookExerciseItems).values({ ...base(exercise.id || generateId('exercise'), ord), type: exercise.type, prompt: exercise.prompt, optionsJson: exercise.options ? JSON.stringify(exercise.options) : null, leftJson: original?.left ? JSON.stringify(original.left.map(item => item.text)) : null, rightJson: original?.right ? JSON.stringify(original.right.map(item => item.text)) : null, answerJson: JSON.stringify(actualAnswer), explanation: exercise.explanation ?? null, source: original?.source ?? 'TEXTBOOK' }).run(); stats.exercises++;
    }
  }
  stats.ftsRows = rebuildTextbookSearchInTx(tx, documentId);
  return stats;
}
