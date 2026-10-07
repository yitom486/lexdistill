import { and, eq, or, sql } from 'drizzle-orm';
import { initFsrsState } from '@study-studio/learning-algorithms';
import { CardTypeSchema, FlashcardSchema, type Flashcard, type VocabularyCollection, type VocabularyEntry, type VocabularyScope } from '@study-studio/protocol';
import { ChapterManifestSchema, VocabularyLearningContentSchema, type VocabularyLearningContent } from '@study-studio/document-model';
import { BusinessError, generateId, nowIso, normalizeTrackLanguage } from '@study-studio/shared';
import type { DrizzleDb } from '../../connection.js';
import { documents, flashcards, globalVocabulary, textbookVocabulary } from '../../schema.js';

type Tx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];
type CardRow = typeof flashcards.$inferSelect;
type GlobalVocabularyRow = typeof globalVocabulary.$inferSelect;
type TextbookVocabularyRow = typeof textbookVocabulary.$inferSelect;
type VocabularySource = VocabularyEntry['sources'][number];

function toSourceEntry(
  local: TextbookVocabularyRow,
  doc: { id: string; title: string },
  chapterTitle: string,
): VocabularySource {
  return { documentId: doc.id, chapterId: local.chapterId, bookTitle: doc.title,
    chapterTitle, meaning: local.meaning,
    ...(local.partOfSpeech ? { partOfSpeech: local.partOfSpeech } : {}), examples: readCardExamples(local.examplesJson),
    ...(local.usageNotes ? { usage: local.usageNotes } : {}), ...(local.contextNote ? { contextNote: local.contextNote } : {}),
    ...(local.source === 'AI' || local.source === 'TEXTBOOK' ? { source: local.source } : {}), textbookVocabularyId: local.id };
}

function toVocabularyEntry(word: GlobalVocabularyRow, sources: VocabularyEntry['sources'], cardId: string | undefined): VocabularyEntry {
  let learning: VocabularyLearningContent | undefined;
  if (word.learningJson) {
    try {
      const parsed = VocabularyLearningContentSchema.safeParse(JSON.parse(word.learningJson));
      if (parsed.success) learning = parsed.data;
    } catch { /* 坏内容当作未生成，读链路永不抛 */ }
  }
  return { id: word.id, word: word.word, reading: word.reading, language: normalizeTrackLanguage(word.language), meaning: word.meaning,
    level: word.jlptLevel, collected: !!cardId, ...(cardId ? { cardId } : {}),
    ...(learning ? { learning } : {}), sources };
}

function chapterTitlesOf(docId: string, chaptersJson: string | null, cache: Map<string, Map<string, string>>): Map<string, string> {
  let titles = cache.get(docId);
  if (!titles) {
    const chapters = ChapterManifestSchema.safeParse(JSON.parse(chaptersJson ?? '[]'));
    titles = new Map(chapters.success ? chapters.data.map(chapter => [chapter.id, chapter.title]) : []);
    cache.set(docId, titles);
  }
  return titles;
}
const ExamplesSchema = FlashcardSchema.shape.examples.unwrap();
type Examples = NonNullable<Flashcard['examples']>;
export function readCardExamples(raw: string): Examples {
  try { const parsed = ExamplesSchema.safeParse(JSON.parse(raw)); return parsed.success ? parsed.data : []; }
  catch { return []; }
}
export function flashcardFromRow(row: CardRow): Flashcard {
  const type = CardTypeSchema.safeParse(row.type);
  return {
    id: row.id, userId: row.userId, language: normalizeTrackLanguage(row.language),
    type: type.success ? type.data : 'VOCABULARY', front: row.front, back: row.back,
    ...(row.phonetic ? { phonetic: row.phonetic } : {}), ...(row.audioUrl ? { audioUrl: row.audioUrl } : {}),
    ...(row.sourceEntryId ? { sourceEntryId: row.sourceEntryId } : {}),
    ...(row.vocabularyId ? { vocabularyId: row.vocabularyId } : {}),
    ...(row.partOfSpeech ? { partOfSpeech: row.partOfSpeech } : {}), examples: readCardExamples(row.examplesJson),
    tags: FlashcardSchema.shape.tags.parse(JSON.parse(row.tags)), fsrs: FlashcardSchema.shape.fsrs.parse(JSON.parse(row.fsrs)),
    ...(row.studiedAt ? { studiedAt: row.studiedAt } : {}),
  };
}

