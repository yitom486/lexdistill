import { describe, expect, it, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { applyOrphanCleanup, applySeedSourceFix, REPAIR_ALLOWLIST } from '@study-studio/storage-sqlite';

/** R1-A：首次 apply 有修改，第二次为 0；白名单之外不动。 */
const open: Database[] = [];
afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

function seed(): Database {
  const db = new Database(':memory:');
  open.push(db);
  // Fixed schema/data fixture: run() executes the intentional multi-statement batch.
  db.run(`
    CREATE TABLE documents (id TEXT PRIMARY KEY);
    CREATE TABLE textbook_lessons (document_id TEXT NOT NULL, lesson_id TEXT NOT NULL, PRIMARY KEY (document_id, lesson_id));
    CREATE TABLE textbook_lines (document_id TEXT NOT NULL, lesson_id TEXT NOT NULL, ord INTEGER NOT NULL, ja TEXT NOT NULL, PRIMARY KEY (document_id, lesson_id, ord));
    CREATE VIRTUAL TABLE textbook_fts USING fts5(surface, reading, gloss, ja, zh, document_id UNINDEXED, lesson_id UNINDEXED, kind UNINDEXED, ref UNINDEXED);
    CREATE TABLE document_imports (id TEXT PRIMARY KEY, status TEXT NOT NULL, document_id TEXT);
    INSERT INTO documents VALUES ('keep');
    INSERT INTO textbook_lessons VALUES ('keep','l1'),('gone','l1');
    INSERT INTO textbook_lines VALUES ('gone','l1',0,'x');
    INSERT INTO textbook_fts VALUES (NULL,NULL,NULL,'x',NULL,'gone','l1','line','l1#d0');
    INSERT INTO document_imports VALUES ('i1','done','gone');
  `);
  return db;
}

describe('R1-A orphan apply', () => {
  it('白名单内容与删除生命周期一致（10 表）', () => {
    expect([...REPAIR_ALLOWLIST]).toEqual([
      'textbook_lessons', 'textbook_lines', 'textbook_vocab', 'textbook_grammar',
      'textbook_exercises', 'textbook_term_map', 'textbook_fts',
      'reading_positions', 'annotations', 'document_structure',
    ]);
  });

  it('首次 apply 删除孤儿，审计行保留；第二次为 0', () => {
    const db = seed();
    const first = applyOrphanCleanup(db);
    const lessons = first.applied.find((r) => r.table === 'textbook_lessons')!;
    expect(lessons).toMatchObject({ before: 1, deleted: 1, after: 0 });
    const lines = first.applied.find((r) => r.table === 'textbook_lines')!;
    expect(lines).toMatchObject({ before: 1, deleted: 1, after: 0 });
    const fts = first.applied.find((r) => r.table === 'textbook_fts')!;
    expect(fts).toMatchObject({ before: 1, deleted: 1, after: 0 });
    expect(first.totalDeleted).toBe(3);
    // keep 的行 untouched
    const kept = (db.query(`SELECT COUNT(*) AS n FROM textbook_lessons WHERE document_id='keep'`).get() as { n: number }).n;
    expect(kept).toBe(1);
    // 审计只报告不删
    expect(first.outsideAllowlist.map((o) => o.table)).toEqual(['document_imports']);
    const imports = (db.query('SELECT COUNT(*) AS n FROM document_imports').get() as { n: number }).n;
    expect(imports).toBe(1);

    const second = applyOrphanCleanup(db);
    expect(second.totalDeleted).toBe(0);
    expect(second.applied.every((r) => r.deleted === 0 && r.after === 0)).toBe(true);
  });
});

describe('R1-B seed source fix', () => {
  function seedOldStyle(): Database {
    const db = new Database(':memory:');
    // Fixed schema fixture: run() executes the intentional multi-statement DDL/data batch.
    db.run(`
      CREATE TABLE dictionary_sources (id TEXT PRIMARY KEY, language TEXT NOT NULL, provider TEXT NOT NULL, version TEXT NOT NULL, source_url TEXT NOT NULL, license_name TEXT NOT NULL, license_url TEXT NOT NULL, attribution TEXT NOT NULL, entry_count INTEGER NOT NULL DEFAULT 0, imported_at TEXT NOT NULL);
      CREATE TABLE local_dictionary_entries (id TEXT PRIMARY KEY, language TEXT NOT NULL, headword TEXT NOT NULL, source_id TEXT);
      INSERT INTO dictionary_sources VALUES ('study-studio-starter-v1-ja','ja','Lingua Studio','v1','u','l','u','a',24,'t');
    `);
    // 旧种子写法：未后缀 source_id；en 源行缺失；第三方悬空一行
    const ins = db.prepare('INSERT INTO local_dictionary_entries VALUES (?,?,?,?)');
    ins.run('starter_ja_ame', 'ja', '雨', 'study-studio-starter-v1');
    ins.run('starter_en_apple', 'en', 'apple', 'study-studio-starter-v1');
    ins.run('third_party_x', 'ja', '第三', 'some-deleted-pack');
    return db;
  }

  it('只修白名单种子 id，第三方只报告；entry.id 不动；幂等', () => {
    const db = seedOldStyle();
    open.push(db);
    const first = applySeedSourceFix(db);
    // en 源行被补上
    expect(first.ensuredSources).toContain('study-studio-starter-v1-en');
    const ja = first.updated.find((u) => u.group === 'study-studio-starter-v1-ja');
    const en = first.updated.find((u) => u.group === 'study-studio-starter-v1-en');
    expect(ja?.updated).toBe(1);
    expect(en?.updated).toBe(1);
    expect(first.totalUpdated).toBe(2);
    // 第三方不动，只报告
    expect(first.thirdParty).toEqual([{ sourceId: 'some-deleted-pack', rows: 1 }]);
    const kept = db.query(`SELECT source_id AS s FROM local_dictionary_entries WHERE id='third_party_x'`).get() as { s: string };
    expect(kept.s).toBe('some-deleted-pack');
    // entry.id 不动
    const ids = (db.query('SELECT id AS id FROM local_dictionary_entries ORDER BY id').all() as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toEqual(['starter_en_apple', 'starter_ja_ame', 'third_party_x']);

    const second = applySeedSourceFix(db);
    expect(second.totalUpdated).toBe(0);
  });
});
