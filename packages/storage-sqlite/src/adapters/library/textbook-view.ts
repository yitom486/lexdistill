import { and, count, eq } from 'drizzle-orm';
import { StringListSchema, TextbookExampleSchema, LanguageCodeSchema, ExerciseTypeSchema, TextbookLearningContentSchema, type TextbookAST } from '@study-studio/document-model';
import { BusinessError, err, nowIso, ok, translateToBusinessError, type Result } from '@study-studio/shared';
import type { DrizzleDb } from '../../connection.js';
import { documents, globalVocabulary, textbookVocabulary, textbookKnowledge, textbookArticles, textbookSentences, textbookExerciseItems, textbookMaterials } from '../../schema.js';
import { ChapterManifestSchema, getBoundChapter, type TextbookScope } from './textbook-content.js';
import type { TextbookAssetStats } from './toc-skeleton.js';
export interface CommitLessonKnowledgeOutput {
  documentId: string; lessonId: string;
  stats: { vocabCount: number; grammarCount: number; exerciseCount: number; hasPassage: boolean };
  allLessonsReady: boolean;
}

type Tx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];
const parseExamples = (text: string) => TextbookExampleSchema.array().parse(JSON.parse(text));
const COLON_SPEAKER_RE = /^(.{1,16})[：:]\s*(.+)$/;

function projectArticleToDialogues(article: { text: string; translation?: string | null }): Array<{ speaker: string; japanese: string; chinese: string }> {
  const rawText = article.text.trim();
  if (!rawText) return [];
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  const transLines = (article.translation ?? '').split('\n').map(l => l.trim()).filter(Boolean);

  let matchedCount = 0;
  for (const line of lines) {
    const m = COLON_SPEAKER_RE.exec(line);
    if (m && !/^\d+$/.test(m[1]!.trim())) {
      matchedCount++;
    }
  }

  if (matchedCount >= 2 || (matchedCount >= 1 && lines.length === 1)) {
    return lines.map((line, idx) => {
      const m = COLON_SPEAKER_RE.exec(line);
      if (m && !/^\d+$/.test(m[1]!.trim())) {
        const speaker = m[1]!.trim();
        const japanese = m[2]!.trim();
        let chinese = '';
        if (idx < transLines.length) {
          const tm = COLON_SPEAKER_RE.exec(transLines[idx]!);
          chinese = tm ? tm[2]!.trim() : transLines[idx]!;
        }
        return { speaker, japanese, chinese };
      }
      return { speaker: '', japanese: line, chinese: transLines[idx] ?? '' };
    });
  }

  return [{ speaker: '', japanese: article.text, chinese: article.translation ?? '' }];
}

const contentTables = [textbookVocabulary, textbookKnowledge, textbookArticles, textbookSentences, textbookExerciseItems] as const;

export function textbookStatsInTx(tx: Tx, documentId: string): TextbookAssetStats {
  const doc = tx.select().from(documents).where(eq(documents.id, documentId)).get();
  const chapters = doc?.chaptersJson ? ChapterManifestSchema.parse(JSON.parse(doc.chaptersJson)) : [];
  const counts = contentTables.map(table => new Map(tx.select({ chapterId: table.chapterId, n: count() }).from(table)
    .where(eq(table.documentId, documentId)).groupBy(table.chapterId).all().map(row => [row.chapterId, row.n])));
  const lessonDetails = chapters.map(chapter => ({
    lessonId: chapter.id, title: chapter.title, status: chapter.status,
    vocabCount: counts[0]?.get(chapter.id) ?? 0, grammarCount: counts[1]?.get(chapter.id) ?? 0,
    lineCount: (counts[2]?.get(chapter.id) ?? 0) + (counts[3]?.get(chapter.id) ?? 0),
    exerciseCount: counts[4]?.get(chapter.id) ?? 0,
    hasPassage: (counts[2]?.get(chapter.id) ?? 0) + (counts[3]?.get(chapter.id) ?? 0) > 0,
    hasPreview: false, hasSummary: false,
  }));
  return { documentId, lessons: chapters.length, readyLessons: chapters.filter(chapter => chapter.status === 'ready').length,
    vocab: lessonDetails.reduce((n,row) => n+row.vocabCount,0), grammar: lessonDetails.reduce((n,row) => n+row.grammarCount,0),
    lines: lessonDetails.reduce((n,row) => n+row.lineCount,0), exercises: lessonDetails.reduce((n,row) => n+row.exerciseCount,0),
    passageLessons: lessonDetails.filter(row => row.hasPassage).length, lessonDetails };
}