export interface VocabularyCardInput {
  userId: string; language: string; word: string; reading?: string | undefined; meaning: string;
  vocabularyId?: string | undefined; sourceEntryId?: string | undefined;
  partOfSpeech?: string | undefined; examples?: Examples | undefined; tags: string[]; studiedAt?: string | undefined;
}

/** Shared atomic collection command. Existing card content and FSRS are never reset. */
export function collectVocabularyCardInTx(tx: Tx, input: VocabularyCardInput): VocabularyCollection {
  const userId = input.userId.trim(), language = normalizeTrackLanguage(input.language);
  const word = input.word.trim(), reading = (input.reading ?? '').trim();
  if (!userId || !word) throw new BusinessError('E_INVALID_INPUT', '请选择有效的词汇', 'VALIDATION');
  let vocabulary = tx.select().from(globalVocabulary).where(input.vocabularyId
    ? and(eq(globalVocabulary.id, input.vocabularyId), eq(globalVocabulary.userId, userId), eq(globalVocabulary.language, language))
    : and(eq(globalVocabulary.userId, userId), eq(globalVocabulary.language, language), eq(globalVocabulary.word, word), eq(globalVocabulary.reading, reading))).get();
  if (input.vocabularyId && !vocabulary) throw new BusinessError('E_NOT_FOUND', '未找到当前用户的词汇', 'VALIDATION');
  if (!vocabulary) {
    tx.insert(globalVocabulary).values({ id: generateId('vocabulary'), userId, language, word, reading, meaning: input.meaning, createdAt: nowIso() }).onConflictDoNothing().run();
    vocabulary = tx.select().from(globalVocabulary).where(and(eq(globalVocabulary.userId, userId), eq(globalVocabulary.language, language), eq(globalVocabulary.word, word), eq(globalVocabulary.reading, reading))).get();
  }
  if (!vocabulary) throw new BusinessError('E_VOCABULARY_SAVE_FAILED', '词汇保存失败，请重试', 'DATABASE');
  let existing = tx.select().from(flashcards).where(and(eq(flashcards.userId, userId), eq(flashcards.type, 'VOCABULARY'), eq(flashcards.vocabularyId, vocabulary.id))).get();
  if (!existing) {
    // Only adopt one exact legacy match; never guess among duplicate or edited cards.
    const candidates = tx.select().from(flashcards).where(and(eq(flashcards.userId, userId), eq(flashcards.language, language), eq(flashcards.type, 'VOCABULARY'),
      input.sourceEntryId ? or(eq(flashcards.sourceEntryId, input.sourceEntryId), and(eq(flashcards.front, word), sql`coalesce(${flashcards.phonetic}, '') = ${reading}`))
        : and(eq(flashcards.front, word), sql`coalesce(${flashcards.phonetic}, '') = ${reading}`))).all().filter(row => !row.vocabularyId);
    if (candidates.length === 1) {
      existing = candidates[0]!;
      tx.update(flashcards).set({ vocabularyId: vocabulary.id }).where(eq(flashcards.id, existing.id)).run();
    }
  }
  if (existing) {
    // A dictionary reference may enrich a textbook card without replacing the card or its schedule.
    const enrichment = {
      ...(input.sourceEntryId && !existing.sourceEntryId ? { sourceEntryId: input.sourceEntryId } : {}),
      ...(input.studiedAt && !existing.studiedAt ? { studiedAt: input.studiedAt } : {}),
    };
    if (Object.keys(enrichment).length) tx.update(flashcards).set(enrichment).where(eq(flashcards.id, existing.id)).run();
    return { created: false, card: flashcardFromRow(tx.select().from(flashcards).where(eq(flashcards.id, existing.id)).get()!) };
  }
  const id = generateId('card_vocab');
  tx.insert(flashcards).values({ id, userId, language, type: 'VOCABULARY', vocabularyId: vocabulary.id,
    front: vocabulary.word, back: input.meaning, phonetic: vocabulary.reading || null,
    sourceEntryId: input.sourceEntryId ?? null, partOfSpeech: input.partOfSpeech ?? null,
    examplesJson: JSON.stringify(input.examples ?? []), tags: JSON.stringify(input.tags),
    fsrs: JSON.stringify({ ...initFsrsState(), dueAt: input.studiedAt ?? nowIso() }), studiedAt: input.studiedAt ?? null,
  }).run();
  return { created: true, card: flashcardFromRow(tx.select().from(flashcards).where(eq(flashcards.id, id)).get()!) };
}

export type VocabularyLearningTarget =
  | { kind: 'global'; vocabularyId: string }
  | { kind: 'textbook'; textbookVocabularyId: string };
