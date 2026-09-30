import { BusinessError, err, ok, type Result } from '@study-studio/shared';
import { parseTextbookAST, projectLessonContent, type TextbookAST } from '@study-studio/document-model';
import { eq, sql } from 'drizzle-orm';
import {
  textbookExercises,
  textbookGrammar,
  textbookLessons,
  textbookLines,
  textbookVocab,
} from '../../schema.js';
import type { DrizzleDb } from '../../connection.js';

/**
 * D3 起家在 storage-sqlite（前身 gateway modules/library/persistence/textbook-shred.ts，
 * 逻辑不变）。参数收窄为 `{ db }`；`ShredTx` 本地定义（同源 DrizzleDb）。
 */

export interface ShredStats {
  lessons: number;
  vocab: number;
  grammar: number;
  lines: number;
  /** 自带习题行数（v16；AST exercises 同源） */
  exercises: number;
  ftsRows: number;
  /** 精确命中词典的生词数（含文法标题命中） */
  mappedEntries: number;
  /** 未命中词典的行数（可统计覆盖率，绝不臆造边） */
  unmapped: number;
}

/** AST 语种 → 本地词典 language（小写；未知回 null，映射整批跳过但行照存）。 */
function toDictLanguage(bookLanguage: unknown): string | null {
  if (bookLanguage === 'JA') return 'ja';
  if (bookLanguage === 'EN') return 'en';
  if (bookLanguage === 'KO') return 'ko';
  return null;
}

/**
 * 路由层复用：astJson（string 或对象）→ 合法才回 book，否则 null（坏 AST 静默跳过 shred）。
 * 调用方 save 成功后调，失败只 warn，绝不推翻主路径。
 */
export function tryParseTextbookAst(raw: unknown): TextbookAST | null {
  try {
    const parsed = parseTextbookAST(
      typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw
    );
    return parsed.ok ? parsed.value : null;
  } catch {
    return null;
  }
}

/**
 * 教材 shred（drizzle 事务内全删全插）：
 * - 输入是已过 zod 的 TextbookAST（调用方保证），这里只做防御性收窄；
 * - 行表删插走 drizzle 构造器（列名拼错编译期炸，不再裸写 INSERT）；
 * - FTS 虚表 + 词典精确匹配走原生 sql（drizzle 无 FTS 一等支持）；
 * - v30 起 term_map 表退役：映射计数（mappedEntries/unmapped）仍在内存统计，
 *   供覆盖率与健康检查语义延续，但不再落表（读者只剩 doctor/seed-gating，已同步移除）；
 * - skill_id 映射靠分类结果另行落盘（knowledge_points），不在此臆造边；
 * - 课文行（lines）只进 FTS（行级映射粒度另议，不膨胀）。
 */
export type ShredTx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];

/**
 * term_map 去重键使用持久化的完整文本，清洗空白但不截断。
 * shred 与 seed projection health 共用，保证两边口径一字相同。
 */
export function termMapDedupKey(documentId: string, lessonId: string, kind: string, refText: string): string {
  return JSON.stringify([documentId, lessonId, kind, refText]);
}

export function shredDocument(
  deps: { db: DrizzleDb },
  documentId: string,
  book: TextbookAST
): Result<ShredStats, BusinessError> {
  if (!documentId) {
    return err(new BusinessError('E_INVALID_INPUT', '缺少文档标识', 'VALIDATION'));
  }
  try {
    const stats = deps.db.transaction((tx) => shredIntoTransaction(tx, documentId, book));
    return ok(stats);
  } catch (e) {
    if (e instanceof BusinessError) return err(e);
    return err(
      new BusinessError('E_INTERNAL', '教材拆行入库失败，请重试', 'DATABASE', true)
    );
  }
}

/**
 * 事务内 shred 内核（供单事务组合复用：seed AST 迁移时“AST 更新 + shred”原子落库）。
 * 调用方负责开事务；本函数不建事务、不吞错（抛给外层回滚）。
 * 注：函数体缩进保持原事务闭包层级，仅外层包装变化，行为一字未动。
 */
