import { BusinessError, err, ok, type Result } from '@study-studio/shared';
import { parseTextbookAST, type TextbookAST } from '@study-studio/protocol';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';

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
 * 教材 shred（纯行写，同事务全删全插）：
 * - 输入是已过 zod 的 TextbookAST（调用方保证），这里只做防御性收窄；
 * - textbook_term_map 只记精确匹配（词典 headword 逐字相等），对不上记 NULL 行；
 * - skill_id v1 恒为 NULL（能力映射靠分类结果，另行落盘，不在此臆造边）；
 * - 课文行（lines）只进 FTS，不进 term_map（行级映射粒度另议，不膨胀）。
 */
export function shredDocument(
  deps: RepoDeps,
  documentId: string,
  book: TextbookAST
): Result<ShredStats, BusinessError> {
  if (!documentId) {
    return err(new BusinessError('E_INVALID_INPUT', '缺少文档标识', 'VALIDATION'));
  }
  const lessons = Array.isArray(book?.lessons) ? book.lessons : [];
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
  try {
    const tx = deps.sqlite.transaction(() => {
      const db = deps.sqlite;
      db.prepare('DELETE FROM textbook_lessons WHERE document_id = ?').run(documentId);
      db.prepare('DELETE FROM textbook_vocab WHERE document_id = ?').run(documentId);
      db.prepare('DELETE FROM textbook_grammar WHERE document_id = ?').run(documentId);
      db.prepare('DELETE FROM textbook_lines WHERE document_id = ?').run(documentId);
      db.prepare('DELETE FROM textbook_exercises WHERE document_id = ?').run(documentId);
      db.prepare('DELETE FROM textbook_fts WHERE document_id = ?').run(documentId);
      db.prepare('DELETE FROM textbook_term_map WHERE document_id = ?').run(documentId);

      const insLesson = db.prepare(
        'INSERT INTO textbook_lessons (document_id, lesson_id, lesson_number, title) VALUES (?, ?, ?, ?)'
      );
      const insVocab = db.prepare(
        `INSERT INTO textbook_vocab
           (document_id, lesson_id, ord, surface, reading, pos, gloss_zh, pitch, example_ja, example_zh)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const insGrammar = db.prepare(
        `INSERT INTO textbook_grammar (document_id, lesson_id, ord, title, connection, explanation, examples_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      const insExercise = db.prepare(
        `INSERT INTO textbook_exercises
           (document_id, lesson_id, ord, exercise_id, type, prompt, options_json, answer, explanation)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const insLine = db.prepare(
        'INSERT INTO textbook_lines (document_id, lesson_id, ord, speaker, ja, zh) VALUES (?, ?, ?, ?, ?, ?)'
      );
      const insFts = db.prepare(
        `INSERT INTO textbook_fts
           (surface, reading, gloss, ja, zh, document_id, lesson_id, kind, ref)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const insMap = db.prepare(
        `INSERT INTO textbook_term_map (document_id, lesson_id, kind, ref_text, skill_id, entry_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      const findEntry = dictLang
        ? db.prepare(
            'SELECT id FROM local_dictionary_entries WHERE language = ? AND headword = ? ORDER BY id LIMIT 1'
          )
        : null;

      for (const lesson of lessons) {
        if (!lesson || typeof lesson !== 'object') continue;
        const l = lesson as { id?: unknown; lessonNumber?: unknown; title?: unknown };
        if (typeof l.id !== 'string' || !l.id) continue;
        const lessonId = l.id;
        const lessonNumber =
          typeof l.lessonNumber === 'number' && Number.isInteger(l.lessonNumber) && l.lessonNumber > 0
            ? l.lessonNumber
            : stats.lessons + 1;
        const title = typeof l.title === 'string' ? l.title.slice(0, 200) : '';
        insLesson.run(documentId, lessonId, lessonNumber, title);
        stats.lessons++;

        const vocabularies = Array.isArray((lesson as { vocabularies?: unknown }).vocabularies)
          ? ((lesson as { vocabularies: unknown[] }).vocabularies)
          : [];
        let vOrd = 0;
        for (const v of vocabularies) {
          if (!v || typeof v !== 'object') continue;
          const r = v as Record<string, unknown>;
          if (typeof r.kanji !== 'string' || !r.kanji.trim()) continue;
          const surface = r.kanji.trim().slice(0, 64);
          const reading = typeof r.kana === 'string' ? r.kana.slice(0, 64) : null;
          const pos = typeof r.pos === 'string' ? r.pos.slice(0, 32) : null;
          const gloss = typeof r.chinese === 'string' ? r.chinese.slice(0, 500) : null;
          const pitch = typeof r.pitchAccent === 'string' ? r.pitchAccent.slice(0, 16) : null;
          const ex = r.example && typeof r.example === 'object' ? (r.example as Record<string, unknown>) : null;
          const exJa = ex && typeof ex.japanese === 'string' ? ex.japanese.slice(0, 500) : null;
          const exZh = ex && typeof ex.chinese === 'string' ? ex.chinese.slice(0, 500) : null;
          insVocab.run(documentId, lessonId, vOrd, surface, reading, pos, gloss, pitch, exJa, exZh);
          insFts.run(surface, reading, gloss, null, null, documentId, lessonId, 'vocab', `${lessonId}#v${vOrd}`);
          stats.vocab++;
          stats.ftsRows++;
          let entryId: string | null = null;
          if (findEntry) {
            const hit = findEntry.get(dictLang, surface) as { id?: unknown } | null;
            if (hit && typeof hit.id === 'string') entryId = hit.id;
          }
          insMap.run(documentId, lessonId, 'vocab', surface, null, entryId);
          if (entryId) stats.mappedEntries++;
          else stats.unmapped++;
          vOrd++;
        }

        const grammars = Array.isArray((lesson as { grammarPoints?: unknown }).grammarPoints)
          ? ((lesson as { grammarPoints: unknown[] }).grammarPoints)
          : [];
        let gOrd = 0;
        for (const g of grammars) {
          if (!g || typeof g !== 'object') continue;
          const r = g as Record<string, unknown>;
          if (typeof r.title !== 'string' || !r.title.trim()) continue;
          const gTitle = r.title.trim().slice(0, 200);
          const connection = typeof r.connection === 'string' ? r.connection.slice(0, 500) : null;
          const explanation = typeof r.explanation === 'string' ? r.explanation.slice(0, 2000) : null;
          // 文法例句全量存 JSON（v16 前只在 AST，查询面够不着；上限 10 条防异常膨胀）。
          const rawExamples = Array.isArray(r.examples) ? (r.examples as unknown[]) : [];
          const examplesJson = JSON.stringify(
            rawExamples
              .filter(
                (e): e is Record<string, unknown> =>
                  !!e && typeof e === 'object' && typeof (e as Record<string, unknown>).japanese === 'string'
              )
              .slice(0, 10)
              .map((e) => ({
                japanese: String(e.japanese).slice(0, 500),
                chinese: typeof e.chinese === 'string' ? e.chinese.slice(0, 500) : '',
              }))
          );
          insGrammar.run(documentId, lessonId, gOrd, gTitle, connection, explanation, examplesJson);
          stats.grammar++;
          let entryId: string | null = null;
          if (findEntry) {
            const hit = findEntry.get(dictLang, gTitle) as { id?: unknown } | null;
            if (hit && typeof hit.id === 'string') entryId = hit.id;
          }
          insMap.run(documentId, lessonId, 'grammar', gTitle, null, entryId);
          if (entryId) stats.mappedEntries++;
          else stats.unmapped++;
          gOrd++;
        }

        const dialogues = Array.isArray((lesson as { dialogues?: unknown }).dialogues)
          ? ((lesson as { dialogues: unknown[] }).dialogues)
          : [];
        let dOrd = 0;
        for (const d of dialogues) {
          if (!d || typeof d !== 'object') continue;
          const r = d as Record<string, unknown>;
          if (typeof r.japanese !== 'string' || !r.japanese.trim()) continue;
          const ja = r.japanese.trim().slice(0, 2000);
          const zh = typeof r.chinese === 'string' ? r.chinese.slice(0, 2000) : null;
          const speaker = typeof r.speaker === 'string' ? r.speaker.slice(0, 64) : null;
          insLine.run(documentId, lessonId, dOrd, speaker, ja, zh);
          insFts.run(null, null, null, ja, zh, documentId, lessonId, 'line', `${lessonId}#d${dOrd}`);
          stats.lines++;
          stats.ftsRows++;
          dOrd++;
        }

        // 自带习题拆行（v16；AST exercises 同源，组卷读这里不再现场解析 AST）。
        // type 非白名单仍原样存（读侧按白名单收敛，未知类型当不透明行，不臆造改写）。
        const exercises = Array.isArray((lesson as { exercises?: unknown }).exercises)
          ? ((lesson as { exercises: unknown[] }).exercises)
          : [];
        let eOrd = 0;
        for (const e of exercises) {
          if (!e || typeof e !== 'object') continue;
          const r = e as Record<string, unknown>;
          if (typeof r.type !== 'string' || !r.type.trim()) continue;
          if (typeof r.prompt !== 'string' || !r.prompt.trim()) continue;
          const exerciseId = typeof r.id === 'string' && r.id ? r.id.slice(0, 64) : null;
          const type = r.type.trim().slice(0, 32);
          const prompt = r.prompt.trim().slice(0, 2000);
          const rawOptions = Array.isArray(r.options) ? r.options : [];
          const optionsJson = JSON.stringify(
            rawOptions.filter((o): o is string => typeof o === 'string').slice(0, 10).map((o) => o.slice(0, 500))
          );
          const answer = typeof r.answer === 'string' ? r.answer.slice(0, 2000) : '';
          const explanation = typeof r.explanation === 'string' ? r.explanation.slice(0, 2000) : null;
          insExercise.run(documentId, lessonId, eOrd, exerciseId, type, prompt, optionsJson, answer, explanation);
          stats.exercises++;
          eOrd++;
        }
      }
    });
    tx();
    return ok(stats);
  } catch (e) {
    if (e instanceof BusinessError) return err(e);
    return err(
      new BusinessError('E_INTERNAL', '教材拆行入库失败，请重试', 'DATABASE', true)
    );
  }
}
