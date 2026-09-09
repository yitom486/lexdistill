import type { Database } from 'bun:sqlite';
import {
  ensureSeedDictionarySources,
  seedEntrySourceMap,
} from './seeds/seed-sources.js';

export interface OrphanApplyRow {
  table: string;
  before: number;
  deleted: number;
  after: number;
}

export interface OutsideAllowlist {
  table: string;
  column: string;
  rows: number;
  note: string;
}

export interface OrphanApplyReport {
  applied: OrphanApplyRow[];
  totalDeleted: number;
  /** allowlist 之外的新发现：只报告，不删 */
  outsideAllowlist: OutsideAllowlist[];
}

/**
 * R1-A 静态白名单（与删除生命周期表 §8 的“随删”集合同源）。
 * 白名单之外即使有 document_id 列也不得自动扩大——只报告。
 */
export const REPAIR_ALLOWLIST = [
  'textbook_lessons',
  'textbook_lines',
  'textbook_vocab',
  'textbook_grammar',
  'textbook_exercises',
  'textbook_term_map',
  'textbook_fts',
  'reading_positions',
  'annotations',
  'document_structure',
] as const;

/**
 * orphan 清理 apply：同一事务内重算 + 删除（dry-run 与 apply 不脱节）。
 * 只删白名单表中 document_id 不在 documents 的行；其余一律不动。
 * 幂等：第二次跑 deleted 全 0。
 */
export function applyOrphanCleanup(db: Database): OrphanApplyReport {
  const report: OrphanApplyReport = { applied: [], totalDeleted: 0, outsideAllowlist: [] };
  const tables = new Set(
    (db.query("SELECT name AS n FROM sqlite_master WHERE type IN ('table','view')").all() as Array<{ n: string }>).map(
      (r) => r.n
    )
  );
  if (!tables.has('documents')) throw new Error('documents 表缺失，停止');

  const countOrphan = (table: string): number => {
    const row = db
      .query(
        `SELECT COUNT(*) AS n FROM "${table}" t LEFT JOIN documents d ON d.id = t.document_id WHERE d.id IS NULL`
      )
      .get() as { n: number };
    return row.n;
  };

  db.run('BEGIN IMMEDIATE');
  try {
    for (const table of REPAIR_ALLOWLIST) {
      if (!tables.has(table)) continue;
      const before = countOrphan(table);
      if (before > 0) {
        // 注意：不用 run().changes 计数——FTS delete 会连带影子表，changes 虚高；用 before-after。
        db.run(`DELETE FROM "${table}" WHERE document_id NOT IN (SELECT id FROM documents)`);
      }
      const after = countOrphan(table);
      const deleted = before - after;
      report.applied.push({ table, before, deleted, after });
      report.totalDeleted += deleted;
    }
    db.run('COMMIT');
  } catch (e) {
    try {
      db.run('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  }

  // allowlist 之外：只报告（document_imports=审计保留，passage=历史可空，occurrences=docRef 非 FK）
  if (tables.has('document_imports')) {
    const n = (
      db.query(
        `SELECT COUNT(*) AS n FROM document_imports i LEFT JOIN documents d ON d.id = i.document_id WHERE i.document_id IS NOT NULL AND d.id IS NULL`
      ).get() as { n: number }
    ).n;
    if (n > 0) {
      report.outsideAllowlist.push({
        table: 'document_imports',
        column: 'document_id',
        rows: n,
        note: '审计保留，不删（删除生命周期表 §8）。',
      });
    }
  }
  if (tables.has('practice_items')) {
    const n = (
      db.query(
        `SELECT COUNT(*) AS n FROM practice_items p LEFT JOIN documents d ON d.id = p.passage_document_id WHERE p.passage_document_id IS NOT NULL AND d.id IS NULL`
      ).get() as { n: number }
    ).n;
    if (n > 0) {
      report.outsideAllowlist.push({
        table: 'practice_items',
        column: 'passage_document_id',
        rows: n,
        note: '练习历史保留，不删；展示降级。',
      });
    }
  }
  return report;
}

export function formatOrphanApplyReport(report: OrphanApplyReport): string {
  const lines = ['Orphan Cleanup Apply (R1-A)', ''];
  lines.push('table | before | deleted | after');
  for (const r of report.applied) {
    lines.push(`${r.table} | ${r.before} | ${r.deleted} | ${r.after}`);
  }
  lines.push(`total deleted: ${report.totalDeleted}`);
  if (report.outsideAllowlist.length > 0) {
    lines.push('');
    lines.push('allowlist 之外（只报告，未动）：');
    for (const o of report.outsideAllowlist) {
      lines.push(`  - ${o.table}.${o.column}: ${o.rows} 行。${o.note}`);
    }
  }
  return lines.join('\n');
}

export interface SeedSourceApplyRow {
  group: string;
  updated: number;
}

export interface SeedSourceApplyReport {
  ensuredSources: string[];
  updated: SeedSourceApplyRow[];
  totalUpdated: number;
  /** 非种子第三方悬空：只报告，不动 */
  thirdParty: Array<{ sourceId: string; rows: number }>;
}

/**
 * R1-B 种子 source 修复 apply（与 bootstrap 共用 ensureSeedDictionarySources）。
 * - 先幂等确保 4 个源行存在（不调整个 seedInitialData）；
 * - 只更新 entry.id ∈ STARTER/N5 种子白名单 且 source_id 悬空的行；
 * - 不改 entry.id，不改 ranking，不碰第三方。
 * 幂等：第二次 updated 全 0。
 */
export function applySeedSourceFix(db: Database): SeedSourceApplyReport {
  const report: SeedSourceApplyReport = {
    ensuredSources: [],
    updated: [],
    totalUpdated: 0,
    thirdParty: [],
  };
  report.ensuredSources = ensureSeedDictionarySources(db).ensured;
  const whitelist = seedEntrySourceMap();
  const dangling = db.query(
    `SELECT e.id AS id, e.source_id AS s FROM local_dictionary_entries e LEFT JOIN dictionary_sources x ON x.id = e.source_id WHERE e.source_id IS NOT NULL AND x.id IS NULL`
  ).all() as Array<{ id: string; s: string }>;
  const byTarget = new Map<string, string[]>();
  const third = new Map<string, number>();
  for (const row of dangling) {
    const target = whitelist.get(row.id);
    if (target) {
      const list = byTarget.get(target) ?? [];
      list.push(row.id);
      byTarget.set(target, list);
    } else {
      third.set(row.s, (third.get(row.s) ?? 0) + 1);
    }
  }
  db.run('BEGIN IMMEDIATE');
  try {
    const stmt = db.prepare('UPDATE local_dictionary_entries SET source_id = ? WHERE id = ?');
    for (const [target, ids] of byTarget) {
      let n = 0;
      for (const id of ids) {
        stmt.run(target, id);
        n++;
      }
      report.updated.push({ group: target, updated: n });
      report.totalUpdated += n;
    }
    db.run('COMMIT');
  } catch (e) {
    try {
      db.run('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  }
  for (const [sourceId, rows] of third) {
    report.thirdParty.push({ sourceId, rows });
  }
  return report;
}
