import { describe, expect, it } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { eq } from 'drizzle-orm';
import { createDrizzleDb } from '../infrastructure/db/index.js';
import type { DrizzleDb } from '../infrastructure/db/index.js';
import { documents } from '../infrastructure/db/schema.js';
import { TEXTBOOK_BOOKS } from '../infrastructure/db/seeds/textbook-seed.js';
import { applySeedAstMigration } from '../modules/library/persistence/seed-repair.js';
import { runDoctor } from '../infrastructure/db/doctor.js';

/**
 * R1-C：白名单种子文档的方言 AST 迁移 + shred 原子落库。
 * - 种子源已 canonical 化，故测试手工构造 legacy 方言落库态（= 线上老库形状）再迁；
 * - 只碰 curriculum_textbook 白名单 id；普通用户文档（含 lessons）绝不迁移；
 * - 第二次跑 no-op（零写）；非法/歧义形状保持原样。
 */

function toLegacyDialect(book: unknown): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(book)) as {
    lessons: Array<{ grammarPoints: Array<Record<string, unknown>> }>;
  };
  for (const lesson of clone.lessons) {
    for (const g of lesson.grammarPoints) {
      if (typeof g.connection === 'string') {
        g.structure = g.connection;
        delete g.connection;
      }
      if (Array.isArray(g.examples)) {
        g.examples = (g.examples as Array<Record<string, unknown>>).map((e) => {
          const next: Record<string, unknown> = { ...e };
          if (typeof next.japanese === 'string') {
            next.ja = next.japanese;
            delete next.japanese;
          }
          if (typeof next.chinese === 'string') {
            next.zh = next.chinese;
            delete next.chinese;
          }
          return next;
        });
      }
    }
  }
  return clone as unknown as Record<string, unknown>;
}

function storedAst(db: DrizzleDb, id: string): string {
  const rows = db
    .select({ astJson: documents.astJson })
    .from(documents)
    .where(eq(documents.id, id))
    .all();
  return rows[0]?.astJson as string;
}

function putLegacySeedDoc(sqlite: Database, bookId: string): void {
  const book = TEXTBOOK_BOOKS.find((b) => b.id === bookId);
  if (!book) throw new Error(`seed book missing: ${bookId}`);
  const legacy = toLegacyDialect(book);
  const now = new Date().toISOString();
  sqlite
    .query(
      'UPDATE documents SET ast_json = ?, updated_at = ? WHERE id = ?'
    )
    .run(JSON.stringify(legacy), now, bookId);
}

function countAll(sqlite: Database): string {
  const tables = [
    'documents', 'textbook_lessons', 'textbook_lines', 'textbook_vocab', 'textbook_grammar',
    'textbook_exercises', 'textbook_term_map', 'textbook_fts',
  ];
  return tables
    .map((t) => `${t}:${(sqlite.query(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n}`)
    .join(',');
}

describe('R1-C seed AST migration', () => {
  it('legacy 方言种子迁移落库，计数对齐；第二次 no-op', () => {
    const { db, sqlite } = createDrizzleDb(':memory:');
    try {
      // 新鲜库种子源已 canonical：先回退为线上老库的方言形
      for (const b of TEXTBOOK_BOOKS) putLegacySeedDoc(sqlite, b.id);
      const first = applySeedAstMigration(db);
      expect(first.docs).toHaveLength(3);
      expect(first.docs.every((d) => d.migrated && d.oldShape === 'legacy-dialect')).toBe(true);
      const biaori = first.docs.find((d) => d.documentId === 'biaori-primary-1')!;
      expect(biaori.lessons).toBe(2);
      expect(biaori.grammar).toBeGreaterThan(0);
      // AST 已 canonical 化（structure/ja/zh 消失）
      const ast = storedAst(db, 'biaori-primary-1');
      expect(ast).not.toContain('"structure"');
      expect(ast).not.toContain('"ja":');
      expect(ast).toContain('"connection"');
      // 行数快照：第二次跑必须零写
      const snap = countAll(sqlite);
      const second = applySeedAstMigration(db);
      expect(second.docs.every((d) => !d.migrated && d.oldShape === 'canonical')).toBe(true);
      expect(countAll(sqlite)).toBe(snap);
      // doctor：种子空课 WARN 消失
      const report = runDoctor(sqlite);
      expect(report.findings.find((f) => f.rule === 'import:empty-lessons')?.level).toBe('PASS');
    } finally {
      sqlite.close();
    }
  });

  it('普通用户文档（含 lessons）绝不迁移', () => {
    const { db, sqlite } = createDrizzleDb(':memory:');
    try {
      const now = new Date().toISOString();
      sqlite.run(
        `INSERT INTO documents (id, user_id, title, source_kind, language, content, ast_json, created_at, updated_at)
         VALUES ('user-doc-1','u1','用户书','user_import','ja','x','{"id":"user-doc-1","language":"JA","title":"t","shortTitle":"t","lessons":[{"id":"l1","lessonNumber":1,"title":"t","vocabularies":[],"grammarPoints":[],"dialogues":[],"exercises":[]}]}','${now}','${now}')`
      );
      const report = applySeedAstMigration(db);
      expect(report.docs.some((d) => d.documentId === 'user-doc-1')).toBe(false);
      // 方言种子照迁（3 本全在白名单内）
      for (const b of TEXTBOOK_BOOKS) putLegacySeedDoc(sqlite, b.id);
      const report2 = applySeedAstMigration(db);
      expect(report2.docs.filter((d) => d.migrated).length).toBe(3);
    } finally {
      sqlite.close();
    }
  });

  it('歧义形状保持原样（只报不写）', () => {
    const { db, sqlite } = createDrizzleDb(':memory:');
    try {
      putLegacySeedDoc(sqlite, 'nce-primary-1');
      // 改成歧义形（connection+structure 并存）
      const ast = JSON.parse(storedAst(db, 'nce-primary-1')) as {
        lessons: Array<{ grammarPoints: Array<Record<string, unknown>> }>;
      };
      (ast.lessons[0]?.grammarPoints[0] as Record<string, unknown>).connection = '已有接续';
      sqlite.query('UPDATE documents SET ast_json = ? WHERE id = ?').run(JSON.stringify(ast), 'nce-primary-1');
      const report = applySeedAstMigration(db);
      const nce = report.docs.find((d) => d.documentId === 'nce-primary-1')!;
      expect(nce.migrated).toBe(false);
      expect(nce.oldShape).toBe('unrecognized');
      const n = sqlite.query(`SELECT COUNT(*) AS n FROM textbook_lessons WHERE document_id='nce-primary-1'`).get() as {
        n: number;
      };
      expect(n.n).toBe(0);
    } finally {
      sqlite.close();
    }
  });
});
