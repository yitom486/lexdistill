import { BusinessError } from '@study-studio/shared';
import { TextbookASTSchema } from '@study-studio/document-model';
import { count, eq, sql } from 'drizzle-orm';
import {
  documents,
  textbookExercises,
  textbookGrammar,
  textbookLessons,
  textbookLines,
  textbookVocab,
} from '../../schema.js';
import type { DrizzleDb } from '../../connection.js';
import { TEXTBOOK_BOOKS } from '../../seeds/textbook-seed.js';
import { shredIntoTransaction } from './textbook-shred.js';
import { nowIso } from '@study-studio/shared';

/**
 * D3 起家在 storage-sqlite（前身 gateway modules/library/persistence/seed-repair.ts，
 * 逻辑不变）。签名已是 `DrizzleDb`/`Database` 显式参数，无需收窄。
 */

export interface SeedMigrationDocReport {
  documentId: string;
  title: string;
  oldShape: 'legacy-dialect' | 'canonical' | 'unrecognized';
  migrated: boolean;
  note: string;
  lessons: number;
  lines: number;
  vocab: number;
  grammar: number;
  exercises: number;
  ftsRows: number;
}

export interface SeedMigrationReport {
  docs: SeedMigrationDocReport[];
}

const SEED_IDS = new Set(TEXTBOOK_BOOKS.map((b) => b.id));

type Rec = Record<string, unknown>;

/** 单个文法条目是否精确命中 legacy 方言（有 structure 无 connection 即需迁；两者并存=歧义）。 */
function grammarDialectKind(item: unknown): 'legacy' | 'canonical' | 'ambiguous' | 'unrecognized' {
  if (!item || typeof item !== 'object') return 'unrecognized';
  const r = item as Rec;
  const hasStructure = typeof r.structure === 'string';
  const hasConnection = typeof r.connection === 'string';
  if (hasStructure && hasConnection) return 'ambiguous';
  if (typeof r.title !== 'string') return 'unrecognized';
  let kind: 'legacy' | 'canonical' | 'ambiguous' | 'unrecognized' = hasStructure ? 'legacy' : 'canonical';
  const examples = Array.isArray(r.examples) ? (r.examples as unknown[]) : null;
  if (examples === null) return hasStructure || hasConnection ? kind : 'unrecognized';
  for (const e of examples) {
    if (!e || typeof e !== 'object') return 'unrecognized';
    const er = e as Rec;
    const hasJa = typeof er.ja === 'string';
    const hasJapanese = typeof er.japanese === 'string';
    const hasZh = typeof er.zh === 'string';
    const hasChinese = typeof er.chinese === 'string';
    if ((hasJa && hasJapanese) || (hasZh && hasChinese)) return 'ambiguous';
    if (hasJa || hasZh) {
      if (kind === 'canonical') kind = 'legacy';
    }
  }
  return kind;
}

function migrateGrammarItem(item: Rec): { item: Rec; migrated: boolean } {
  const next: Rec = { ...item };
  let migrated = false;
  if (typeof next.structure === 'string' && typeof next.connection !== 'string') {
    next.connection = next.structure;
    delete next.structure;
    migrated = true;
  }
  if (Array.isArray(next.examples)) {
    next.examples = (next.examples as unknown[]).map((e) => {
      if (!e || typeof e !== 'object') return e;
      const er = { ...(e as Rec) };
      if (typeof er.ja === 'string' && typeof er.japanese !== 'string') {
        er.japanese = er.ja;
        delete er.ja;
        migrated = true;
      }
      if (typeof er.zh === 'string' && typeof er.chinese !== 'string') {
        er.chinese = er.zh;
        delete er.zh;
        migrated = true;
      }
      return er;
    });
  }
  return { item: next, migrated };
}

/**
 * R1-C 受控 seed AST 迁移 + shred（白名单种子文档专用）。
 * 准入（缺一不可，否则 skip 原样不动）：
 * 1. documents.source_kind = 'curriculum_textbook'；
 * 2. id ∈ TEXTBOOK_BOOKS；
 * 3. 落库 AST.id == document id；
 * 4. 至少一条文法命中 legacy 方言，且无 ambiguous/unrecognized 条目。
 * 普通用户文档绝不按“有 lessons”迁移。
 * 原子落库：同一 drizzle 事务内 UPDATE ast_json + shred；步后验证行数/FTS。
 * 第二次跑：全 canonical → migrated 全 false，零写。
 */
