import { describe, expect, it, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runDoctor } from '../infrastructure/db/doctor.js';

/**
 * db doctor 规则测试：内存库手造脏数据，断言每条规则命中。
 * 注意 doctor 只读：表不存在即跳过，故测试库只建用到的表。
 */
const open: Database[] = [];
afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

function mem(): Database {
  const db = new Database(':memory:');
  open.push(db);
  return db;
}

function seedClean(db: Database): void {
  db.exec(`
    CREATE TABLE documents (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, source_kind TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'ja', content TEXT NOT NULL, ast_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE textbook_lessons (document_id TEXT NOT NULL, lesson_id TEXT NOT NULL, lesson_number INTEGER NOT NULL, title TEXT NOT NULL, PRIMARY KEY (document_id, lesson_id));
    CREATE TABLE textbook_lines (document_id TEXT NOT NULL, lesson_id TEXT NOT NULL, ord INTEGER NOT NULL, speaker TEXT, ja TEXT NOT NULL, zh TEXT, PRIMARY KEY (document_id, lesson_id, ord));
    CREATE TABLE textbook_vocab (document_id TEXT NOT NULL, lesson_id TEXT NOT NULL, ord INTEGER NOT NULL, surface TEXT NOT NULL, reading TEXT, pos TEXT, gloss_zh TEXT, pitch TEXT, example_ja TEXT, example_zh TEXT, PRIMARY KEY (document_id, lesson_id, ord));
    CREATE TABLE textbook_grammar (document_id TEXT NOT NULL, lesson_id TEXT NOT NULL, ord INTEGER NOT NULL, title TEXT NOT NULL, connection TEXT, explanation TEXT, examples_json TEXT NOT NULL DEFAULT '[]', PRIMARY KEY (document_id, lesson_id, ord));
    CREATE TABLE textbook_exercises (document_id TEXT NOT NULL, lesson_id TEXT NOT NULL, ord INTEGER NOT NULL, exercise_id TEXT, type TEXT NOT NULL, prompt TEXT NOT NULL, options_json TEXT NOT NULL DEFAULT '[]', answer TEXT NOT NULL DEFAULT '', explanation TEXT, PRIMARY KEY (document_id, lesson_id, ord));
    CREATE TABLE textbook_term_map (document_id TEXT NOT NULL, lesson_id TEXT NOT NULL, kind TEXT NOT NULL, ref_text TEXT NOT NULL, skill_id TEXT, entry_id TEXT, PRIMARY KEY (document_id, lesson_id, kind, ref_text));
    CREATE VIRTUAL TABLE textbook_fts USING fts5(surface, reading, gloss, ja, zh, document_id UNINDEXED, lesson_id UNINDEXED, kind UNINDEXED, ref UNINDEXED);
    CREATE TABLE local_dictionary_entries (id TEXT PRIMARY KEY, language TEXT NOT NULL, headword TEXT NOT NULL, meanings_json TEXT NOT NULL, source_id TEXT, source_label TEXT NOT NULL, license_note TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE dictionary_sources (id TEXT PRIMARY KEY, language TEXT NOT NULL, provider TEXT NOT NULL, version TEXT NOT NULL, source_url TEXT NOT NULL, license_name TEXT NOT NULL, license_url TEXT NOT NULL, attribution TEXT NOT NULL, entry_count INTEGER NOT NULL DEFAULT 0, imported_at TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE document_imports (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, source_kind TEXT NOT NULL, filename TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'processing', document_id TEXT, lessons INTEGER, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE reading_positions (user_id TEXT NOT NULL, document_id TEXT NOT NULL, locator TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (user_id, document_id));
    CREATE TABLE annotations (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL, quote TEXT NOT NULL, note TEXT, start_offset INTEGER NOT NULL DEFAULT 0, end_offset INTEGER NOT NULL DEFAULT 0, page_number INTEGER, created_by TEXT NOT NULL DEFAULT 'USER', flashcard_id TEXT, created_at TEXT NOT NULL);
    CREATE TABLE document_structure (document_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, headings_json TEXT NOT NULL DEFAULT '[]', classes_json TEXT NOT NULL DEFAULT '[]', model TEXT NOT NULL DEFAULT '', effort TEXT NOT NULL DEFAULT '', dropped INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE flashcards (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'ja', type TEXT NOT NULL, front TEXT NOT NULL, back TEXT NOT NULL, tags TEXT NOT NULL, fsrs TEXT NOT NULL, source_entry_id TEXT, created_at TEXT NOT NULL);
    CREATE TABLE card_drafts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, language TEXT NOT NULL, term_key TEXT NOT NULL, headword TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', flashcard_id TEXT, created_at TEXT NOT NULL);
    CREATE TABLE dictionary_search_history (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, language TEXT NOT NULL, query TEXT NOT NULL, hit_count INTEGER NOT NULL DEFAULT 0, top_entry_id TEXT, created_at TEXT NOT NULL);
    CREATE TABLE practice_items (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'ja', collection_id TEXT NOT NULL, question_json TEXT NOT NULL, passage_document_id TEXT, sort_order INTEGER NOT NULL DEFAULT 0, collected_at TEXT NOT NULL);
    INSERT INTO documents VALUES ('d1','u1','书','user_import','ja','c','{}','t','t');
    INSERT INTO textbook_lessons VALUES ('d1','l1',1,'第1課');
    INSERT INTO textbook_vocab VALUES ('d1','l1',0,'食べる','たべる','动词','吃',NULL,NULL,NULL);
    INSERT INTO textbook_lines VALUES ('d1','l1',0,NULL,'おはよう',NULL);
    INSERT INTO textbook_fts VALUES ('食べる','たべる','吃',NULL,NULL,'d1','l1','vocab','l1#v0');
    INSERT INTO textbook_fts VALUES (NULL,NULL,NULL,'おはよう',NULL,'d1','l1','line','l1#d0');
    INSERT INTO local_dictionary_entries (id, language, headword, meanings_json, source_id, source_label, license_note, created_at) VALUES ('e1','ja','食べる','[]',NULL,'t','l','t');
    INSERT INTO dictionary_sources VALUES ('s1','ja','p','1','u','l','u','a',1,'t',1,0);
    INSERT INTO textbook_term_map VALUES ('d1','l1','vocab','食べる',NULL,'e1');
  `);
}

