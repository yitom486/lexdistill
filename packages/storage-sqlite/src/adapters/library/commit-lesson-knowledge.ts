import { and, eq, sql } from 'drizzle-orm';
import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
  nowIso,
} from '@study-studio/shared';
import {
  documents,
  textbookLessons,
  textbookVocab,
  textbookGrammar,
  textbookExercises,
} from '../../schema.js';
import type { DrizzleDb } from '../../connection.js';

export interface LessonVocabularyInput {
  surface: string;
  reading?: string | undefined;
  pos?: string | undefined;
  glossZh?: string | undefined;
  pitch?: string | undefined;
  exampleJa?: string | undefined;
  exampleZh?: string | undefined;
}

export interface LessonKnowledgePointInput {
  title: string;
  connection?: string | undefined;
  explanation?: string | undefined;
  examples?: Array<{ japanese: string; chinese?: string | undefined }> | undefined;
}

export interface LessonExerciseInput {
  type: string;
  prompt: string;
  options?: string[] | undefined;
  answer: string;
  explanation?: string | undefined;
}

export interface CommitLessonKnowledgeInput {
  documentId: string;
  lessonId: string;
  title?: string | undefined;
  passageMd?: string | undefined;
  vocabularies?: LessonVocabularyInput[] | undefined;
  knowledgePoints?: LessonKnowledgePointInput[] | undefined;
  exercises?: LessonExerciseInput[] | undefined;
}

export interface CommitLessonKnowledgeOutput {
  documentId: string;
  lessonId: string;
  stats: {
    vocabCount: number;
    grammarCount: number;
    exerciseCount: number;
    hasPassage: boolean;
  };
  allLessonsReady: boolean;
}

/**
 * 章节内容提炼原子回填（TOC 白名单对齐核验 + 槽位状态翻转为 ready）：
 * 1. 强制校验槽位 (documentId, lessonId) 必须在已建目录中存在；
 * 2. 在单一事务内：
 *    - 更新该课槽位状态 status='ready'，并存入规整的精读课文 passage_md；
 *    - 清理该课已有子项，批量写入生词 (textbook_vocab) 与语法 (textbook_grammar)；
 *    - 若有习题，写入 textbook_exercises；
 *    - 同步更新 textbook_fts 全文索引；
 * 3. 统计全书 lesson 是否已全部完成，返回结果。
 */