export function applySeedAstMigration(db: DrizzleDb): SeedMigrationReport {
  const report: SeedMigrationReport = { docs: [] };
  const rows = db
    .select({
      id: documents.id,
      title: documents.title,
      sourceKind: documents.sourceKind,
      astJson: documents.astJson,
    })
    .from(documents)
    .all();
  for (const row of rows) {
    if (!SEED_IDS.has(row.id)) continue;
    if (row.sourceKind !== 'curriculum_textbook') {
      report.docs.push({
        documentId: row.id, title: row.title, oldShape: 'unrecognized', migrated: false,
        note: 'source_kind 非 curriculum_textbook，跳过', lessons: 0, lines: 0, vocab: 0, grammar: 0, exercises: 0, ftsRows: 0,
      });
      continue;
    }
    let ast: unknown = null;
    try {
      ast = row.astJson ? (JSON.parse(row.astJson) as unknown) : null;
    } catch {
      ast = null;
    }
    const fail = (
      oldShape: SeedMigrationDocReport['oldShape'],
      note: string
    ): void => {
      report.docs.push({
        documentId: row.id, title: row.title, oldShape, migrated: false, note,
        lessons: 0, lines: 0, vocab: 0, grammar: 0, exercises: 0, ftsRows: 0,
      });
    };
    if (!ast || typeof ast !== 'object' || (ast as Rec).id !== row.id) {
      fail('unrecognized', 'AST 缺失/损坏或 id 与文档不一致，保持原样');
      continue;
    }
    const lessons = (ast as Rec).lessons;
    if (!Array.isArray(lessons)) {
      fail('unrecognized', 'AST 无 lessons 数组，保持原样');
      continue;
    }
    // 方言判定（整本精确匹配才迁）
    let needMigration = false;
    let blocked = false;
    for (const lesson of lessons) {
      const points =
        lesson && typeof lesson === 'object' && Array.isArray((lesson as Rec).grammarPoints)
          ? ((lesson as Rec).grammarPoints as unknown[])
          : [];
      for (const g of points) {
        const kind = grammarDialectKind(g);
        if (kind === 'legacy') needMigration = true;
        else if (kind === 'ambiguous' || kind === 'unrecognized') blocked = true;
      }
    }
    if (blocked) {
      fail('unrecognized', '存在 ambiguous/unrecognized 文法条目，非精确 legacy 方言，保持原样');
      continue;
    }
    if (!needMigration) {
      fail('canonical', '已是 canonical，无需迁移（no-op，零写）');
      continue;
    }
    // 确定性迁移（深克隆，只改文法键）
    const migrated = JSON.parse(JSON.stringify(ast)) as Rec;
    (migrated.lessons as unknown[]).forEach((lesson, i) => {
      const srcPoints = (lessons[i] as Rec).grammarPoints as unknown[];
      (lesson as Rec).grammarPoints = srcPoints.map((g) => migrateGrammarItem(g as Rec).item);
    });
    const validated = TextbookASTSchema.safeParse(migrated);
    if (!validated.success) {
      fail('legacy-dialect', '迁移后仍过不了 canonical 校验，保持原样');
      continue;
    }
    const migratedStr = JSON.stringify(validated.data);
    const now = nowIso();
    db.transaction((tx) => {
      tx.update(documents)
        .set({ astJson: migratedStr, updatedAt: now })
        .where(eq(documents.id, row.id))
        .run();
      shredIntoTransaction(tx, row.id, validated.data);
    });
    // 步后验证：回读一致 + 行数
    const back = db
      .select({ astJson: documents.astJson })
      .from(documents)
      .where(eq(documents.id, row.id))
      .all();
    if (back[0]?.astJson !== migratedStr) {
      throw new BusinessError(
        'E_INTERNAL',
        `种子迁移验证失败：${row.id} AST 回读不一致`,
        'DATABASE',
        true
      );
    }
    const counted = countDocRows(db, row.id);
    const expectedLessons = validated.data.lessons.length;
    if (counted.lessons !== expectedLessons) {
      throw new BusinessError(
        'E_INTERNAL',
        `种子迁移验证失败：${row.id} 课数 ${counted.lessons}≠${expectedLessons}`,
        'DATABASE',
        true
      );
    }
    const expectFts = counted.vocab + counted.lines > 0;
    if (expectFts && counted.fts === 0) {
      throw new BusinessError(
        'E_INTERNAL',
        `种子迁移验证失败：${row.id} FTS 为空`,
        'DATABASE',
        true
      );
    }
    report.docs.push({
      documentId: row.id,
      title: row.title,
      oldShape: 'legacy-dialect',
      migrated: true,
      note: 'structure→connection，ja→japanese，zh→chinese；AST 更新与 shred 同事务',
      lessons: counted.lessons,
      lines: counted.lines,
      vocab: counted.vocab,
      grammar: counted.grammar,
      exercises: counted.exercises,
      ftsRows: counted.fts,
    });
  }
  return report;
}

function countDocRows(
  db: DrizzleDb,
  documentId: string
): { lessons: number; lines: number; vocab: number; grammar: number; exercises: number; fts: number } {
  // 只读计数走 drizzle 构造器；FTS 无表定义，走原生 sql（§1.9 豁免②）。
  const n = (row: { n: number } | undefined): number => row?.n ?? 0;
  const lessons = n(db.select({ n: count() }).from(textbookLessons).where(eq(textbookLessons.documentId, documentId)).get());
  const lines = n(db.select({ n: count() }).from(textbookLines).where(eq(textbookLines.documentId, documentId)).get());
  const vocab = n(db.select({ n: count() }).from(textbookVocab).where(eq(textbookVocab.documentId, documentId)).get());
  const grammar = n(db.select({ n: count() }).from(textbookGrammar).where(eq(textbookGrammar.documentId, documentId)).get());
  const exercises = n(db.select({ n: count() }).from(textbookExercises).where(eq(textbookExercises.documentId, documentId)).get());
  const ftsRows = db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM textbook_fts WHERE document_id = ${documentId}`);
  const fts = ftsRows[0]?.n ?? 0;
  return { lessons, lines, vocab, grammar, exercises, fts };
}