function levelOf(report: ReturnType<typeof runDoctor>, rule: string): string | null {
  return report.findings.find((f) => f.rule === rule)?.level ?? null;
}

describe('db doctor', () => {
  it('干净库全 PASS', () => {
    const db = mem();
    seedClean(db);
    const report = runDoctor(db);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.findings.length).toBeGreaterThan(10);
  });

  it('documents 孤儿 + lesson 孤儿命中 FAIL', () => {
    const db = mem();
    seedClean(db);
    db.exec(`INSERT INTO textbook_vocab VALUES ('ghost','l9',0,'幽','ゆう',NULL,NULL,NULL,NULL,NULL)`);
    db.exec(`INSERT INTO textbook_lines VALUES ('d1','nope',0,NULL,'x',NULL)`);
    const report = runDoctor(db);
    expect(levelOf(report, 'documents-orphan:textbook_vocab')).toBe('FAIL');
    expect(levelOf(report, 'lesson-orphan:textbook_lines')).toBe('FAIL');
  });

  it('重复 ord 命中 FAIL', () => {
    const db = mem();
    // 无 PK 影子表模拟脏数据（PK 会挡住重复，脏数据只可能来自 PK 缺失的老库/手写）
    db.exec(`CREATE TABLE textbook_vocab (document_id TEXT, lesson_id TEXT, ord INTEGER, surface TEXT)`);
    db.exec(`INSERT INTO textbook_vocab VALUES ('d1','l1',0,'a'),('d1','l1',0,'b')`);
    const report = runDoctor(db);
    expect(levelOf(report, 'ord-dup:textbook_vocab')).toBe('FAIL');
  });

  it('term_map 悬空 entry + FTS 缺失命中', () => {
    const db = mem();
    seedClean(db);
    db.exec(`UPDATE textbook_term_map SET entry_id='ghost-entry'`);
    db.exec(`DELETE FROM textbook_fts WHERE kind='vocab'`);
    const report = runDoctor(db);
    expect(levelOf(report, 'term-map:entry')).toBe('FAIL');
    expect(levelOf(report, 'fts:vocab-missing')).toBe('WARN');
  });

  it('FTS stale 命中 WARN', () => {
    const db = mem();
    seedClean(db);
    db.exec(`INSERT INTO textbook_fts VALUES ('x',NULL,NULL,NULL,NULL,'d1','l1','vocab','l1#v99')`);
    const report = runDoctor(db);
    expect(levelOf(report, 'fts:stale')).toBe('WARN');
  });

  it('done 任务悬空记 WARN（审计保留，不删）', () => {
    const db = mem();
    seedClean(db);
    db.exec(`INSERT INTO document_imports VALUES ('i1','u1','pdf','a.pdf','done','ghost-doc',1,NULL,'t','t')`);
    db.exec(`INSERT INTO documents VALUES ('d2','u1','空书','user_import','ja','c','{"lessons":[]}','t','t')`);
    db.exec(`INSERT INTO documents VALUES ('d3','u1','新闻','news','ja','c','{"questions":[]}','t','t')`);
    const report = runDoctor(db);
    expect(levelOf(report, 'import:done-doc')).toBe('WARN');
    // d2 教材形 0 课命中；d3 新闻形不算
    expect(levelOf(report, 'import:empty-lessons')).toBe('WARN');
    const f = report.findings.find((x) => x.rule === 'import:empty-lessons');
    expect(f?.count).toBe(1);
  });

  it('坏 locator 命中 WARN', () => {
    const db = mem();
    seedClean(db);
    db.exec(`INSERT INTO reading_positions VALUES ('u1','d1','not-json','t')`);
    const report = runDoctor(db);
    expect(levelOf(report, 'position:locator-json')).toBe('WARN');
  });

  it('缺表跳过不炸', () => {
    const db = mem();
    db.exec(`CREATE TABLE documents (id TEXT PRIMARY KEY)`);
    const report = runDoctor(db);
    // 子表全缺席 → schema-coverage 报 WARN，但不能抛
    expect(report.findings.some((f) => f.rule.startsWith('schema-coverage:'))).toBe(true);
    expect(report.errors).toEqual([]);
    expect(() => runDoctor(db)).not.toThrow();
  });

  it('ord 非整数亲和命中 FAIL', () => {
    const db = mem();
    db.exec(`CREATE TABLE textbook_vocab (document_id TEXT, lesson_id TEXT, ord INTEGER, surface TEXT)`);
    db.exec(`INSERT INTO textbook_vocab VALUES ('d1','l1','abc','x')`);
    const report = runDoctor(db);
    expect(levelOf(report, 'ord-affinity:textbook_vocab')).toBe('FAIL');
  });

  it('FTS 重复映射 + 悬空索引命中', () => {
    const db = mem();
    seedClean(db);
    db.exec(`INSERT INTO textbook_fts VALUES ('食べる','たべる','吃',NULL,NULL,'d1','l1','vocab','l1#v0')`);
    db.exec(`INSERT INTO textbook_fts VALUES (NULL,NULL,NULL,'xx',NULL,'ghost','l1','line','l1#d0')`);
    const report = runDoctor(db);
    expect(levelOf(report, 'fts:dup-ref')).toBe('FAIL');
    expect(levelOf(report, 'documents-orphan:textbook_fts')).toBe('FAIL');
  });

  it('term_occurrences docRef 永不误报（非 FK 列）', () => {
    const db = mem();
    db.exec(`CREATE TABLE documents (id TEXT PRIMARY KEY)`);
    db.exec(`INSERT INTO documents VALUES ('d1')`);
    db.exec(`CREATE TABLE term_occurrences (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, language TEXT NOT NULL, term_key TEXT NOT NULL, source TEXT NOT NULL, document_id TEXT, quote TEXT, created_at TEXT NOT NULL)`);
    db.exec(`INSERT INTO term_occurrences VALUES ('o1','u1','ja','k','reading','d1/lesson3','q','t')`);
    db.exec(`INSERT INTO term_occurrences VALUES ('o2','u1','ja','k','reading','deleted-doc/lesson1','q','t')`);
    const report = runDoctor(db);
    // 即使指向已删文档，也不许出现任何关于 term_occurrences 的 finding
    expect(report.findings.some((f) => f.rule.includes('term_occurrences'))).toBe(false);
    expect(report.errors).toEqual([]);
  });

  it('starter source 映射回归：后缀对上 PASS，不对 FAIL', () => {
    const db = mem();
    db.exec(`CREATE TABLE dictionary_sources (id TEXT PRIMARY KEY)`);
    db.exec(`CREATE TABLE local_dictionary_entries (id TEXT PRIMARY KEY, language TEXT NOT NULL, headword TEXT NOT NULL, source_id TEXT)`);
    db.exec(`INSERT INTO dictionary_sources VALUES ('study-studio-starter-v1-ja'),('study-studio-starter-v1-ko'),('study-studio-starter-v1-en'),('study-studio-n5-ja-v1-ja')`);
    db.exec(`INSERT INTO local_dictionary_entries VALUES ('a','ja','x','study-studio-starter-v1-ja'),('b','ko','y','study-studio-starter-v1-ko'),('c','en','z','study-studio-starter-v1-en'),('d','ja','w','study-studio-n5-ja-v1-ja')`);
    const okReport = runDoctor(db);
    expect(levelOf(okReport, 'dict:entry-source')).toBe('PASS');
    // 旧种子写法（未后缀）必须 FAIL——这就是线上 172 条的形状
    db.exec(`INSERT INTO local_dictionary_entries VALUES ('e','ja','v','study-studio-starter-v1')`);
    const badReport = runDoctor(db);
    expect(levelOf(badReport, 'dict:entry-source')).toBe('FAIL');
  });
});