/** Public reading representation only; never persisted as a second content source. */
export function textbookViewInTx(tx: Tx, documentId: string): TextbookAST | null {
  const doc = tx.select().from(documents).where(eq(documents.id, documentId)).get();
  if (!doc?.chaptersJson) return null;
  const chapters = ChapterManifestSchema.parse(JSON.parse(doc.chaptersJson));
  const language = LanguageCodeSchema.parse(doc.language.toUpperCase());
  const vocabulary = tx.select({ local: textbookVocabulary, global: globalVocabulary }).from(textbookVocabulary)
    .innerJoin(globalVocabulary, eq(textbookVocabulary.vocabularyId, globalVocabulary.id)).where(eq(textbookVocabulary.documentId, documentId)).orderBy(textbookVocabulary.ord).all();
  const grammar = tx.select().from(textbookKnowledge).where(eq(textbookKnowledge.documentId, documentId)).orderBy(textbookKnowledge.ord).all();
  const articles = tx.select().from(textbookArticles).where(eq(textbookArticles.documentId, documentId)).orderBy(textbookArticles.ord).all();
  const sentences = tx.select().from(textbookSentences).where(eq(textbookSentences.documentId, documentId)).orderBy(textbookSentences.ord).all();
  const exercises = tx.select().from(textbookExerciseItems).where(eq(textbookExerciseItems.documentId, documentId)).orderBy(textbookExerciseItems.ord).all();
  return { id: doc.id, title: doc.title, shortTitle: doc.title, language, level: '', outlineConfirmed: true,
    ...(doc.sourceFingerprint ? { sourceFingerprint: doc.sourceFingerprint } : {}), totalLessons: chapters.filter(chapter => chapter.kind === 'lesson').length,
    lessons: chapters.map(chapter => ({
      id: chapter.id, title: chapter.title, lessonNumber: chapter.order, kind: chapter.kind, status: chapter.status,
      ...(chapter.startPage ? { startPage: chapter.startPage } : {}), ...(chapter.endPage ? { endPage: chapter.endPage } : {}),
      learningContent: TextbookLearningContentSchema.parse({
        grammar: grammar.filter(row => row.chapterId === chapter.id).map(row => ({ id: row.id, kind: row.kind, title: row.title, explanation: row.explanation, source: row.source, connection: row.connection || undefined, aiExplanation: row.aiExplanation || undefined, examples: parseExamples(row.examplesJson) })),
        vocabulary: vocabulary.filter(({local}) => local.chapterId === chapter.id).map(({local,global}) => ({ id: local.id, vocabularyId: global.id, word: global.word, reading: global.reading || undefined, meaning: local.meaning, level: global.jlptLevel, partOfSpeech: local.partOfSpeech || undefined, pitch: local.pitch || undefined, explanation: local.explanation || undefined, usage: local.usageNotes || undefined, contextNote: local.contextNote || undefined, source: local.source, examples: parseExamples(local.examplesJson) })),
        articles: articles.filter(row => row.chapterId === chapter.id).map(row => ({ id: row.id, title: row.title || undefined, text: row.text, translation: row.translation || undefined, source: row.source })),
        sentences: sentences.filter(row => row.chapterId === chapter.id).map(row => ({ id: row.id, text: row.text, translation: row.translation || undefined, explanation: row.explanation || undefined, speaker: row.speaker || undefined, source: row.source })),
        exercises: exercises.filter(row => row.chapterId === chapter.id).map(row => ({ id: row.id, type: row.type, prompt: row.prompt, options: row.optionsJson ? JSON.parse(row.optionsJson) : undefined, left: row.leftJson ? JSON.parse(row.leftJson) : undefined, right: row.rightJson ? JSON.parse(row.rightJson) : undefined, ...(row.answerJson ? { answer: JSON.parse(row.answerJson) } : {}), difficultyTier: row.difficultyTier, difficultyReason: row.difficultyReason, explanation: row.explanation || undefined, gradingNotes: row.gradingNotes ?? undefined, source: row.source })),
        material: tx.select().from(textbookMaterials).where(and(eq(textbookMaterials.documentId, documentId),eq(textbookMaterials.chapterId, chapter.id))).get()?.text ?? null,
      }),
      vocabularies: vocabulary.filter(word => word.local.chapterId === chapter.id).map(({ local, global }) => {
        const first = parseExamples(local.examplesJson)[0];
        return { id: local.id, kanji: global.word, kana: global.reading, pos: local.partOfSpeech ?? '', chinese: local.meaning, pitchAccent: local.pitch ?? '',
          ...(first ? { example: { japanese: first.text, chinese: first.translation ?? '' } } : {}) };
      }),
      grammarPoints: grammar.filter(point => point.chapterId === chapter.id).map(point => ({ id: point.id, title: point.title, connection: point.connection ?? '', explanation: point.explanation,
        examples: parseExamples(point.examplesJson).map(example => ({ japanese: example.text, chinese: example.translation ?? '' })) })),
      dialogues: [...articles.filter(article => article.chapterId === chapter.id).flatMap(projectArticleToDialogues),
        ...sentences.filter(sentence => sentence.chapterId === chapter.id).map(sentence => ({ speaker: sentence.speaker ?? '', japanese: sentence.text, chinese: sentence.translation ?? '' }))],
      passageMd: articles.filter(article => article.chapterId === chapter.id).map(article => article.text).join('\n\n') || null,
      exercises: exercises.filter(exercise => exercise.chapterId === chapter.id).map(exercise => ({ id: exercise.id, type: ExerciseTypeSchema.parse(exercise.type), prompt: exercise.prompt,
        ...(exercise.optionsJson ? { options: StringListSchema.parse(JSON.parse(exercise.optionsJson)) } : {}),
        answer: exercise.answerJson ? (typeof JSON.parse(exercise.answerJson) === 'string' ? JSON.parse(exercise.answerJson) as string : exercise.answerJson) : '',
        ...(exercise.explanation ? { explanation: exercise.explanation } : {}) })),
    })),
  };
}