export function shredIntoTransaction(tx: ShredTx, documentId: string, book: TextbookAST): ShredStats {
  const lessons = Array.isArray(book?.lessons) ? book.lessons.map(lesson => lesson.content ? { ...lesson, ...projectLessonContent(lesson.content) } : lesson) : [];
  const dictLang = toDictLanguage(book?.language);
  const stats: ShredStats = {
    lessons: 0,
    vocab: 0,
    grammar: 0,
    lines: 0,
    exercises: 0,
    ftsRows: 0,
    mappedEntries: 0,
    unmapped: 0,
  };
  /** 词典精确命中（headword 逐字相等）；无语种/未命中回 null（记 NULL 行，不臆造边）。 */
  const findEntry = (
    tx: ShredTx,
    surface: string
  ): string | null => {
    if (!dictLang) return null;
    const rows = tx.all(sql`SELECT id FROM local_dictionary_entries WHERE language = ${dictLang} AND headword = ${surface} ORDER BY id LIMIT 1`) as unknown[];
    const first = rows[0] as { id?: unknown } | undefined;
    return first && typeof first.id === 'string' ? first.id : null;
  };
      tx.delete(textbookLessons).where(eq(textbookLessons.documentId, documentId)).run();
      tx.delete(textbookVocab).where(eq(textbookVocab.documentId, documentId)).run();
      tx.delete(textbookGrammar).where(eq(textbookGrammar.documentId, documentId)).run();
      tx.delete(textbookLines).where(eq(textbookLines.documentId, documentId)).run();
      tx.delete(textbookExercises).where(eq(textbookExercises.documentId, documentId)).run();
      tx.run(sql`DELETE FROM textbook_fts WHERE document_id = ${documentId}`);

      for (const [li, lesson] of lessons.entries()) {
        if (!lesson || typeof lesson !== 'object') continue;
        const l = lesson as { id?: unknown; lessonNumber?: unknown; title?: unknown };
        if (typeof l.id !== 'string' || !l.id) continue;
        const lessonId = l.id;
        // P1-B：sort_order 唯一来源 = 最终 canonical AST 数组 index + 1（1-based 连续）。
        // 禁止 sort_order = lessonNumber（可 gap）、禁止从 lesson_id 后缀/插入顺序推导。
        const sortOrder = li + 1;
        // lesson_number 为教材课号；查询顺序使用 sort_order。
        const lessonNumber =
          typeof l.lessonNumber === 'number' && Number.isInteger(l.lessonNumber) && l.lessonNumber > 0
            ? l.lessonNumber
            : stats.lessons + 1;
        const title = typeof l.title === 'string' ? l.title : '';
        // 注意：drizzle builder 是惰性的——同步事务里必须显式 .run()，
        // 光 tx.insert(...).values(...) 不执行也不报错（静默零写，已实测）。
        tx.insert(textbookLessons).values({
          documentId, lessonId, lessonNumber, title, sortOrder,
          kind: lesson.kind ?? 'lesson', parentId: lesson.parentId ?? null,
          startPage: lesson.startPage ?? null, endPage: lesson.endPage ?? null,
          status: lesson.status ?? 'pending',
          passageMd: lesson.passageMd ?? null,
          previewJson: lesson.previewJson ?? null, summaryJson: lesson.summaryJson ?? null,
          contentJson: lesson.content ? JSON.stringify(lesson.content) : null,
          submissionId: lesson.submissionId ?? null,
        }).run();
        stats.lessons++;

        const vocabularies = Array.isArray((lesson as { vocabularies?: unknown }).vocabularies)
          ? ((lesson as { vocabularies: unknown[] }).vocabularies)
          : [];
        const vocabRows: Array<typeof textbookVocab.$inferInsert> = [];
        const vocabFts: Array<{ surface: string; reading: string | null; gloss: string | null; ord: number }> = [];
        let vOrd = 0;
        for (const v of vocabularies) {
          if (!v || typeof v !== 'object') continue;
          const r = v as Record<string, unknown>;
          if (typeof r.kanji !== 'string' || !r.kanji.trim()) continue;
          const surface = r.kanji.trim();
          const reading = typeof r.kana === 'string' ? r.kana : null;
          const pos = typeof r.pos === 'string' ? r.pos : null;
          const gloss = typeof r.chinese === 'string' ? r.chinese : null;
          const pitch = typeof r.pitchAccent === 'string' ? r.pitchAccent : null;
          const ex = r.example && typeof r.example === 'object' ? (r.example as Record<string, unknown>) : null;
          const exJa = ex && typeof ex.japanese === 'string' ? ex.japanese : null;
          const exZh = ex && typeof ex.chinese === 'string' ? ex.chinese : null;
          vocabRows.push({
            documentId, lessonId, ord: vOrd, surface, reading, pos,
            glossZh: gloss, pitch, exampleJa: exJa, exampleZh: exZh,
            source: lesson.content?.vocabularies[vOrd]?.source ?? null,
            aiExplanation: lesson.content?.vocabularies[vOrd]?.aiExplanation ?? null,
            tocId: lesson.content?.vocabularies[vOrd]?.tocId ?? null,
            fieldSourcesJson: lesson.content?.vocabularies[vOrd]?.fieldSources ? JSON.stringify(lesson.content.vocabularies[vOrd]!.fieldSources) : null,
          });
          vocabFts.push({ surface, reading, gloss, ord: vOrd });
          stats.vocab++;
          vOrd++;
        }
        if (vocabRows.length > 0) tx.insert(textbookVocab).values(vocabRows).run();
        for (const f of vocabFts) {
          tx.run(
            sql`INSERT INTO textbook_fts (surface, reading, gloss, ja, zh, document_id, lesson_id, kind, ref)
                VALUES (${f.surface}, ${f.reading}, ${f.gloss}, ${null}, ${null}, ${documentId}, ${lessonId}, ${'vocab'}, ${`${lessonId}#v${f.ord}`})`
          );
          stats.ftsRows++;
        }

        const grammars = Array.isArray((lesson as { grammarPoints?: unknown }).grammarPoints)
          ? ((lesson as { grammarPoints: unknown[] }).grammarPoints)
          : [];
        const grammarRows: Array<typeof textbookGrammar.$inferInsert> = [];
        const grammarTitles: string[] = [];
        let gOrd = 0;
        for (const g of grammars) {
          if (!g || typeof g !== 'object') continue;
          const r = g as Record<string, unknown>;
          if (typeof r.title !== 'string' || !r.title.trim()) continue;
          const gTitle = r.title.trim();
          const connection = typeof r.connection === 'string' ? r.connection : null;
          const explanation = typeof r.explanation === 'string' ? r.explanation : null;
          // 文法例句全量存 JSON（v16 前只在 AST，查询面够不着；上限 10 条防异常膨胀）。
          const rawExamples = Array.isArray(r.examples) ? (r.examples as unknown[]) : [];
          const examplesJson = JSON.stringify(
            rawExamples
              .filter(
                (e): e is Record<string, unknown> =>
                  !!e && typeof e === 'object' && typeof (e as Record<string, unknown>).japanese === 'string'
              )
              .map((e) => ({
                japanese: String(e.japanese),
                chinese: typeof e.chinese === 'string' ? e.chinese : '',
              }))
          );
          grammarRows.push({
            documentId, lessonId, ord: gOrd, title: gTitle, connection, explanation, examplesJson,
            source: lesson.content?.knowledgePoints[gOrd]?.source ?? null,
            tocId: lesson.content?.knowledgePoints[gOrd]?.tocId ?? null,
            aiExplanation: lesson.content?.knowledgePoints[gOrd]?.aiExplanation ?? null,
            fieldSourcesJson: lesson.content?.knowledgePoints[gOrd]?.fieldSources ? JSON.stringify(lesson.content.knowledgePoints[gOrd]!.fieldSources) : null,
          });
          grammarTitles.push(gTitle);
          stats.grammar++;
          gOrd++;
        }
        if (grammarRows.length > 0) tx.insert(textbookGrammar).values(grammarRows).run();
        // v30：映射计数只在内存统计（mappedEntries/unmapped 语义不变），不再落 term_map 表。
        // 同课同 kind 同 ref_text 只计首条；vocab/grammar（kind 不同）与跨 lesson 永不互斥。
        {
          const seenTermKeys = new Set<string>();
          for (const f of vocabFts) {
            const key = termMapDedupKey(documentId, lessonId, 'vocab', f.surface);
            if (seenTermKeys.has(key)) continue;
            seenTermKeys.add(key);
            if (findEntry(tx, f.surface)) stats.mappedEntries++;
            else stats.unmapped++;
          }
          for (const gTitle of grammarTitles) {
            const key = termMapDedupKey(documentId, lessonId, 'grammar', gTitle);
            if (seenTermKeys.has(key)) continue;
            seenTermKeys.add(key);
            if (findEntry(tx, gTitle)) stats.mappedEntries++;
            else stats.unmapped++;
          }
        }

        const dialogues = Array.isArray((lesson as { dialogues?: unknown }).dialogues)
          ? ((lesson as { dialogues: unknown[] }).dialogues)
          : [];
        const lineRows: Array<typeof textbookLines.$inferInsert> = [];
        let dOrd = 0;
        for (const d of dialogues) {
          if (!d || typeof d !== 'object') continue;
          const r = d as Record<string, unknown>;
          if (typeof r.japanese !== 'string' || !r.japanese.trim()) continue;
          const ja = r.japanese.trim();
          const zh = typeof r.chinese === 'string' ? r.chinese : null;
          const speaker = typeof r.speaker === 'string' ? r.speaker : null;
          const block = lesson.content?.blocks[dOrd];
          lineRows.push({ documentId, lessonId, ord: dOrd, speaker, ja, zh,
            blockId: block?.id ?? null, kind: block?.kind ?? null, source: block?.source ?? null, tocId: block?.tocId ?? null,
            fieldSourcesJson: block?.fieldSources ? JSON.stringify(block.fieldSources) : null,
          });
          stats.lines++;
          dOrd++;
        }
        if (lineRows.length > 0) tx.insert(textbookLines).values(lineRows).run();
        lineRows.forEach((row, i) => {
          tx.run(
            sql`INSERT INTO textbook_fts (surface, reading, gloss, ja, zh, document_id, lesson_id, kind, ref)
                VALUES (${null}, ${null}, ${null}, ${row.ja}, ${row.zh}, ${documentId}, ${lessonId}, ${'line'}, ${`${lessonId}#d${i}`})`
          );
          stats.ftsRows++;
        });

        // 自带习题拆行（v16；AST exercises 同源，组卷读这里不再现场解析 AST）。
        // type 非白名单仍原样存（读侧按白名单收敛，未知类型当不透明行，不臆造改写）。
        const exercises = Array.isArray((lesson as { exercises?: unknown }).exercises)
          ? ((lesson as { exercises: unknown[] }).exercises)
          : [];
        const exerciseRows: Array<typeof textbookExercises.$inferInsert> = [];
        let eOrd = 0;
        for (const e of exercises) {
          if (!e || typeof e !== 'object') continue;
          const r = e as Record<string, unknown>;
          if (typeof r.type !== 'string' || !r.type.trim()) continue;
          if (typeof r.prompt !== 'string' || !r.prompt.trim()) continue;
          const exerciseId = typeof r.id === 'string' && r.id ? r.id : null;
          const type = r.type.trim();
          const prompt = r.prompt.trim();
          const rawOptions = Array.isArray(r.options) ? r.options : [];
          const optionsJson = JSON.stringify(
            rawOptions.filter((o): o is string => typeof o === 'string').map((o) => o)
          );
          const answer = typeof r.answer === 'string' ? r.answer : '';
          const explanation = typeof r.explanation === 'string' ? r.explanation : null;
          exerciseRows.push({
            documentId, lessonId, ord: eOrd, exerciseId, type, prompt, optionsJson, answer, explanation,
            source: lesson.content?.exercises[eOrd]?.source ?? null,
            tocId: lesson.content?.exercises[eOrd]?.tocId ?? null,
            answerJson: lesson.content?.exercises[eOrd] ? JSON.stringify(lesson.content.exercises[eOrd]!.answer) : null,
            contentJson: lesson.content?.exercises[eOrd] ? JSON.stringify(lesson.content.exercises[eOrd]) : null,
            fieldSourcesJson: lesson.content?.exercises[eOrd]?.fieldSources ? JSON.stringify(lesson.content.exercises[eOrd]!.fieldSources) : null,
          });
          stats.exercises++;
          eOrd++;
        }
        if (exerciseRows.length > 0) tx.insert(textbookExercises).values(exerciseRows).run();
      }
    return stats;
  }