export interface SaveVocabularyLearningInput {
  userId: string; target: VocabularyLearningTarget;
  content: VocabularyLearningContent; sessionId?: string | undefined;
}

/**
 * 保存词汇 AI 讲解（按词覆盖，版本+1）。
 * 只写两张词汇表；卡片与 FSRS 调度绝不触碰。
 */
export function saveVocabularyLearning(db: DrizzleDb, input: SaveVocabularyLearningInput): { version: number } {
  return db.transaction(tx => {
    const payload = JSON.stringify(input.content);
    const stamp = nowIso();
    if (input.target.kind === 'global') {
      const row = tx.select().from(globalVocabulary).where(and(eq(globalVocabulary.id, input.target.vocabularyId), eq(globalVocabulary.userId, input.userId))).get();
      if (!row) throw new BusinessError('E_NOT_FOUND', '未找到当前用户的词汇', 'VALIDATION');
      const version = (row.learningVersion ?? 0) + 1;
      tx.update(globalVocabulary).set({ learningJson: payload, learningVersion: version, learningUpdatedAt: stamp,
        ...(input.sessionId ? { learningSessionId: input.sessionId } : {}) }).where(eq(globalVocabulary.id, row.id)).run();
      return { version };
    }
    const row = tx.select({ local: textbookVocabulary }).from(textbookVocabulary)
      .innerJoin(documents, eq(documents.id, textbookVocabulary.documentId))
      .where(and(eq(textbookVocabulary.id, input.target.textbookVocabularyId), eq(documents.userId, input.userId))).get();
    if (!row) throw new BusinessError('E_NOT_FOUND', '未找到当前用户的教材词汇', 'VALIDATION');
    const version = (row.local.learningVersion ?? 0) + 1;
    tx.update(textbookVocabulary).set({ learningJson: payload, learningVersion: version, learningUpdatedAt: stamp,
      ...(input.sessionId ? { learningSessionId: input.sessionId } : {}) }).where(eq(textbookVocabulary.id, row.local.id)).run();
    return { version };
  });
}

export interface VocabularyMasteryRow {
  jlpt: string;
  total: number;
  stable: number;
}

/**
 * 各 JLPT 等级掌握统计（画像与词汇门共用同一口径，禁两处各算）。
 * - total：该级全局词数（含未收词；未定级词不计入任何等级）。
 * - stable：其中已建卡且 FSRS stability ≥ stableDaysThreshold 数；未关联词的卡不归属任何等级。
 * 阈值由调用方按 learner-core MASTERED_STABILITY_DAYS 传入：定义只存一处，
 * storage 保持对 learner-core 仅类型引用（包边界锁要求）。
 */
export function getVocabularyMasteryByJlpt(db: DrizzleDb, userId: string, language: string, stableDaysThreshold: number): VocabularyMasteryRow[] {
  return db.transaction(tx => {
    const totals = tx.select({ jlpt: globalVocabulary.jlptLevel, n: sql<number>`count(*)` }).from(globalVocabulary)
      .where(and(eq(globalVocabulary.userId, userId), eq(globalVocabulary.language, language), sql`${globalVocabulary.jlptLevel} IS NOT NULL`))
      .groupBy(globalVocabulary.jlptLevel).all();
    const stables = tx.select({ jlpt: globalVocabulary.jlptLevel, n: sql<number>`count(*)` }).from(flashcards)
      .innerJoin(globalVocabulary, and(eq(flashcards.vocabularyId, globalVocabulary.id),
        eq(globalVocabulary.userId, userId), eq(globalVocabulary.language, language)))
      .where(and(eq(flashcards.userId, userId), eq(flashcards.language, language), eq(flashcards.type, 'VOCABULARY'),
        sql`${globalVocabulary.jlptLevel} IS NOT NULL`,
        sql`coalesce(cast(json_extract(${flashcards.fsrs}, '$.stability') as real), 0) >= ${stableDaysThreshold}`))
      .groupBy(globalVocabulary.jlptLevel).all();
    const stableByJlpt = new Map((stables as Array<{ jlpt: string | null; n: number }>).map(row => [row.jlpt ?? '', row.n]));
    return (totals as Array<{ jlpt: string | null; n: number }>)
      .filter(row => row.jlpt)
      .map(row => ({ jlpt: row.jlpt as string, total: row.n, stable: stableByJlpt.get(row.jlpt as string) ?? 0 }));
  });
}