export async function completeTextbookChapter(deps: { db: DrizzleDb }, scope: TextbookScope): Promise<Result<CommitLessonKnowledgeOutput, BusinessError>> {
  try {
    return ok(deps.db.transaction(tx => {
      return completeTextbookChapterInTx(tx, scope);
    }));
  } catch (cause) { return err(cause instanceof BusinessError ? cause : translateToBusinessError(cause, { category: 'DATABASE', fallbackMessage: '章节完成状态保存失败，可重试' })); }
}

export function completeTextbookChapterInTx(tx: Tx, scope: TextbookScope): CommitLessonKnowledgeOutput {
      const { manifest } = getBoundChapter(tx, scope);
      const stats = textbookStatsInTx(tx, scope.documentId);
      const chapter = stats.lessonDetails.find(item => item.lessonId === scope.chapterId)!;
      const material = tx.select().from(textbookMaterials).where(and(eq(textbookMaterials.documentId, scope.documentId), eq(textbookMaterials.chapterId, scope.chapterId))).get();
      if (!chapter.lineCount && !chapter.vocabCount && !chapter.grammarCount && !chapter.exerciseCount && !material?.text.trim()) throw new BusinessError('E_CONTENT_MISSING', '本章还没有保存任何内容', 'VALIDATION', true);
      const next = manifest.map(item => item.id === scope.chapterId ? { ...item, status: 'ready' as const } : item);
      tx.update(documents).set({ chaptersJson: JSON.stringify(next), updatedAt: nowIso() }).where(eq(documents.id, scope.documentId)).run();
      return { documentId: scope.documentId, lessonId: scope.chapterId, stats: { vocabCount: chapter.vocabCount, grammarCount: chapter.grammarCount, exerciseCount: chapter.exerciseCount, hasPassage: chapter.hasPassage }, allLessonsReady: next.every(item => item.status === 'ready') };
}
