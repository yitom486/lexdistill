import { createHash } from 'node:crypto';
import { and, eq, max } from 'drizzle-orm';
import { TextbookWriteSchemas, ChapterManifestSchema, type ChapterManifest, type TextbookContentKind } from '@study-studio/document-model';
import { BusinessError, err, generateId, nowIso, ok, translateToBusinessError, type Result } from '@study-studio/shared';
import { rebuildTextbookSearchInTx } from './textbook-search-index.js';
import type { DrizzleDb } from '../../connection.js';
import { documents, globalVocabulary, textbookVocabulary, textbookKnowledge, textbookArticles, textbookSentences, textbookExerciseItems, textbookMaterials } from '../../schema.js';

export { ChapterManifestSchema, type ChapterManifest } from '@study-studio/document-model';
export interface TextbookScope { userId: string; documentId: string; chapterId: string }
export interface ContentWriteReceipt { kind: TextbookContentKind; saved: number; vocabularyAdded: number }
type Tx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];

export function getBoundChapter(tx: Tx, scope: TextbookScope) {
  const doc = tx.select().from(documents).where(and(eq(documents.id, scope.documentId), eq(documents.userId, scope.userId))).get();
  if (!doc) throw new BusinessError('E_NOT_FOUND', '未找到当前用户的教材', 'VALIDATION');
  const manifest = ChapterManifestSchema.safeParse(JSON.parse(doc.chaptersJson ?? 'null'));
  if (!manifest.success || !manifest.data.some(chapter => chapter.id === scope.chapterId)) throw new BusinessError('E_CHAPTER_NOT_FOUND', '本次会话没有可写入的教材章节', 'VALIDATION');
  return { doc, manifest: manifest.data };
}
const contentId = (scope: TextbookScope, kind: string, value: unknown) => `content_${createHash('sha256').update(JSON.stringify([scope.documentId, scope.chapterId, kind, value])).digest('hex')}`;
const formatError = (error: { issues: { path: (string | number)[]; message: string }[] }) => new BusinessError('E_CONTENT_FORMAT_INVALID', '内容格式不正确，请按工具字段说明修正', 'VALIDATION', true,
  { issues: error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) });

/** Internal content command. Model tools buffer changes and use the lesson transaction. */
export async function writeTextbookContent(deps: { db: DrizzleDb }, scope: TextbookScope, kind: TextbookContentKind, raw: unknown): Promise<Result<ContentWriteReceipt, BusinessError>> {
  try {
    const receipt = deps.db.transaction(tx => {
      const receipt = writeTextbookContentInTx(tx, scope, kind, raw);
      rebuildTextbookSearchInTx(tx, scope.documentId);
      tx.update(documents).set({ updatedAt: nowIso() }).where(eq(documents.id, scope.documentId)).run();
      return receipt;
    });
    return ok(receipt);
  } catch (cause) { return err(cause instanceof BusinessError ? cause : translateToBusinessError(cause, { category: 'DATABASE', fallbackMessage: '内容保存失败，本次写入已撤回' })); }
}

