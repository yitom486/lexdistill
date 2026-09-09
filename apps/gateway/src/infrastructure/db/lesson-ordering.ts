import type { Database } from 'bun:sqlite';
import { parseTextbookAST } from '@study-studio/protocol';

export interface LessonOrderingDocPlan {
  documentId: string;
  title: string;
  /** canonical AST 课数（-1 = 无可用教材 AST） */
  astCount: number;
  derivedCount: number;
  matched: number;
  missing: string[];
  extra: string[];
  duplicateAst: string[];
  /** ok=可回填；unresolved=绝不猜；skipped=非教材形，无需回填 */
  status: 'ok' | 'unresolved' | 'skipped';
  statusReason: string;
  /** 提议更新：lesson_id → sort_order（= AST index+1），仅 status=ok 时非空 */
  updates: Array<{ lessonId: string; sortOrder: number }>;
}

export interface LessonOrderingPlan {
  docs: LessonOrderingDocPlan[];
  /** 有教材 AST 且可回填的文档数 */
  okCount: number;
  /** 必须先人工处理的文档数（apply 整体拒绝） */
  unresolvedCount: number;
  skippedCount: number;
}

interface DocRow {
  id: string;
  title: string;
  astJson: string | null;
}

/**
 * P1-B 回填 dry-run（只读）：
 * - 只 SELECT，不写库（调用方可传 readonly 句柄）；
 * - truth 唯一来源：parseTextbookAST(documents.ast_json).lessons[] 数组 index + 1；
 * - 按 lesson.id 精确匹配 textbook_lessons(document_id, lesson_id)；
 * - AST 非法/缺失（且有 Derived 行）、重复 lesson id、Derived mismatch → unresolved，绝不猜；
 * - 非教材形 AST（阅读/新闻 questions 形）且无 Derived 行 → skipped，不挡 apply。
 */
export function planLessonOrdering(db: Database): LessonOrderingPlan {
  const docs = db.query(
    'SELECT id, title, ast_json AS astJson FROM documents'
  ).all() as DocRow[];
  const out: LessonOrderingPlan = { docs: [], okCount: 0, unresolvedCount: 0, skippedCount: 0 };
  for (const d of docs) {
    const derived = hasTable(db, 'textbook_lessons')
      ? (db.query('SELECT lesson_id AS lessonId FROM textbook_lessons WHERE document_id = ?').all(d.id) as Array<{ lessonId: string }>)
      : [];
    const entry: LessonOrderingDocPlan = {
      documentId: d.id,
      title: d.title,
      astCount: -1,
      derivedCount: derived.length,
      matched: 0,
      missing: [],
      extra: [],
      duplicateAst: [],
      status: 'unresolved',
      statusReason: '',
      updates: [],
    };
    if (!d.astJson) {
      if (derived.length === 0) {
        entry.status = 'skipped';
        entry.statusReason = '无 AST 且无 Derived 行，无需回填';
        out.skippedCount++;
      } else {
        entry.statusReason = `无 AST 但有 ${derived.length} 行 Derived，来源丢失，不猜`;
        out.unresolvedCount++;
      }
      out.docs.push(entry);
      continue;
    }
    let lessons: Array<{ id: string }>;
    try {
      const parsed = parseTextbookAST(JSON.parse(d.astJson));
      if (parsed.ok !== true) throw new Error('invalid-ast');
      lessons = parsed.value.lessons;
    } catch {
      if (derived.length === 0) {
        entry.status = 'skipped';
        entry.statusReason = '非教材形 AST（阅读/新闻）且无 Derived 行，不适用';
        out.skippedCount++;
      } else {
        entry.statusReason = 'AST 非法但有 Derived 行，不猜';
        out.unresolvedCount++;
      }
      out.docs.push(entry);
      continue;
    }
    entry.astCount = lessons.length;
    const ids = lessons.map((l) => l.id);
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) entry.duplicateAst.push(id);
      seen.add(id);
    }
    const derSet = new Set(derived.map((r) => r.lessonId));
    entry.missing = ids.filter((id) => !derSet.has(id));
    entry.extra = [...derSet].filter((id) => !seen.has(id));
    entry.matched = ids.filter((id) => derSet.has(id)).length;
    if (entry.duplicateAst.length > 0 || entry.missing.length > 0 || entry.extra.length > 0) {
      entry.statusReason = `重复id=${entry.duplicateAst.length} 缺失=${entry.missing.length} 多余=${entry.extra.length}`;
      out.unresolvedCount++;
    } else {
      entry.status = 'ok';
      entry.statusReason = `${entry.matched} 课全匹配，可回填`;
      entry.updates = ids.map((lessonId, i) => ({ lessonId, sortOrder: i + 1 }));
      out.okCount++;
    }
    out.docs.push(entry);
  }
  return out;
}

