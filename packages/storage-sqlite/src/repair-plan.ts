import type { Database } from 'bun:sqlite';

export interface OrphanTarget {
  documentId: string;
  table: string;
  rows: number;
  /** 全部为可安全删除的 derived/cache 孤儿（删文档时应随删而未删的） */
  action: 'delete-derived-orphan';
}

export interface NeedsDecisionImport {
  importId: string;
  filename: string;
  status: string;
  documentId: string | null;
  note: string;
}

export interface SourceIdCandidate {
  currentSourceId: string;
  language: string;
  rows: number;
  candidateSourceId: string | null;
  note: string;
}

export interface SeedShredCandidate {
  documentId: string;
  title: string;
  lessonsInAst: number;
  note: string;
}

export interface RepairPlan {
  generatedAt: string;
  orphanTargets: OrphanTarget[];
  orphanRowsTotal: number;
  needsDecisionImports: NeedsDecisionImport[];
  sourceIdCandidates: SourceIdCandidate[];
  seedShredCandidates: SeedShredCandidate[];
}

/**
 * 历史修复 dry-run（只读，无 apply）。
 * - 目标全按 orphan invariant 自动发现，不硬编码任何 doc id；
 * - 只输出计划，不写库，不提供默认 apply 行为（apply 另行指令）。
 */
export function buildRepairPlan(db: Database): RepairPlan {
  const plan: RepairPlan = {
    generatedAt: new Date().toISOString(),
    orphanTargets: [],
    orphanRowsTotal: 0,
    needsDecisionImports: [],
    sourceIdCandidates: [],
    seedShredCandidates: [],
  };
  const tables = new Set(
    (
      db.query("SELECT name AS n FROM sqlite_master WHERE type IN ('table','view')").all() as Array<{ n: string }>
    ).map((r) => r.n)
  );
  if (!tables.has('documents')) return plan;

  // ---- 1. 可安全删除的 derived/cache 孤儿（与 deleteDocument 清单同源） ----
  const derived: string[] = [
    'textbook_materials', 'textbook_articles', 'textbook_sentences', 'textbook_vocabulary', 'textbook_knowledge',
    'textbook_exercise_items', 'textbook_fts',
    'reading_positions', 'annotations', 'document_structure',
  ].filter((t) => tables.has(t));
  for (const table of derived) {
    const rows = db.query(
      `SELECT t.document_id AS d, COUNT(*) AS n FROM "${table}" t LEFT JOIN documents x ON x.id = t.document_id WHERE x.id IS NULL GROUP BY t.document_id`
    ).all() as Array<{ d: string; n: number }>;
    for (const r of rows) {
      plan.orphanTargets.push({ documentId: r.d, table, rows: r.n, action: 'delete-derived-orphan' });
      plan.orphanRowsTotal += r.n;
    }
  }
  plan.orphanTargets.sort((a, b) => b.rows - a.rows);

  // ---- 2. 需要生命周期决策的行（默认保留，只列出来） ----
  if (tables.has('document_imports')) {
    const rows = db.query(
      `SELECT i.id AS id, i.filename AS f, i.status AS s, i.document_id AS d FROM document_imports i LEFT JOIN documents x ON x.id = i.document_id WHERE i.document_id IS NOT NULL AND x.id IS NULL`
    ).all() as Array<{ id: string; f: string; s: string; d: string }>;
    for (const r of rows) {
      plan.needsDecisionImports.push({
        importId: r.id,
        filename: r.f,
        status: r.s,
        documentId: r.d,
        note: '任务审计：删文档不删任务（删除生命周期表 §8）。候选：保留 / 补 document_title_snapshot 列（需 schema 扩展，未决）。',
      });
    }
  }

  // ---- 3. source_id 映射候选（规则：现值 + '-' + language 若存在即候选） ----
  if (tables.has('local_dictionary_entries') && tables.has('dictionary_sources')) {
    const groups = db.query(
      `SELECT e.source_id AS s, e.language AS lang, COUNT(*) AS n FROM local_dictionary_entries e LEFT JOIN dictionary_sources x ON x.id = e.source_id WHERE e.source_id IS NOT NULL AND x.id IS NULL GROUP BY e.source_id, e.language`
    ).all() as Array<{ s: string; lang: string; n: number }>;
    for (const g of groups) {
      const candidate = `${g.s}-${g.lang}`;
      const exists = db.query('SELECT 1 AS ok FROM dictionary_sources WHERE id = ?').get(candidate) as { ok: number } | null;
      plan.sourceIdCandidates.push({
        currentSourceId: g.s,
        language: g.lang,
        rows: g.n,
        candidateSourceId: exists ? candidate : null,
        note: exists
          ? `可更新为 ${candidate}`
          : `源行 ${candidate} 不存在：需先补源行（种子已补 ${g.lang} 源行，新库自带；老库等 repair 指令），暂不更新`,
      });
    }
  }

  return plan;
}

export function formatRepairPlan(plan: RepairPlan): string {
  const lines = ['Repair Plan (DRY-RUN, read-only, no apply)', `generated: ${plan.generatedAt}`, ''];
  lines.push(`## 1. 可安全删除的 derived/cache 孤儿（${plan.orphanTargets.length} 组，共 ${plan.orphanRowsTotal} 行）`);
  for (const t of plan.orphanTargets) {
    lines.push(`  - ${t.documentId} ${t.table}: ${t.rows} 行 [${t.action}]`);
  }
  if (plan.orphanTargets.length === 0) lines.push('  （无）');
  lines.push('');
  lines.push(`## 2. 需生命周期决策（默认保留，共 ${plan.needsDecisionImports.length} 行）`);
  for (const t of plan.needsDecisionImports) {
    lines.push(`  - ${t.importId} ${t.filename} status=${t.status} doc=${t.documentId}`);
    lines.push(`    ${t.note}`);
  }
  if (plan.needsDecisionImports.length === 0) lines.push('  （无）');
  lines.push('');
  lines.push(`## 3. source_id 映射候选（共 ${plan.sourceIdCandidates.length} 组）`);
  for (const t of plan.sourceIdCandidates) {
    lines.push(`  - ${t.currentSourceId} [${t.language}] x${t.rows} → ${t.candidateSourceId ?? '（暂无候选）'}`);
    lines.push(`    ${t.note}`);
  }
  if (plan.sourceIdCandidates.length === 0) lines.push('  （无）');
  lines.push('');
  lines.push(`## 4. 种子 shred 候选（共 ${plan.seedShredCandidates.length} 本）`);
  for (const t of plan.seedShredCandidates) {
    lines.push(`  - ${t.documentId} [${t.title}] AST 内 ${t.lessonsInAst} 课`);
    lines.push(`    ${t.note}`);
  }
  if (plan.seedShredCandidates.length === 0) lines.push('  （无）');
  return lines.join('\n');
}