export function listVocabulary(db: DrizzleDb, userId: string, language: string, scope: VocabularyScope = {}): VocabularyEntry[] {
  return db.transaction(tx => {
    const words = tx.select().from(globalVocabulary).where(and(eq(globalVocabulary.userId, userId), eq(globalVocabulary.language, language))).all();
    const contexts = tx.select({ local: textbookVocabulary, doc: documents }).from(textbookVocabulary)
      .innerJoin(documents, eq(documents.id, textbookVocabulary.documentId)).where(and(eq(documents.userId, userId), eq(documents.language, language),
        ...(scope.documentId ? [eq(documents.id, scope.documentId)] : []), ...(scope.chapterId ? [eq(textbookVocabulary.chapterId, scope.chapterId)] : []))).all();
    const cards = tx.select({ id: flashcards.id, vocabularyId: flashcards.vocabularyId }).from(flashcards)
      .where(and(eq(flashcards.userId, userId), eq(flashcards.language, language), eq(flashcards.type, 'VOCABULARY'))).all();
    const cardByWord = new Map(cards.filter(card => card.vocabularyId).map(card => [card.vocabularyId!, card.id]));
    const sourcesByWord = new Map<string, VocabularyEntry['sources']>();
    const chapterTitles = new Map<string, Map<string, string>>();
    for (const { local, doc } of contexts) {
      const titles = chapterTitlesOf(doc.id, doc.chaptersJson, chapterTitles);
      const sources = sourcesByWord.get(local.vocabularyId) ?? [];
      sources.push(toSourceEntry(local, doc, titles.get(local.chapterId) ?? '章节'));
      sourcesByWord.set(local.vocabularyId, sources);
    }
    return words.filter(word => !scope.documentId || sourcesByWord.has(word.id)).map(word => {
      return toVocabularyEntry(word, sourcesByWord.get(word.id) ?? [], cardByWord.get(word.id));
    });
  });
}

/** 按 id 直查单条（context 热路径；全表扫描只留给列表页）。 */
export function getVocabularyEntry(db: DrizzleDb, userId: string, language: string, vocabularyId: string): VocabularyEntry | undefined {
  return db.transaction(tx => {
    const word = tx.select().from(globalVocabulary)
      .where(and(eq(globalVocabulary.id, vocabularyId), eq(globalVocabulary.userId, userId), eq(globalVocabulary.language, language))).get();
    if (!word) return undefined;
    const contexts = tx.select({ local: textbookVocabulary, doc: documents }).from(textbookVocabulary)
      .innerJoin(documents, eq(documents.id, textbookVocabulary.documentId))
      .where(and(eq(textbookVocabulary.vocabularyId, vocabularyId), eq(documents.userId, userId), eq(documents.language, language))).all();
    const cache = new Map<string, Map<string, string>>();
    const sources = contexts.map(({ local, doc }) =>
      toSourceEntry(local, doc, chapterTitlesOf(doc.id, doc.chaptersJson, cache).get(local.chapterId) ?? '章节'));
    const card = tx.select({ id: flashcards.id }).from(flashcards)
      .where(and(eq(flashcards.userId, userId), eq(flashcards.language, language), eq(flashcards.type, 'VOCABULARY'), eq(flashcards.vocabularyId, vocabularyId))).get();
    return toVocabularyEntry(word, sources, card?.id);
  });
}

export function collectGlobalVocabulary(db: DrizzleDb, userId: string, vocabularyId: string, scope: VocabularyScope = {}): VocabularyCollection {
  return db.transaction(tx => {
    const word = tx.select().from(globalVocabulary).where(and(eq(globalVocabulary.id, vocabularyId), eq(globalVocabulary.userId, userId))).get();
    if (!word) throw new BusinessError('E_NOT_FOUND', '未找到当前用户的词汇', 'VALIDATION');
    const context = scope.documentId ? tx.select({ local: textbookVocabulary }).from(textbookVocabulary).innerJoin(documents, eq(documents.id, textbookVocabulary.documentId))
      .where(and(eq(documents.userId, userId), eq(documents.id, scope.documentId), eq(textbookVocabulary.vocabularyId, vocabularyId),
        ...(scope.chapterId ? [eq(textbookVocabulary.chapterId, scope.chapterId)] : []))).get()?.local : undefined;
    if (scope.documentId && !context) throw new BusinessError('E_NOT_FOUND', '该词汇不属于指定教材或章节', 'VALIDATION');
    return collectVocabularyCardInTx(tx, { userId, language: word.language, vocabularyId, word: word.word, reading: word.reading,
      meaning: context?.meaning ?? word.meaning, partOfSpeech: context?.partOfSpeech ?? undefined,
      examples: context ? readCardExamples(context.examplesJson) : [], tags: [context ? '教材生词' : '词汇收藏'] });
  });
}