export interface LessonOrderingApplyResult {
  documents: number;
  rows: number;
  /** post-apply 验证：是否全 ok 且 sort_order 连续 */
  verified: boolean;
}

function hasTable(db: Database, name: string): boolean {
  const r = db.query("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as { n: number };
  return r.n > 0;
}

/**
 * P1-B 回填 apply（显式调用才写）：
 * - 调用方先跑 planLessonOrdering 做 preflight；任一 status=unresolved 即抛，不做部分回填；
 * - 仅 UPDATE textbook_lessons.sort_order，不重写 AST，不碰其他 Derived 表；
 * - 单事务；每行按 (document_id, lesson_id) 精确更新并断言 changes=1；
 * - 幂等：重跑写出相同值；post-apply 用同一 plan 语义验证。
 */
export function applyLessonOrdering(db: Database, plan: LessonOrderingPlan): LessonOrderingApplyResult {
  const bad = plan.docs.filter((d) => d.status === 'unresolved');
  if (bad.length > 0) {
    throw new Error(
      `lesson-ordering apply 拒绝：${bad.length} 个文档 unresolved（${bad.map((d) => d.documentId).join(',')}），不做部分回填`
    );
  }
  const targets = plan.docs.filter((d) => d.status === 'ok');
  const update = db.prepare(
    'UPDATE textbook_lessons SET sort_order = ? WHERE document_id = ? AND lesson_id = ?'
  );
  const tx = db.transaction((docs: LessonOrderingDocPlan[]) => {
    let rows = 0;
    for (const d of docs) {
      for (const u of d.updates) {
        const r = update.run(u.sortOrder, d.documentId, u.lessonId) as unknown as { changes: number };
        if (Number(r.changes) !== 1) {
          throw new Error(`更新断言失败：${d.documentId}/${u.lessonId} changes=${String(r.changes)}`);
        }
        rows++;
      }
    }
    return rows;
  });
  const rows = tx(targets);
  // post-apply 验证：重跑 plan 全 ok + 库内 sort_order 连续
  const replan = planLessonOrdering(db);
  const stillBad = replan.docs.filter((d) => d.status === 'unresolved').length;
  const dense = verifyDense(db);
  return {
    documents: targets.length,
    rows,
    verified: stillBad === 0 && dense,
  };
}

/** 1-based dense 连续性：每个有课文档 min=1、max=COUNT、无重复、无 NULL。 */
export function verifyDense(db: Database): boolean {
  if (!hasTable(db, 'textbook_lessons')) return true;
  const cols = db.query('PRAGMA table_info(textbook_lessons)').all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'sort_order')) return true;
  const bad = db.query(
    `SELECT COUNT(*) AS n FROM (
       SELECT document_id,
              COUNT(*) AS c,
              COUNT(sort_order) AS filled,
              MIN(sort_order) AS mn,
              MAX(sort_order) AS mx,
              COUNT(DISTINCT sort_order) AS distinctN
         FROM textbook_lessons GROUP BY document_id
    ) WHERE filled != c OR mn != 1 OR mx != c OR distinctN != c`
  ).get() as { n: number };
  if (bad.n > 0) return false;
  // 非整数 affinity（REAL/TEXT 混入）同样拒绝
  const nonInt = db.query(
    `SELECT COUNT(*) AS n FROM textbook_lessons WHERE typeof(sort_order) != 'integer' OR sort_order <= 0`
  ).get() as { n: number };
  return nonInt.n === 0;
}

export function formatOrderingPlan(plan: LessonOrderingPlan): string {
  const lines = [
    `ok=${plan.okCount} unresolved=${plan.unresolvedCount} skipped=${plan.skippedCount}`,
  ];
  for (const d of plan.docs) {
    lines.push(
      `${d.status.toUpperCase()} ${d.documentId} ast=${d.astCount} derived=${d.derivedCount} matched=${d.matched} ` +
        `missing=[${d.missing.join(',')}] extra=[${d.extra.join(',')}] dup=[${d.duplicateAst.join(',')}] ${d.statusReason}`
    );
  }
  return lines.join('\n');
}