export function writeTextbookContentInTx(tx: Tx, scope: TextbookScope, kind: TextbookContentKind, raw: unknown, identity?: { id: string; ord: number }) {
      const { doc } = getBoundChapter(tx, scope);
      let saved = 0, vocabularyAdded = 0;
      const table = { vocabulary: textbookVocabulary, grammar: textbookKnowledge, articles: textbookArticles, sentences: textbookSentences, exercises: textbookExerciseItems }[kind === 'material' ? 'articles' : kind];
      const nextOrd = (tx.select({ n: max(table.ord) }).from(table).where(and(eq(table.documentId, scope.documentId), eq(table.chapterId, scope.chapterId))).get()?.n ?? -1) + 1;
      const base = (value: unknown, ord: number, source?: string) => ({ id: identity?.id ?? contentId(scope, kind, [value, source ?? null]), documentId: scope.documentId, chapterId: scope.chapterId, ord: identity?.ord ?? nextOrd + ord });
      switch (kind) {
        case 'vocabulary': {
          const parsed = TextbookWriteSchemas.vocabulary.safeParse(raw); if (!parsed.success) throw formatError(parsed.error);
          for (const [ord, word] of parsed.data.items.entries()) {
            const reading = word.reading ?? '';
            let global = tx.select().from(globalVocabulary).where(and(eq(globalVocabulary.userId, scope.userId), eq(globalVocabulary.language, doc.language), eq(globalVocabulary.word, word.word), eq(globalVocabulary.reading, reading))).get();
            if (!global) {
              const id = generateId('vocabulary');
              tx.insert(globalVocabulary).values({ id, userId: scope.userId, language: doc.language, word: word.word, reading, meaning: word.meaning, jlptLevel: word.level, levelSource: 'MODEL_ESTIMATE', createdAt: nowIso() }).run();
              global = tx.select().from(globalVocabulary).where(eq(globalVocabulary.id, id)).get(); vocabularyAdded++;
            }
            if (!global) throw new BusinessError('E_VOCABULARY_SAVE_FAILED', '全局词汇保存失败，本次写入已撤回', 'DATABASE');
            // Existing global entries are never overwritten by another extraction.
            const inserted = tx.insert(textbookVocabulary).values({ ...base(word, ord), vocabularyId: global.id, meaning: word.meaning, partOfSpeech: word.partOfSpeech ?? null, pitch: word.pitch ?? null, explanation: word.explanation ?? null, usageNotes: word.usage ?? null, contextNote: word.contextNote ?? null, examplesJson: JSON.stringify(word.examples) }).onConflictDoNothing().returning({ id: textbookVocabulary.id }).all();
            saved += inserted.length;
          } break;
        }
        case 'grammar': {
          const parsed = TextbookWriteSchemas.grammar.safeParse(raw); if (!parsed.success) throw formatError(parsed.error);
          for (const [ord, item] of parsed.data.items.entries()) saved += tx.insert(textbookKnowledge).values({ ...base(item, ord, parsed.data.source), kind: item.kind, title: item.title, explanation: item.explanation, connection: item.connection ?? null, aiExplanation: item.aiExplanation ?? null, examplesJson: JSON.stringify(item.examples), source: parsed.data.source }).onConflictDoNothing().returning({ id: table.id }).all().length;
          break;
        }
        case 'articles': {
          const parsed = TextbookWriteSchemas.articles.safeParse(raw); if (!parsed.success) throw formatError(parsed.error);
          for (const [ord, item] of parsed.data.items.entries()) saved += tx.insert(textbookArticles).values({ ...base(item, ord, parsed.data.source), title: item.title ?? null, text: item.text, translation: item.translation ?? null, source: parsed.data.source }).onConflictDoNothing().returning({ id: table.id }).all().length;
          break;
        }
        case 'sentences': {
          const parsed = TextbookWriteSchemas.sentences.safeParse(raw); if (!parsed.success) throw formatError(parsed.error);
          for (const [ord, item] of parsed.data.items.entries()) saved += tx.insert(textbookSentences).values({ ...base(item, ord, parsed.data.source), text: item.text, translation: item.translation ?? null, explanation: item.explanation ?? null, speaker: item.speaker ?? null, source: parsed.data.source }).onConflictDoNothing().returning({ id: table.id }).all().length;
          break;
        }
        case 'exercises': {
          const parsed = TextbookWriteSchemas.exercises.safeParse(raw); if (!parsed.success) throw formatError(parsed.error);
          for (const [ord, item] of parsed.data.items.entries()) {
            saved += tx.insert(textbookExerciseItems).values({ ...base(item, ord, parsed.data.source), type: item.type, prompt: item.prompt, optionsJson: item.options ? JSON.stringify(item.options) : null, leftJson: item.left ? JSON.stringify(item.left) : null, rightJson: item.right ? JSON.stringify(item.right) : null, answerJson: item.answer === undefined ? null : JSON.stringify(item.answer), difficultyTier: item.difficultyTier, difficultyReason: item.difficultyReason, explanation: item.explanation ?? null, gradingNotes: item.gradingNotes ?? null, source: parsed.data.source }).onConflictDoNothing().returning({ id: table.id }).all().length;
          } break;
        }
        case 'material': {
          const parsed = TextbookWriteSchemas.material.safeParse(raw); if (!parsed.success) throw formatError(parsed.error);
          tx.insert(textbookMaterials).values({ documentId: scope.documentId, chapterId: scope.chapterId, text: parsed.data.text, updatedAt: nowIso() }).onConflictDoUpdate({ target: [textbookMaterials.documentId, textbookMaterials.chapterId], set: { text: parsed.data.text, updatedAt: nowIso() } }).run(); saved = 1; break;
        }
      }
      return { kind, saved, vocabularyAdded };
}

export async function readTextbookMaterial(deps: { db: DrizzleDb }, scope: TextbookScope): Promise<Result<{ text: string | null }, BusinessError>> {
  try {
    return ok(deps.db.transaction(tx => {
      getBoundChapter(tx, scope);
      const row = tx.select().from(textbookMaterials).where(and(eq(textbookMaterials.documentId, scope.documentId), eq(textbookMaterials.chapterId, scope.chapterId))).get();
      return { text: row?.text ?? null };
    }));
  } catch (cause) { return err(cause instanceof BusinessError ? cause : translateToBusinessError(cause, { category: 'DATABASE', fallbackMessage: '整理材料读取失败' })); }
}
