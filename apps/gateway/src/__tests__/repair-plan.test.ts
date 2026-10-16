import { describe, expect, it, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { buildRepairPlan } from '@lexdistill/storage-sqlite';

/** repair-plan dry-run：只读计划，无 apply。测试断言计划内容 + 库未被修改。 */
const open: Database[] = [];
afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

function mem(): Database {
  const db = new Database(':memory:');
  open.push(db);
  return db;
}

// The fixtures use run() for fixed multi-statement SQL; parameterized writes use query(...).run(...).

function snapshot(db: Database): string {
  return JSON.stringify(
    (db.query("SELECT name AS n FROM sqlite_master WHERE type='table' ORDER BY n").all() as Array<{ n: string }>).map(
      (t) =>
        `${t.n}:${
          (db.query(`SELECT COUNT(*) AS n FROM "${t.n}"`).get() as { n: number }).n
        }`
    )
  );
}

describe('repair-plan dry-run', () => {
  it('孤儿按 invariant 发现（不硬编码 doc id），库只读未改', () => {
    const db = mem();
    db.run(`
      CREATE TABLE documents (id TEXT PRIMARY KEY);
      CREATE TABLE textbook_materials (document_id TEXT NOT NULL, lesson_id TEXT NOT NULL, PRIMARY KEY (document_id, lesson_id));
      CREATE TABLE textbook_articles (document_id TEXT NOT NULL, lesson_id TEXT NOT NULL, ord INTEGER NOT NULL, ja TEXT NOT NULL, PRIMARY KEY (document_id, lesson_id, ord));
      INSERT INTO documents VALUES ('keep');
      INSERT INTO textbook_materials VALUES ('keep','l1'),('gone','l1');
      INSERT INTO textbook_articles VALUES ('gone','l1',0,'x'),('gone','l1',1,'y');
    `);
    const before = snapshot(db);
    const plan = buildRepairPlan(db);
    // 只发现 gone 的，不碰 keep 的
    expect(plan.orphanTargets).toHaveLength(2);
    expect(plan.orphanTargets.every((t) => t.documentId === 'gone')).toBe(true);
    const lines = plan.orphanTargets.find((t) => t.table === 'textbook_articles');
    expect(lines?.rows).toBe(2);
    expect(plan.orphanTargets.every((t) => t.action === 'delete-derived-orphan')).toBe(true);
    // 只读：前后快照一致
    expect(snapshot(db)).toBe(before);
  });

  it('审计行进 needs-decision 而非删除候选', () => {
    const db = mem();
    db.run(`
      CREATE TABLE documents (id TEXT PRIMARY KEY);
      CREATE TABLE document_imports (id TEXT PRIMARY KEY, filename TEXT NOT NULL, status TEXT NOT NULL, document_id TEXT);
      INSERT INTO document_imports VALUES ('i1','a.pdf','done','gone-doc');
    `);
    const plan = buildRepairPlan(db);
    expect(plan.orphanTargets).toEqual([]);
    expect(plan.needsDecisionImports).toHaveLength(1);
    expect(plan.needsDecisionImports[0]?.importId).toBe('i1');
  });

  it('source_id 候选按“现值+语言”规则推导', () => {
    const db = mem();
    db.run(`
      CREATE TABLE documents (id TEXT PRIMARY KEY);
      CREATE TABLE dictionary_sources (id TEXT PRIMARY KEY);
      CREATE TABLE local_dictionary_entries (id TEXT PRIMARY KEY, language TEXT NOT NULL, headword TEXT NOT NULL, source_id TEXT);
      INSERT INTO dictionary_sources VALUES ('base-ja'),('base-ko');
      INSERT INTO local_dictionary_entries VALUES ('a','ja','x','base'),('b','ko','y','base'),('c','en','z','base');
    `);
    const plan = buildRepairPlan(db);
    const ja = plan.sourceIdCandidates.find((c) => c.language === 'ja');
    const en = plan.sourceIdCandidates.find((c) => c.language === 'en');
    expect(ja?.candidateSourceId).toBe('base-ja');
    // en 无源行：候选为空 + 注明，不是硬编码跳过
    expect(en?.candidateSourceId).toBeNull();
    expect(en?.note).toContain('需先补源行');
  });


  it('空库不炸', () => {
    const plan = buildRepairPlan(mem());
    expect(plan.orphanTargets).toEqual([]);
    expect(plan.orphanRowsTotal).toBe(0);
  });
});
