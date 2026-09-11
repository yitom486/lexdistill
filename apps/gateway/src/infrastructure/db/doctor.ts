import { createHash } from 'node:crypto';
import type { Database } from 'bun:sqlite';

export interface DoctorFinding {
  rule: string;
  level: 'PASS' | 'WARN' | 'FAIL';
  count: number;
  detail: string;
}

export interface DoctorReport {
  findings: DoctorFinding[];
  errors: string[];
  warnings: string[];
}

/**
 * db doctor：无 FK 架构下的只读完整性检查。
 * - 只 SELECT，不写库（调用方可用 readonly 句柄）；
 * - 表不存在即跳过该规则（部分库/未来删表不炸）；
 * - 约定外的值（term_occurrences.document_id 是 docRef 字符串）按文档排除，不误报。
 */
export function runDoctor(db: Database): DoctorReport {
  const findings: DoctorFinding[] = [];
  const existing = new Set(
    (
      db
        .query("SELECT name AS n FROM sqlite_master WHERE type IN ('table','view')")
        .all() as Array<{ n: string }>
    ).map((r) => r.n)
  );
  const has = (...names: string[]) => names.every((n) => existing.has(n));
  const hasColumn = (table: string, column: string): boolean => {
    if (!existing.has(table)) return false;
    try {
      const cols = db.query(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
      return cols.some((c) => c.name === column);
    } catch {
      return false;
    }
  };
  const count = (sql: string): number => {
    const row = db.query(sql).get() as { n: number } | null;
    return row ? row.n : 0;
  };

  /** 与持久化指纹同口径（UTF-8 字节 SHA-256 hex），避免跨层 import。 */
  const sha256HexTextLocal = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

  const push = (rule: string, level: DoctorFinding['level'], n: number, detail: string) => {
    findings.push({ rule, level, count: n, detail });
  };

  // ---- 0. schema 覆盖：预期表缺失不再静默跳过（缺席=结构损坏或史前库） ----
  // 注意：缺席只 WARN 不 FAIL——doctor 也跑在部分库/测试库上，缺席本身不是数据错。
  const EXPECTED_TABLES = [
    'documents',
    'textbook_lessons', 'textbook_lines', 'textbook_vocab', 'textbook_grammar',
    'textbook_exercises', 'textbook_term_map', 'textbook_fts',
    'local_dictionary_entries', 'dictionary_sources',
    'document_imports', 'document_structure', 'reading_positions', 'annotations',
    'flashcards', 'card_drafts', 'dictionary_search_history', 'practice_items',
  ];
  for (const table of EXPECTED_TABLES) {
    if (!existing.has(table)) {
      push(`schema-coverage:${table}`, 'WARN', 1, `预期表 ${table} 缺失（规则自动跳过，覆盖不全）`);
    }
  }

  // ---- 1. documents 孤儿（删文档清 shred/FTS/位置/批注/结构，不清任务审计） ----
  // document_imports 不在此列：任务行是审计（删除生命周期表 §8），悬空由 import:done-doc 置 WARN。
  // term_occurrences.document_id 存 docRef=documentId/lessonId 字符串，不是 FK，永不按此查。
  const docChildren: Array<[string, string]> = [
    ['textbook_lessons', 'document_id'],
    ['textbook_lines', 'document_id'],
    ['textbook_vocab', 'document_id'],
    ['textbook_grammar', 'document_id'],
    ['textbook_exercises', 'document_id'],
    ['textbook_term_map', 'document_id'],
    ['textbook_fts', 'document_id'],
    ['reading_positions', 'document_id'],
    ['annotations', 'document_id'],
    ['document_structure', 'document_id'],
  ];
  if (has('documents')) {
    for (const [table, col] of docChildren) {
      if (!has(table)) continue;
      const n = count(
        `SELECT COUNT(*) AS n FROM "${table}" t LEFT JOIN documents d ON d.id = t."${col}" WHERE t."${col}" IS NOT NULL AND d.id IS NULL`
      );
      push(
        `documents-orphan:${table}`,
        n > 0 ? 'FAIL' : 'PASS',
        n,
        n > 0 ? `${table} 有 ${n} 行 document_id 找不到 documents（删文档残留）` : '无孤儿'
      );
    }
    // practice_items.passage_document_id：预留列，当前恒 NULL，只查非空悬空
    if (has('practice_items')) {
      const n = count(
        `SELECT COUNT(*) AS n FROM practice_items p LEFT JOIN documents d ON d.id = p.passage_document_id WHERE p.passage_document_id IS NOT NULL AND d.id IS NULL`
      );
      push('documents-orphan:practice_items', n > 0 ? 'FAIL' : 'PASS', n, n > 0 ? `passage_document_id 悬空 ${n}` : '无悬空（多为 NULL 预留）');
    }
    // 注意：term_occurrences.document_id 存 docRef=documentId/lessonId 字符串，不是 FK，排除。
  }

  // ---- 2. lesson 孤儿（必须 document_id + lesson_id 双列对） ----
  if (has('textbook_lessons')) {
    for (const table of ['textbook_lines', 'textbook_vocab', 'textbook_grammar', 'textbook_exercises']) {
      if (!has(table)) continue;
      const n = count(
        `SELECT COUNT(*) AS n FROM "${table}" t WHERE NOT EXISTS (SELECT 1 FROM textbook_lessons l WHERE l.document_id = t.document_id AND l.lesson_id = t.lesson_id)`
      );
      push(`lesson-orphan:${table}`, n > 0 ? 'FAIL' : 'PASS', n, n > 0 ? `${n} 行课不存在` : '无孤儿');
    }
  }

  // ---- 2b. sort_order（v17 P1-B：唯一 ordering truth，1-based dense 连续） ----
  // - 缺列即跳过（旧测试最小 schema / 未迁移库不炸，由迁移测试覆盖）；
  // - 不查 lessonNumber（可 gap 是合法 legacy），不查 title 唯一（復習/重名合法）。
  if (hasColumn('textbook_lessons', 'sort_order')) {
    const nullN = count(`SELECT COUNT(*) AS n FROM textbook_lessons WHERE sort_order IS NULL`);
    push('lesson:sortorder-null', nullN > 0 ? 'FAIL' : 'PASS', nullN, nullN > 0 ? `${nullN} 行 sort_order 为空（未回填？）` : '顺序齐全');
    const badAff = count(`SELECT COUNT(*) AS n FROM textbook_lessons WHERE sort_order IS NOT NULL AND typeof(sort_order) != 'integer'`);
    push('lesson:sortorder-affinity', badAff > 0 ? 'FAIL' : 'PASS', badAff, badAff > 0 ? `${badAff} 行 sort_order 非整数亲和` : '亲和正常');
    const nonPos = count(`SELECT COUNT(*) AS n FROM textbook_lessons WHERE typeof(sort_order) = 'integer' AND sort_order <= 0`);
    push('lesson:sortorder-nonpositive', nonPos > 0 ? 'FAIL' : 'PASS', nonPos, nonPos > 0 ? `${nonPos} 行 sort_order <= 0` : '无非正值');
    const dup = count(
      `SELECT COUNT(*) AS n FROM (SELECT document_id, sort_order FROM textbook_lessons WHERE sort_order IS NOT NULL GROUP BY document_id, sort_order HAVING COUNT(*) > 1)`
    );
    push('lesson:sortorder-dup', dup > 0 ? 'FAIL' : 'PASS', dup, dup > 0 ? `${dup} 组同文档重复 sort_order` : '无重复');
    const gap = count(
      `SELECT COUNT(*) AS n FROM (SELECT document_id FROM textbook_lessons WHERE sort_order IS NOT NULL GROUP BY document_id HAVING COUNT(*) != COUNT(sort_order) OR MIN(sort_order) != 1 OR MAX(sort_order) != COUNT(*))`
    );
    push('lesson:sortorder-gap', gap > 0 ? 'FAIL' : 'PASS', gap, gap > 0 ? `${gap} 个文档顺序不连续（非 1-based dense）` : '顺序连续');
  }

  // ---- 3. ord 完整性（代码不强制连续，只查重复/负值/非法亲和） ----
  // 非法亲和说明：SQLite INTEGER 列可存 'abc' 文本（affinity 不强制），裸写/外部工具会埋雷。
  for (const table of ['textbook_lines', 'textbook_vocab', 'textbook_grammar', 'textbook_exercises']) {
    if (!has(table)) continue;
    const dup = count(
      `SELECT COUNT(*) AS n FROM (SELECT document_id, lesson_id, ord FROM "${table}" GROUP BY document_id, lesson_id, ord HAVING COUNT(*) > 1)`
    );
    push(`ord-dup:${table}`, dup > 0 ? 'FAIL' : 'PASS', dup, dup > 0 ? `${dup} 组重复 ord` : '无重复');
    const neg = count(`SELECT COUNT(*) AS n FROM "${table}" WHERE ord < 0`);
    push(`ord-negative:${table}`, neg > 0 ? 'FAIL' : 'PASS', neg, neg > 0 ? `${neg} 行负 ord` : '无负值');
    const badAffinity = count(`SELECT COUNT(*) AS n FROM "${table}" WHERE typeof(ord) != 'integer'`);
    push(`ord-affinity:${table}`, badAffinity > 0 ? 'FAIL' : 'PASS', badAffinity, badAffinity > 0 ? `${badAffinity} 行 ord 非整数亲和` : '亲和正常');
  }

  // ---- 4. term_map ----
  if (has('textbook_term_map', 'local_dictionary_entries')) {
    const dangling = count(
      `SELECT COUNT(*) AS n FROM textbook_term_map m LEFT JOIN local_dictionary_entries e ON e.id = m.entry_id WHERE m.entry_id IS NOT NULL AND e.id IS NULL`
    );
    push('term-map:entry', dangling > 0 ? 'FAIL' : 'PASS', dangling, dangling > 0 ? `${dangling} 个 entry_id 悬空（词典包卸载残留？）` : '映射有效');
  }
  if (has('textbook_term_map')) {
    const badKind = count(`SELECT COUNT(*) AS n FROM textbook_term_map WHERE kind NOT IN ('vocab','grammar')`);
    push('term-map:kind', badKind > 0 ? 'FAIL' : 'PASS', badKind, badKind > 0 ? `${badKind} 行非法 kind` : 'kind 合法');
    if (has('textbook_vocab')) {
      const n = count(
        `SELECT COUNT(*) AS n FROM textbook_term_map m WHERE m.kind = 'vocab' AND NOT EXISTS (SELECT 1 FROM textbook_vocab v WHERE v.document_id = m.document_id AND v.lesson_id = m.lesson_id AND v.surface = m.ref_text)`
      );
      push('term-map:vocab-ref', n > 0 ? 'WARN' : 'PASS', n, n > 0 ? `${n} 条 vocab 映射找不到源词（改写/重导残留）` : '源词齐全');
    }
    if (has('textbook_grammar')) {
      const n = count(
        `SELECT COUNT(*) AS n FROM textbook_term_map m WHERE m.kind = 'grammar' AND NOT EXISTS (SELECT 1 FROM textbook_grammar g WHERE g.document_id = m.document_id AND g.lesson_id = m.lesson_id AND g.title = m.ref_text)`
      );
      push('term-map:grammar-ref', n > 0 ? 'WARN' : 'PASS', n, n > 0 ? `${n} 条 grammar 映射找不到源文法` : '源文法齐全');
    }
  }

  // ---- 5. FTS 双向（textbook_fts 是可重建索引，FAIL=该重建了） ----
  // 为何 stale 检查曾对孤儿行误报 PASS：stale 只验 fts↔源行表（vocab/lines）一致，
  // 而孤儿行仍躺在源行表里（删文档不清 shred），所以能 resolve；文档级孤儿由
  // documents-orphan 规则负责。两层各查各的，不重叠。
  if (has('textbook_fts')) {
    const badKind = count(`SELECT COUNT(*) AS n FROM textbook_fts WHERE kind NOT IN ('vocab','line')`);
    push('fts:kind', badKind > 0 ? 'FAIL' : 'PASS', badKind, badKind > 0 ? `${badKind} 行非法 kind` : 'kind 合法');
    const dupRef = count(
      `SELECT COUNT(*) AS n FROM (SELECT document_id, lesson_id, kind, ref FROM textbook_fts GROUP BY document_id, lesson_id, kind, ref HAVING COUNT(*) > 1)`
    );
    push('fts:dup-ref', dupRef > 0 ? 'FAIL' : 'PASS', dupRef, dupRef > 0 ? `${dupRef} 组重复映射（同源被索引两次）` : '无重复映射');
    if (has('textbook_vocab')) {
      const missing = count(
        `SELECT COUNT(*) AS n FROM textbook_vocab v WHERE NOT EXISTS (SELECT 1 FROM textbook_fts f WHERE f.document_id = v.document_id AND f.lesson_id = v.lesson_id AND f.kind = 'vocab' AND f.ref = v.lesson_id || '#v' || v.ord)`
      );
      push('fts:vocab-missing', missing > 0 ? 'WARN' : 'PASS', missing, missing > 0 ? `${missing} 个生词缺索引（重跑 shred 可修）` : '索引齐全');
    }
    if (has('textbook_lines')) {
      const missing = count(
        `SELECT COUNT(*) AS n FROM textbook_lines l WHERE NOT EXISTS (SELECT 1 FROM textbook_fts f WHERE f.document_id = l.document_id AND f.lesson_id = l.lesson_id AND f.kind = 'line' AND f.ref = l.lesson_id || '#d' || l.ord)`
      );
      push('fts:line-missing', missing > 0 ? 'WARN' : 'PASS', missing, missing > 0 ? `${missing} 个课文行缺索引` : '索引齐全');
    }
    // stale：fts 行找不到源（ref 格式 lesson#v3 / lesson#d7，lesson_id 含 # 时按最后一个 # 切）
    const staleRows = has('textbook_vocab', 'textbook_lines')
      ? (db
          .query(`SELECT document_id AS d, lesson_id AS l, kind AS k, ref AS r FROM textbook_fts WHERE kind IN ('vocab','line')`)
          .all() as Array<{ d: string; l: string; k: string; r: string }>)
      : [];
    let stale = 0;
    if (staleRows.length > 0) {
      // key 用 JSON 数组（两边同构，无分隔符碰撞问题）
      const keyOf = (d: string, l: string, o: number) => JSON.stringify([d, l, o]);
      const vocabKeys = new Set(
        (db.query('SELECT document_id AS d, lesson_id AS l, ord AS o FROM textbook_vocab').all() as Array<{ d: string; l: string; o: number }>).map((x) => keyOf(x.d, x.l, x.o))
      );
      const lineKeys = new Set(
        (db.query('SELECT document_id AS d, lesson_id AS l, ord AS o FROM textbook_lines').all() as Array<{ d: string; l: string; o: number }>).map((x) => keyOf(x.d, x.l, x.o))
      );
      for (const row of staleRows) {
        const sep = row.k === 'vocab' ? '#v' : '#d';
        const idx = row.r.lastIndexOf(sep);
        if (idx < 0) {
          stale++;
          continue;
        }
        const ord = Number(row.r.slice(idx + sep.length));
        if (!Number.isInteger(ord)) {
          stale++;
          continue;
        }
        if (!(row.k === 'vocab' ? vocabKeys : lineKeys).has(keyOf(row.d, row.l, ord))) stale++;
      }
    }
    push('fts:stale', stale > 0 ? 'WARN' : 'PASS', stale, stale > 0 ? `${stale} 条索引找不到源（stale）` : '无 stale');
  }

  // ---- 6. 词典引用 ----
  if (has('local_dictionary_entries', 'dictionary_sources')) {
    const n = count(
      `SELECT COUNT(*) AS n FROM local_dictionary_entries e LEFT JOIN dictionary_sources s ON s.id = e.source_id WHERE e.source_id IS NOT NULL AND s.id IS NULL`
    );
    push('dict:entry-source', n > 0 ? 'FAIL' : 'PASS', n, n > 0 ? `${n} 词条来源悬空` : '来源有效');
  }
  if (has('dictionary_term_meta', 'dictionary_sources')) {
    const n = count(
      `SELECT COUNT(*) AS n FROM dictionary_term_meta m LEFT JOIN dictionary_sources s ON s.id = m.source_id WHERE s.id IS NULL`
    );
    push('dict:meta-source', n > 0 ? 'FAIL' : 'PASS', n, n > 0 ? `${n} 条 meta 来源悬空` : '来源有效');
  }
  if (has('flashcards', 'local_dictionary_entries')) {
    const n = count(
      `SELECT COUNT(*) AS n FROM flashcards f LEFT JOIN local_dictionary_entries e ON e.id = f.source_entry_id WHERE f.source_entry_id IS NOT NULL AND e.id IS NULL`
    );
    push('dict:card-source', n > 0 ? 'WARN' : 'PASS', n, n > 0 ? `${n} 张卡片来源词条缺失` : '来源有效');
  }
  if (has('dictionary_search_history', 'local_dictionary_entries')) {
    const n = count(
      `SELECT COUNT(*) AS n FROM dictionary_search_history h LEFT JOIN local_dictionary_entries e ON e.id = h.top_entry_id WHERE h.top_entry_id IS NOT NULL AND e.id IS NULL`
    );
    push('dict:history-entry', n > 0 ? 'WARN' : 'PASS', n, n > 0 ? `${n} 条历史 top 词条缺失` : '有效');
  }

  // ---- 7. 卡片/批注/草稿引用 ----
  if (has('annotations', 'flashcards')) {
    const n = count(
      `SELECT COUNT(*) AS n FROM annotations a LEFT JOIN flashcards f ON f.id = a.flashcard_id WHERE a.flashcard_id IS NOT NULL AND f.id IS NULL`
    );
    push('card:annotation-ref', n > 0 ? 'WARN' : 'PASS', n, n > 0 ? `${n} 条批注关联卡片缺失` : '有效');
  }
  if (has('card_drafts', 'flashcards')) {
    const n = count(
      `SELECT COUNT(*) AS n FROM card_drafts d LEFT JOIN flashcards f ON f.id = d.flashcard_id WHERE d.flashcard_id IS NOT NULL AND f.id IS NULL`
    );
    push('card:draft-ref', n > 0 ? 'WARN' : 'PASS', n, n > 0 ? `${n} 条草稿关联卡片缺失` : '有效');
  }

  // ---- 8. 导入状态机 ----
  if (has('document_imports')) {
    const bad = count(`SELECT COUNT(*) AS n FROM document_imports WHERE status NOT IN ('processing','done','failed')`);
    push('import:status', bad > 0 ? 'FAIL' : 'PASS', bad, bad > 0 ? `${bad} 行非法状态` : '状态合法');
    if (has('documents')) {
      // 导入任务行是审计（删文档不删任务，见删除生命周期表），悬空置 WARN 不置 FAIL。
      const dangling = count(
        `SELECT COUNT(*) AS n FROM document_imports i LEFT JOIN documents d ON d.id = i.document_id WHERE i.status = 'done' AND (i.document_id IS NULL OR d.id IS NULL)`
      );
      push('import:done-doc', dangling > 0 ? 'WARN' : 'PASS', dangling, dangling > 0 ? `${dangling} 个 done 任务找不到文档（审计保留，未删）` : 'done 任务齐全');
      // 空课文档：只查教材形 AST（含 lessons 数组）却 0 课的；阅读/新闻是 {questions} 形，天生 0 课，不算。
      const candidates = db
        .query(
          `SELECT d.id AS id, d.ast_json AS ast FROM documents d WHERE d.ast_json IS NOT NULL AND NOT EXISTS (SELECT 1 FROM textbook_lessons l WHERE l.document_id = d.id)`
        )
        .all() as Array<{ id: string; ast: string }>;
      let empty = 0;
      for (const c of candidates) {
        try {
          const o: unknown = JSON.parse(c.ast);
          if (o && typeof o === 'object' && Array.isArray((o as Record<string, unknown>).lessons)) empty++;
        } catch {
          // 坏 JSON 不归本规则（导入层负责）
        }
      }
      push('import:empty-lessons', empty > 0 ? 'WARN' : 'PASS', empty, empty > 0 ? `${empty} 个教材形文档有 AST 但 0 课（种子未 shred？）` : '教材文档皆有课');
      // 课数漂移：canonical AST lessons 数 vs derived 行数不一致（append/enrich 的
      // “AST 已更新、shred 失败仅 WARN”即此形状；原子写普及后应恒为 0，留作护栏）。
      if (has('textbook_lessons')) {
        const shaped = db
          .query(`SELECT d.id AS id, d.ast_json AS ast FROM documents d WHERE d.ast_json IS NOT NULL`)
          .all() as Array<{ id: string; ast: string }>;
        let drift = 0;
        for (const c of shaped) {
          try {
            const o: unknown = JSON.parse(c.ast);
            if (!o || typeof o !== 'object' || !Array.isArray((o as Record<string, unknown>).lessons)) continue;
            const astN = ((o as Record<string, unknown>).lessons as unknown[]).length;
            const row = db.query('SELECT COUNT(*) AS n FROM textbook_lessons WHERE document_id = ?').get(c.id) as { n: number };
            if (row.n !== astN) drift++;
          } catch {
            // 坏 JSON 不归本规则
          }
        }
        push('import:lesson-count-drift', drift > 0 ? 'WARN' : 'PASS', drift, drift > 0 ? `${drift} 个文档 AST 课数与 derived 行数不一致（双源漂移，需回填）` : '课数一致');
      }
      // projection drift：行数相等也可能 id/排序/标题错位。逐课比对
      // lesson_id 集合 × lesson_number × title × sort_order(=AST index+1)。
      // derived 可重建，故 WARN；doctor 是第二防线，不替代写事务。
      if (has('textbook_lessons')) {
        const shaped = db
          .query(`SELECT d.id AS id, d.ast_json AS ast FROM documents d WHERE d.ast_json IS NOT NULL`)
          .all() as Array<{ id: string; ast: string }>;
        let projDrift = 0;
        for (const c of shaped) {
          try {
            const o: unknown = JSON.parse(c.ast);
            if (!o || typeof o !== 'object' || !Array.isArray((o as Record<string, unknown>).lessons)) continue;
            const astLessons = (o as Record<string, unknown>).lessons as Array<Record<string, unknown>>;
            const derived = db.query(
              'SELECT lesson_id AS lessonId, lesson_number AS lessonNumber, title AS title, sort_order AS sortOrder FROM textbook_lessons WHERE document_id = ?'
            ).all(c.id) as Array<{ lessonId: string; lessonNumber: number; title: string; sortOrder: number | null }>;
            if (derived.length !== astLessons.length) continue; // 行数差由 lesson-count-drift 报
            let bad = false;
            const byId = new Map(derived.map((r) => [r.lessonId, r]));
            if (byId.size !== derived.length) {
              bad = true; // derived 侧重复 id
            } else {
              for (let i = 0; i < astLessons.length && !bad; i++) {
                const l = astLessons[i] as { id?: unknown; lessonNumber?: unknown; title?: unknown };
                if (typeof l.id !== 'string') { bad = true; break; }
                const row = byId.get(l.id);
                if (!row) { bad = true; break; }
                if (typeof l.lessonNumber === 'number' && Number.isInteger(l.lessonNumber) && l.lessonNumber > 0 && row.lessonNumber !== l.lessonNumber) bad = true;
                if (typeof l.title === 'string' && row.title !== l.title.slice(0, 200)) bad = true;
                if (row.sortOrder !== i + 1) bad = true;
              }
            }
            if (bad) projDrift++;
          } catch {
            // 坏 JSON 不归本规则
          }
        }
        push('import:projection-drift', projDrift > 0 ? 'WARN' : 'PASS', projDrift, projDrift > 0 ? `${projDrift} 个文档 AST 与 derived 课行错位（id/number/title/sort_order，需重 shred）` : '投影一致');
      }
    }
    const stuck = count(`SELECT COUNT(*) AS n FROM document_imports WHERE status = 'processing'`);
    push('import:processing', stuck > 0 ? 'WARN' : 'PASS', stuck, stuck > 0 ? `${stuck} 个 processing（在跑或卡死，请结合网关日志看）` : '无卡住任务');
  }

  // ---- 8b. 整书目录导入 session/chunk（P5-D2A；任一表缺席即跳过） ----
  // 不加 FK（无 FK 架构）：悬空/越界/重复/计数不一致全由本节只读规则锁。
  if (has('toc_import_sessions', 'toc_import_chunks')) {
    const orphan = count(
      `SELECT COUNT(*) AS n FROM toc_import_chunks c LEFT JOIN toc_import_sessions s ON s.id = c.session_id WHERE s.id IS NULL`
    );
    push('toc-import:chunk-orphan', orphan > 0 ? 'FAIL' : 'PASS', orphan, orphan > 0 ? `${orphan} 个 chunk 找不到 session（手写脏行/误删）` : '无悬空 chunk');
    const badRange = count(
      `SELECT COUNT(*) AS n FROM toc_import_chunks WHERE physical_start < 1 OR physical_end < physical_start OR (physical_end - physical_start + 1) > 30`
    );
    push('toc-import:chunk-range', badRange > 0 ? 'FAIL' : 'PASS', badRange, badRange > 0 ? `${badRange} 个 chunk 范围非法（起止/超 30 页）` : '范围合法');
    const dup = count(
      `SELECT COUNT(*) AS n FROM (SELECT session_id, ordinal FROM toc_import_chunks GROUP BY session_id, ordinal HAVING COUNT(*) > 1)`
    );
    push('toc-import:ordinal-dup', dup > 0 ? 'FAIL' : 'PASS', dup, dup > 0 ? `${dup} 组 (session, ordinal) 重复` : '序号唯一');
    const sessions = db
      .query('SELECT id AS id, chunk_count AS chunkCount FROM toc_import_sessions')
      .all() as Array<{ id: string; chunkCount: number }>;
    let mismatch = 0;
    for (const s of sessions) {
      const row = db
        .query('SELECT COUNT(*) AS n FROM toc_import_chunks WHERE session_id = ?')
        .get(s.id) as { n: number };
      if (row.n !== s.chunkCount) mismatch++;
    }
    push('toc-import:session-count', mismatch > 0 ? 'FAIL' : 'PASS', mismatch, mismatch > 0 ? `${mismatch} 个 session 登记 chunk 数与实际行数不一致` : '计数一致');
    const badStatus =
      count(`SELECT COUNT(*) AS n FROM toc_import_sessions WHERE status NOT IN ('prepared','running','completed','failed','cancelled','target_deleted')`) +
      count(`SELECT COUNT(*) AS n FROM toc_import_chunks WHERE status NOT IN ('prepared','running','completed','failed')`);
    push('toc-import:status', badStatus > 0 ? 'FAIL' : 'PASS', badStatus, badStatus > 0 ? `${badStatus} 行非法状态（封闭枚举外）` : '状态合法');
    // chunk 的 document_id 已废弃（invariant 恒 NULL；所有权只在 session 层）。
    const chunkDoc = count(`SELECT COUNT(*) AS n FROM toc_import_chunks WHERE document_id IS NOT NULL`);
    push('toc-import:chunk-doc', chunkDoc > 0 ? 'FAIL' : 'PASS', chunkDoc, chunkDoc > 0 ? `${chunkDoc} 个 chunk 持有 document（已废弃，必须为 NULL）` : 'chunk 无持有');
    // 可恢复 session（prepared/running/failed）绑定的 target 必须存在；
    // target_deleted 等终态保留快照做审计，不在此报 orphan。
    // documents 表缺席即跳过（部分库，见缺列跳过惯例）。
    if (has('documents')) {
      const activeDoc = count(
        `SELECT COUNT(*) AS n FROM toc_import_sessions s LEFT JOIN documents d ON d.id = s.document_id WHERE s.status IN ('prepared','running','failed') AND s.document_id IS NOT NULL AND d.id IS NULL`
      );
      push('toc-import:active-doc', activeDoc > 0 ? 'FAIL' : 'PASS', activeDoc, activeDoc > 0 ? `${activeDoc} 个可恢复 session 指向缺失文档` : '绑定齐全');
    }
    // running session 缺 AST 指纹（旧计划）：append 路径必须拒绝，doctor 先行告警。
    // v21 前旧形表无此列即跳过（升级后覆盖）。
    if (hasColumn('toc_import_sessions', 'ast_fingerprint')) {
      const noFp = count(
        `SELECT COUNT(*) AS n FROM toc_import_sessions WHERE status = 'running' AND (ast_fingerprint IS NULL OR ast_fingerprint = '')`
      );
      push('toc-import:session-ast-fp', noFp > 0 ? 'FAIL' : 'PASS', noFp, noFp > 0 ? `${noFp} 个 running session 缺 AST 指纹（旧计划，需重备）` : '指纹齐全');
    }
    // completed 顺序 gap：已完成 ordinal 必须是从 0 起的连续前缀（跳号即执行错位）。
    const gapRows = db
      .query('SELECT session_id AS sid, ordinal AS ord FROM toc_import_chunks WHERE status = ? ORDER BY session_id, ordinal')
      .all('completed') as Array<{ sid: string; ord: number }>;
    const bySession = new Map<string, number[]>();
    for (const r of gapRows) {
      const list = bySession.get(r.sid) ?? [];
      list.push(r.ord);
      bySession.set(r.sid, list);
    }
    let gap = 0;
    for (const ordinals of bySession.values()) {
      const sorted = [...ordinals].sort((a, b) => a - b);
      for (let i = 0; i < sorted.length; i++) {
        if (sorted[i] !== i) {
          gap++;
          break;
        }
      }
    }
    push('toc-import:chunk-gap', gap > 0 ? 'FAIL' : 'PASS', gap, gap > 0 ? `${gap} 个 session 的 completed 顺序有 gap` : '顺序连续');
    // session 指纹 vs 文档 AST 漂移：绑定文档的当前 AST hash 必须等于 session 记录；
    // 不一致即外部改过，append 路径会拒绝，doctor 先行告警。终态/未绑定跳过。
    if (has('documents') && hasColumn('toc_import_sessions', 'ast_fingerprint') && hasColumn('documents', 'ast_json')) {
      const bound = db
        .query(
          'SELECT s.id AS id, s.ast_fingerprint AS fp, d.ast_json AS ast FROM toc_import_sessions s JOIN documents d ON d.id = s.document_id WHERE s.document_id IS NOT NULL AND s.ast_fingerprint IS NOT NULL AND s.ast_fingerprint != ? AND d.ast_json IS NOT NULL'
        )
        .all('') as Array<{ id: string; fp: string; ast: string }>;
      let drift = 0;
      for (const row of bound) {
        try {
          const digest = sha256HexTextLocal(row.ast);
          if (digest !== row.fp) drift++;
        } catch {
          drift++;
        }
      }
      push('toc-import:ast-drift', drift > 0 ? 'FAIL' : 'PASS', drift, drift > 0 ? `${drift} 个 session 的文档 AST 与记录指纹不一致（外部漂移）` : '指纹一致');
    }
  }

  // ---- 9. locator JSON 有效性（reading_positions） ----
  if (has('reading_positions')) {
    const rows = db.query('SELECT locator AS l FROM reading_positions').all() as Array<{ l: string }>;
    let broken = 0;
    for (const r of rows) {
      try {
        const o: unknown = JSON.parse(r.l);
        if (!o || typeof o !== 'object' || Array.isArray(o)) broken++;
      } catch {
        broken++;
      }
    }
    push('position:locator-json', broken > 0 ? 'WARN' : 'PASS', broken, broken > 0 ? `${broken} 条 locator 非法 JSON/非对象` : 'locator 有效');
  }

  const errors = findings.filter((f) => f.level === 'FAIL').map((f) => `${f.rule}: ${f.detail}`);
  const warnings = findings.filter((f) => f.level === 'WARN').map((f) => `${f.rule}: ${f.detail}`);
  return { findings, errors, warnings };
}

/** CLI/CI 输出格式 */
export function formatDoctorReport(report: DoctorReport): string {
  const lines = ['Database Doctor', ''];
  for (const f of report.findings) {
    const dots = '.'.repeat(Math.max(2, 34 - f.rule.length));
    lines.push(`${f.level} ${f.rule} ${dots} ${f.count}`);
  }
  lines.push('');
  lines.push(`errors: ${report.errors.length}, warnings: ${report.warnings.length}`);
  for (const e of report.errors) lines.push(`  FAIL ${e}`);
  for (const w of report.warnings) lines.push(`  WARN ${w}`);
  return lines.join('\n');
}
