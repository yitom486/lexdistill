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
  const count = (sql: string): number => {
    const row = db.query(sql).get() as { n: number } | null;
    return row ? row.n : 0;
  };

  const push = (rule: string, level: DoctorFinding['level'], n: number, detail: string) => {
    findings.push({ rule, level, count: n, detail });
  };

  // ---- 1. documents 孤儿（删文档只清 annotations+本行，shred 等全残留） ----
  const docChildren: Array<[string, string]> = [
    ['textbook_lessons', 'document_id'],
    ['textbook_lines', 'document_id'],
    ['textbook_vocab', 'document_id'],
    ['textbook_grammar', 'document_id'],
    ['textbook_exercises', 'document_id'],
    ['textbook_term_map', 'document_id'],
    ['reading_positions', 'document_id'],
    ['annotations', 'document_id'],
    ['document_structure', 'document_id'],
    ['document_imports', 'document_id'],
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

  // ---- 3. ord 完整性（代码不强制连续，只查重复与负值） ----
  for (const table of ['textbook_lines', 'textbook_vocab', 'textbook_grammar', 'textbook_exercises']) {
    if (!has(table)) continue;
    const dup = count(
      `SELECT COUNT(*) AS n FROM (SELECT document_id, lesson_id, ord FROM "${table}" GROUP BY document_id, lesson_id, ord HAVING COUNT(*) > 1)`
    );
    push(`ord-dup:${table}`, dup > 0 ? 'FAIL' : 'PASS', dup, dup > 0 ? `${dup} 组重复 ord` : '无重复');
    const neg = count(`SELECT COUNT(*) AS n FROM "${table}" WHERE ord < 0`);
    push(`ord-negative:${table}`, neg > 0 ? 'FAIL' : 'PASS', neg, neg > 0 ? `${neg} 行负 ord` : '无负值');
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
  if (has('textbook_fts')) {
    const badKind = count(`SELECT COUNT(*) AS n FROM textbook_fts WHERE kind NOT IN ('vocab','line')`);
    push('fts:kind', badKind > 0 ? 'FAIL' : 'PASS', badKind, badKind > 0 ? `${badKind} 行非法 kind` : 'kind 合法');
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
      const dangling = count(
        `SELECT COUNT(*) AS n FROM document_imports i LEFT JOIN documents d ON d.id = i.document_id WHERE i.status = 'done' AND (i.document_id IS NULL OR d.id IS NULL)`
      );
      push('import:done-doc', dangling > 0 ? 'FAIL' : 'PASS', dangling, dangling > 0 ? `${dangling} 个 done 任务找不到文档` : 'done 任务齐全');
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
    }
    const stuck = count(`SELECT COUNT(*) AS n FROM document_imports WHERE status = 'processing'`);
    push('import:processing', stuck > 0 ? 'WARN' : 'PASS', stuck, stuck > 0 ? `${stuck} 个 processing（在跑或卡死，请结合网关日志看）` : '无卡住任务');
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
