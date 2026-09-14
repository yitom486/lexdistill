import { describe, expect, it, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runDoctor } from '@study-studio/storage-sqlite';
import { sha256HexText } from '../modules/library/persistence/toc-import-sessions.js';

/**
 * CMD-LINGUA-P5D2A doctor 规则：toc_import_sessions / toc_import_chunks。
 * 内存库手造脏数据，断言五条规则；表缺席即跳过（部分库不炸）。
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

function createTables(db: Database): void {
  db.run(`
    CREATE TABLE toc_import_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      request_key TEXT NOT NULL,
      plan_fingerprint TEXT NOT NULL,
      pdf_sha256 TEXT NOT NULL,
      page_count INTEGER NOT NULL,
      lesson_count INTEGER NOT NULL,
      chunk_count INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'prepared',
      doc_title TEXT NOT NULL DEFAULT '',
      document_id TEXT,
      ast_fingerprint TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_toc_import_sessions_user_key ON toc_import_sessions(user_id, request_key);
    CREATE TABLE toc_import_chunks (
      session_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      lesson_index INTEGER NOT NULL,
      lesson_title TEXT NOT NULL DEFAULT '',
      physical_start INTEGER NOT NULL,
      physical_end INTEGER NOT NULL,
      chunk_fingerprint TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'prepared',
      document_id TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (session_id, ordinal)
    );
    CREATE INDEX idx_toc_import_chunks_session ON toc_import_chunks(session_id, ordinal);
  `);
}

function seedClean(db: Database): void {
  createTables(db);
  db.run(`CREATE TABLE documents (id TEXT PRIMARY KEY, ast_json TEXT)`);
  db.run(
    `INSERT INTO toc_import_sessions (id, user_id, request_key, plan_fingerprint, pdf_sha256, page_count, lesson_count, chunk_count, status, created_at, updated_at) VALUES ('s1','u1','k1','fp','pdf',100,2,2,'prepared','t','t')`
  );
  db.run(
    `INSERT INTO toc_import_chunks (session_id, ordinal, lesson_index, lesson_title, physical_start, physical_end, chunk_fingerprint, status, updated_at) VALUES ('s1',0,0,'第1課',17,34,'cfp0','prepared','t'),('s1',1,1,'第2課',35,35,'cfp1','prepared','t')`
  );
}

function levelOf(report: ReturnType<typeof runDoctor>, rule: string): string | null {
  return report.findings.find((f) => f.rule === rule)?.level ?? null;
}

describe('db doctor toc-import', () => {
  it('干净 session 全 PASS', () => {
    const db = mem();
    seedClean(db);
    const report = runDoctor(db);
    for (const rule of [
      'toc-import:chunk-orphan',
      'toc-import:chunk-range',
      'toc-import:ordinal-dup',
      'toc-import:session-count',
      'toc-import:status',
    ]) {
      expect(levelOf(report, rule)).toBe('PASS');
    }
    expect(report.errors).toEqual([]);
  });

  it('chunk 悬空命中 FAIL', () => {
    const db = mem();
    seedClean(db);
    db.run(
      `INSERT INTO toc_import_chunks (session_id, ordinal, lesson_index, physical_start, physical_end, chunk_fingerprint, updated_at) VALUES ('ghost',0,0,1,2,'cfp','t')`
    );
    const report = runDoctor(db);
    expect(levelOf(report, 'toc-import:chunk-orphan')).toBe('FAIL');
  });

  it('非法 range 命中 FAIL（起止非法/超 30 页）', () => {
    const db = mem();
    seedClean(db);
    db.run(
      `INSERT INTO toc_import_chunks (session_id, ordinal, lesson_index, physical_start, physical_end, chunk_fingerprint, updated_at) VALUES ('s1',2,2,0,5,'cfp','t'),('s1',3,3,10,5,'cfp','t'),('s1',4,4,1,31,'cfp','t')`
    );
    const report = runDoctor(db);
    expect(levelOf(report, 'toc-import:chunk-range')).toBe('FAIL');
    expect(report.findings.find((f) => f.rule === 'toc-import:chunk-range')?.count).toBe(3);
  });

  it('ordinal 重复命中 FAIL（无 PK 影子表模拟脏数据）', () => {
    const db = mem();
    db.run(`CREATE TABLE toc_import_sessions (id TEXT PRIMARY KEY, chunk_count INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'prepared', document_id TEXT)`);
    db.run(`CREATE TABLE toc_import_chunks (session_id TEXT, ordinal INTEGER, physical_start INTEGER, physical_end INTEGER, status TEXT, document_id TEXT)`);
    db.run(`INSERT INTO toc_import_sessions VALUES ('s1',2,'prepared',NULL)`);
    db.run(`INSERT INTO toc_import_chunks VALUES ('s1',0,1,2,'prepared',NULL),('s1',0,1,2,'prepared',NULL)`);
    const report = runDoctor(db);
    expect(levelOf(report, 'toc-import:ordinal-dup')).toBe('FAIL');
  });

  it('session 计数不一致命中 FAIL', () => {
    const db = mem();
    seedClean(db);
    db.run(`UPDATE toc_import_sessions SET chunk_count = 5 WHERE id = 's1'`);
    const report = runDoctor(db);
    expect(levelOf(report, 'toc-import:session-count')).toBe('FAIL');
  });

  it('非法状态命中 FAIL', () => {
    const db = mem();
    seedClean(db);
    db.run(`UPDATE toc_import_sessions SET status = 'weird' WHERE id = 's1'`);
    db.run(`UPDATE toc_import_chunks SET status = 'bogus' WHERE session_id = 's1' AND ordinal = 0`);
    const report = runDoctor(db);
    expect(levelOf(report, 'toc-import:status')).toBe('FAIL');
    expect(report.findings.find((f) => f.rule === 'toc-import:status')?.count).toBe(2);
  });

  it('缺表跳过不炸', () => {
    const db = mem();
    db.run(`CREATE TABLE documents (id TEXT PRIMARY KEY)`);
    const report = runDoctor(db);
    expect(report.findings.some((f) => f.rule.startsWith('toc-import:'))).toBe(false);
    expect(() => runDoctor(db)).not.toThrow();
  });

  it('running 缺 AST 指纹命中 FAIL', () => {
    const db = mem();
    seedClean(db);
    db.run(`UPDATE toc_import_sessions SET status = 'running', document_id = 'd9' WHERE id = 's1'`);
    const report = runDoctor(db);
    expect(levelOf(report, 'toc-import:session-ast-fp')).toBe('FAIL');
  });

  it('completed 顺序 gap 命中 FAIL', () => {
    const db = mem();
    seedClean(db);
    db.run(`UPDATE toc_import_chunks SET status = 'completed' WHERE session_id = 's1' AND ordinal = 1`);
    const report = runDoctor(db);
    expect(levelOf(report, 'toc-import:chunk-gap')).toBe('FAIL');
  });

  it('指纹与文档 AST 不一致命中 FAIL；一致 PASS', () => {
    const db = mem();
    seedClean(db);
    db.run(`INSERT INTO documents VALUES ('d1','{"lessons":[]}')`);
    db.run(`UPDATE toc_import_sessions SET document_id = 'd1', ast_fingerprint = 'mismatch' WHERE id = 's1'`);
    const bad = runDoctor(db);
    expect(levelOf(bad, 'toc-import:ast-drift')).toBe('FAIL');
    // doctor 与持久化指纹同口径（任一改编码即此处变红）
    db.run(`UPDATE toc_import_sessions SET ast_fingerprint = '${sha256HexText('{"lessons":[]}')}' WHERE id = 's1'`);
    const good = runDoctor(db);
    expect(levelOf(good, 'toc-import:ast-drift')).toBe('PASS');
  });
});
