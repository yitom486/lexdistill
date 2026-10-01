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


  const push = (rule: string, level: DoctorFinding['level'], n: number, detail: string) => {
    findings.push({ rule, level, count: n, detail });
  };

  // ---- 0. schema 覆盖：预期表缺失不再静默跳过（缺席=结构损坏或史前库） ----
  // 注意：缺席只 WARN 不 FAIL——doctor 也跑在部分库/测试库上，缺席本身不是数据错。
  const EXPECTED_TABLES = [
    'documents',
    'global_vocabulary', 'textbook_materials', 'textbook_articles', 'textbook_sentences', 'textbook_vocabulary', 'textbook_knowledge',
    'textbook_exercise_items', 'textbook_fts', 'knowledge_points',
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
    ...['textbook_materials','textbook_articles','textbook_sentences','textbook_vocabulary','textbook_knowledge','textbook_exercise_items'].map(table => [table, 'document_id'] as [string,string]),
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

  // Chapter membership is stored once in documents.chapters_json.
  if (hasColumn('documents', 'chapters_json')) for (const table of ['textbook_articles','textbook_sentences','textbook_vocabulary','textbook_knowledge','textbook_exercise_items','textbook_materials']) {
    if (!has(table)) continue;
    const n = count(`SELECT COUNT(*) AS n FROM "${table}" t JOIN documents d ON d.id=t.document_id WHERE NOT EXISTS (SELECT 1 FROM json_each(d.chapters_json) c WHERE json_extract(c.value,'$.id')=t.chapter_id)`);
    push(`chapter-orphan:${table}`, n ? 'FAIL' : 'PASS', n, n ? '内容没有对应章节' : '章节关联有效');
  }

  // ---- 3. ord 完整性（代码不强制连续，只查重复/负值/非法亲和） ----
  // 非法亲和说明：SQLite INTEGER 列可存 'abc' 文本（affinity 不强制），裸写/外部工具会埋雷。
  for (const table of ['textbook_articles','textbook_sentences','textbook_vocabulary','textbook_knowledge','textbook_exercise_items']) {
    if (!has(table)) continue;
    const dup = count(
      `SELECT COUNT(*) AS n FROM (SELECT document_id, chapter_id, ord FROM "${table}" GROUP BY document_id, chapter_id, ord HAVING COUNT(*) > 1)`
    );
    push(`ord-dup:${table}`, dup > 0 ? 'FAIL' : 'PASS', dup, dup > 0 ? `${dup} 组重复 ord` : '无重复');
    const neg = count(`SELECT COUNT(*) AS n FROM "${table}" WHERE ord < 0`);
    push(`ord-negative:${table}`, neg > 0 ? 'FAIL' : 'PASS', neg, neg > 0 ? `${neg} 行负 ord` : '无负值');
    const badAffinity = count(`SELECT COUNT(*) AS n FROM "${table}" WHERE typeof(ord) != 'integer'`);
    push(`ord-affinity:${table}`, badAffinity > 0 ? 'FAIL' : 'PASS', badAffinity, badAffinity > 0 ? `${badAffinity} 行 ord 非整数亲和` : '亲和正常');
  }

  // ---- 4. knowledge_points（v30 目录挂载蒸馏点） ----
  // source_refs_json 为可空指回（悬空知识点合法），此处只查 lesson 锚（见 §2）。
  if (has('knowledge_points')) {
    const emptyConcept = count(`SELECT COUNT(*) AS n FROM knowledge_points WHERE concept IS NULL OR TRIM(concept) = ''`);
    push('knowledge:concept-empty', emptyConcept > 0 ? 'FAIL' : 'PASS', emptyConcept, emptyConcept > 0 ? `${emptyConcept} 行 concept 为空` : '概念齐全');
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