export async function commitLessonKnowledge(
  deps: { db: DrizzleDb },
  input: CommitLessonKnowledgeInput
): Promise<Result<CommitLessonKnowledgeOutput, BusinessError>> {
  if (!input.documentId?.trim() || !input.lessonId?.trim()) {
    return err(new BusinessError('E_INVALID_INPUT', '缺少必要参数 documentId 或 lessonId', 'VALIDATION', false));
  }

  const docId = input.documentId.trim();
  const lId = input.lessonId.trim();

  try {
    const stats = deps.db.transaction((tx) => {
      // 1. 目录白名单强制校验
      const slots = tx
        .select()
        .from(textbookLessons)
        .where(and(eq(textbookLessons.documentId, docId), eq(textbookLessons.lessonId, lId)))
        .limit(1)
        .all();

      if (slots.length === 0) {
        throw new BusinessError(
          'E_TOC_SLOT_NOT_FOUND',
          `章节槽位不存在：文档 "${docId}" 中未找到课次 "${lId}"。严禁脱离已确认目录凭空造课，请核对目录中的课次 ID。`,
          'VALIDATION',
          false
        );
      }

      // 2. 更新该课槽位
      tx.update(textbookLessons)
        .set({
          status: 'ready',
          ...(input.title?.trim() ? { title: input.title.trim().slice(0, 200) } : {}),
          ...(input.passageMd !== undefined ? { passageMd: input.passageMd } : {}),
        })
        .where(and(eq(textbookLessons.documentId, docId), eq(textbookLessons.lessonId, lId)))
        .run();

      // 3. 幂等清理该课已有生词、语法、习题与检索索引
      tx.delete(textbookVocab)
        .where(and(eq(textbookVocab.documentId, docId), eq(textbookVocab.lessonId, lId)))
        .run();
      tx.delete(textbookGrammar)
        .where(and(eq(textbookGrammar.documentId, docId), eq(textbookGrammar.lessonId, lId)))
        .run();
      tx.delete(textbookExercises)
        .where(and(eq(textbookExercises.documentId, docId), eq(textbookExercises.lessonId, lId)))
        .run();
      tx.run(sql`DELETE FROM textbook_fts WHERE document_id = ${docId} AND lesson_id = ${lId}`);

      // 4. 写入生词 (textbook_vocab)
      const vocabs = Array.isArray(input.vocabularies) ? input.vocabularies : [];
      const vocabRows: Array<typeof textbookVocab.$inferInsert> = [];
      const vocabFts: Array<{ surface: string; reading: string | null; gloss: string | null; ord: number }> = [];

      let vOrd = 0;
      for (const v of vocabs) {
        if (!v || typeof v !== 'object') continue;
        const surface = typeof v.surface === 'string' ? v.surface.trim().slice(0, 64) : '';
        if (!surface) continue;

        const reading = typeof v.reading === 'string' ? v.reading.slice(0, 64) : null;
        const pos = typeof v.pos === 'string' ? v.pos.slice(0, 32) : null;
        const glossZh = typeof v.glossZh === 'string' ? v.glossZh.slice(0, 500) : null;
        const pitch = typeof v.pitch === 'string' ? v.pitch.slice(0, 16) : null;
        const exJa = typeof v.exampleJa === 'string' ? v.exampleJa.slice(0, 500) : null;
        const exZh = typeof v.exampleZh === 'string' ? v.exampleZh.slice(0, 500) : null;

        vocabRows.push({
          documentId: docId,
          lessonId: lId,
          ord: vOrd,
          surface,
          reading,
          pos,
          glossZh,
          pitch,
          exampleJa: exJa,
          exampleZh: exZh,
        });
        vocabFts.push({ surface, reading, gloss: glossZh, ord: vOrd });
        vOrd++;
      }

      if (vocabRows.length > 0) {
        tx.insert(textbookVocab).values(vocabRows).run();
        for (const f of vocabFts) {
          tx.run(
            sql`INSERT INTO textbook_fts (surface, reading, gloss, ja, zh, document_id, lesson_id, kind, ref)
                VALUES (${f.surface}, ${f.reading}, ${f.gloss}, ${null}, ${null}, ${docId}, ${lId}, ${'vocab'}, ${`${lId}#v${f.ord}`})`
          );
        }
      }

      // 5. 写入语法与知识点 (textbook_grammar)
      const grammars = Array.isArray(input.knowledgePoints) ? input.knowledgePoints : [];
      const grammarRows: Array<typeof textbookGrammar.$inferInsert> = [];

      let gOrd = 0;
      for (const g of grammars) {
        if (!g || typeof g !== 'object') continue;
        const title = typeof g.title === 'string' ? g.title.trim().slice(0, 200) : '';
        if (!title) continue;

        const connection = typeof g.connection === 'string' ? g.connection.slice(0, 500) : null;
        const explanation = typeof g.explanation === 'string' ? g.explanation.slice(0, 2000) : null;
        const rawExamples = Array.isArray(g.examples) ? g.examples : [];
        const examplesJson = JSON.stringify(
          rawExamples.slice(0, 10).map((e) => ({
            japanese: String(e.japanese || '').slice(0, 500),
            chinese: String(e.chinese || '').slice(0, 500),
          }))
        );

        grammarRows.push({
          documentId: docId,
          lessonId: lId,
          ord: gOrd,
          title,
          connection,
          explanation,
          examplesJson,
        });
        gOrd++;
      }

      if (grammarRows.length > 0) {
        tx.insert(textbookGrammar).values(grammarRows).run();
      }

      // 6. 写入课后习题 (textbook_exercises)
      const exercises = Array.isArray(input.exercises) ? input.exercises : [];
      const exerciseRows: Array<typeof textbookExercises.$inferInsert> = [];

      let eOrd = 0;
      for (const e of exercises) {
        if (!e || typeof e !== 'object') continue;
        const prompt = typeof e.prompt === 'string' ? e.prompt.trim().slice(0, 2000) : '';
        if (!prompt) continue;

        const type = typeof e.type === 'string' ? e.type.trim().slice(0, 32) : 'CHOICE';
        const rawOptions = Array.isArray(e.options) ? e.options : [];
        const optionsJson = JSON.stringify(
          rawOptions.filter((o): o is string => typeof o === 'string').slice(0, 10).map((o) => o.slice(0, 500))
        );
        const answer = typeof e.answer === 'string' ? e.answer.slice(0, 2000) : '';
        const explanation = typeof e.explanation === 'string' ? e.explanation.slice(0, 2000) : null;

        exerciseRows.push({
          documentId: docId,
          lessonId: lId,
          ord: eOrd,
          exerciseId: `${lId}-ex${eOrd + 1}`,
          type,
          prompt,
          optionsJson,
          answer,
          explanation,
        });
        eOrd++;
      }

      if (exerciseRows.length > 0) {
        tx.insert(textbookExercises).values(exerciseRows).run();
      }

      // 7. 统计全书进度
      const pendingRows = tx
        .select({ id: textbookLessons.lessonId })
        .from(textbookLessons)
        .where(
          and(
            eq(textbookLessons.documentId, docId),
            eq(textbookLessons.status, 'pending'),
            eq(textbookLessons.kind, 'lesson')
          )
        )
        .all();

      const allLessonsReady = pendingRows.length === 0;
      if (allLessonsReady) {
        tx.update(documents)
          .set({ updatedAt: nowIso() })
          .where(eq(documents.id, docId))
          .run();
      }

      return {
        vocabCount: vOrd,
        grammarCount: gOrd,
        exerciseCount: eOrd,
        hasPassage: Boolean(input.passageMd?.trim()),
        allLessonsReady,
      };
    });

    return ok({
      documentId: docId,
      lessonId: lId,
      stats: {
        vocabCount: stats.vocabCount,
        grammarCount: stats.grammarCount,
        exerciseCount: stats.exerciseCount,
        hasPassage: stats.hasPassage,
      },
      allLessonsReady: stats.allLessonsReady,
    });
  } catch (e) {
    if (e instanceof BusinessError) {
      return err(e);
    }
    return err(translateToBusinessError(e, 'commitLessonKnowledge'));
  }
}
