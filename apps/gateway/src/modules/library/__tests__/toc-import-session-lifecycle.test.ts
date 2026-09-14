import { describe, expect, it, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { isOk } from '@study-studio/shared';
import { runDoctor } from '@study-studio/storage-sqlite';
import { initSchema, runMigrations } from '@study-studio/storage-sqlite';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';

/**
 * CMD-LINGUA-P5D2A.1 session ownership 与删除生命周期。
 * 全程只用 repo + 原生 SQL + doctor：零 converter/OCR/Agent/AST/shred 写入
 *（documents 行均为手插最小行，无 ast_json，无 shred）。
 */

const repos: DrizzleLearnerRepository[] = [];
const dbs: Database[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) r.getRawDb().close();
  for (const d of dbs.splice(0)) d.close();
});

function repo(): DrizzleLearnerRepository {
  const r = new DrizzleLearnerRepository(':memory:');
  repos.push(r);
  return r;
}

async function prepareSession(
  r: DrizzleLearnerRepository,
  key = 'k1'
): Promise<string> {
  const res = await r.prepareTocImportSession({
    userId: 'u1',
    requestKey: key,
    planFingerprint: 'fp1',
    pdfSha256: 'pdf1',
    pageCount: 100,
    lessons: [{ lessonIndex: 0, title: '第1課' }],
    chunks: [
      { ordinal: 0, lessonIndex: 0, lessonTitle: '第1課', physicalStart: 17, physicalEnd: 34, chunkFingerprint: 'cfp0' },
    ],
    docTitle: '试书',
  });
  if (!isOk(res)) throw new Error(`prepare failed: ${res.error.code}`);
  return res.value.session.id;
}

function insertDoc(r: DrizzleLearnerRepository, id: string, userId: string): void {
  r.getRawDb().run(
    `INSERT INTO documents (id, user_id, title, source_kind, language, content, created_at, updated_at) VALUES ('${id}','${userId}','t','user_import','ja','c','t','t')`
  );
}

function sessionStatus(r: DrizzleLearnerRepository, id: string): { status: string; documentId: string | null } {
  const row = r.getRawDb().query('SELECT status AS s, document_id AS d FROM toc_import_sessions WHERE id = ?').get(id) as {
    s: string;
    d: string | null;
  };
  return { status: row.s, documentId: row.d };
}

function tocFailCount(r: DrizzleLearnerRepository): number {
  return runDoctor(r.getRawDb()).findings.filter((f) => f.rule.startsWith('toc-import:') && f.level === 'FAIL').length;
}

describe('P5D2A.1 ownership 与删除生命周期', () => {
  it('首次 prepared session：document_id 为 null', async () => {
    const r = repo();
    const id = await prepareSession(r);
    expect(sessionStatus(r, id)).toEqual({ status: 'prepared', documentId: null });
  });

  it('绑定一次成功；同 session 不得绑定第二个 document', async () => {
    const r = repo();
    const id = await prepareSession(r);
    insertDoc(r, 'd1', 'u1');
    insertDoc(r, 'd2', 'u1');
    const bound = await r.bindTocImportSessionDocument({ sessionId: id, userId: 'u1', documentId: 'd1' });
    expect(isOk(bound)).toBe(true);
    if (!isOk(bound)) return;
    expect(bound.value.documentId).toBe('d1');
    const again = await r.bindTocImportSessionDocument({ sessionId: id, userId: 'u1', documentId: 'd2' });
    expect(isOk(again)).toBe(false);
    if (isOk(again)) return;
    expect(again.error.code).toBe('E_INVALID_INPUT');
    expect(sessionStatus(r, id).documentId).toBe('d1');
  });

  it('绑定越权/缺失：他人会话、他人文档、 ghosts 全拒绝且不变', async () => {
    const r = repo();
    const id = await prepareSession(r);
    insertDoc(r, 'd1', 'u1');
    insertDoc(r, 'dx', 'u2');
    for (const input of [
      { sessionId: id, userId: 'u2', documentId: 'd1' },
      { sessionId: id, userId: 'u1', documentId: 'dx' },
      { sessionId: id, userId: 'u1', documentId: 'ghost' },
      { sessionId: 'ghost', userId: 'u1', documentId: 'd1' },
    ]) {
      const res = await r.bindTocImportSessionDocument(input);
      expect(isOk(res)).toBe(false);
      if (isOk(res)) continue;
      expect(['E_NOT_FOUND', 'E_INVALID_INPUT'].includes(res.error.code)).toBe(true);
    }
    expect(sessionStatus(r, id)).toEqual({ status: 'prepared', documentId: null });
  });

  it('删除关联 document：session 进不可恢复终态、审计保留、doctor 绿', async () => {
    const r = repo();
    const id = await prepareSession(r);
    insertDoc(r, 'd1', 'u1');
    const bound = await r.bindTocImportSessionDocument({ sessionId: id, userId: 'u1', documentId: 'd1' });
    expect(isOk(bound)).toBe(true);
    const deleted = await r.deleteDocument('d1', 'u1');
    expect(isOk(deleted)).toBe(true);
    // 终态 + 快照保留 + 计划行不删
    expect(sessionStatus(r, id)).toEqual({ status: 'target_deleted', documentId: 'd1' });
    const chunks = await r.getTocImportSession('u1', 'k1');
    expect(chunks?.chunks.length).toBe(1);
    expect(chunks?.session.status).toBe('target_deleted');
    expect(tocFailCount(r)).toBe(0);
    // 终态不可再绑定
    insertDoc(r, 'd9', 'u1');
    const rebind = await r.bindTocImportSessionDocument({ sessionId: id, userId: 'u1', documentId: 'd9' });
    expect(isOk(rebind)).toBe(false);
  });

  it('删除不相关 document：session 不变', async () => {
    const r = repo();
    const id = await prepareSession(r);
    insertDoc(r, 'd1', 'u1');
    await r.bindTocImportSessionDocument({ sessionId: id, userId: 'u1', documentId: 'd1' });
    insertDoc(r, 'other', 'u1');
    const deleted = await r.deleteDocument('other', 'u1');
    expect(isOk(deleted)).toBe(true);
    expect(sessionStatus(r, id)).toEqual({ status: 'prepared', documentId: 'd1' });
    expect(tocFailCount(r)).toBe(0);
  });

  it('deleteDocument 回滚与权限隔离保持：失败即 session 不变', async () => {
    const r = repo();
    const id = await prepareSession(r);
    insertDoc(r, 'd1', 'u1');
    await r.bindTocImportSessionDocument({ sessionId: id, userId: 'u1', documentId: 'd1' });
    // 他人删：E_NOT_FOUND，session 不动
    const foreign = await r.deleteDocument('d1', 'u2');
    expect(isOk(foreign)).toBe(false);
    // 不存在：E_NOT_FOUND，session 不动
    const ghost = await r.deleteDocument('ghost', 'u1');
    expect(isOk(ghost)).toBe(false);
    expect(sessionStatus(r, id)).toEqual({ status: 'prepared', documentId: 'd1' });
    expect(tocFailCount(r)).toBe(0);
  });

  it('人工构造 chunk.document_id 非空：doctor FAIL（已废弃恒 NULL）', async () => {
    const r = repo();
    await prepareSession(r);
    r.getRawDb().run(`UPDATE toc_import_chunks SET document_id = 'd1' WHERE session_id LIKE 'tocimport_%'`);
    const report = runDoctor(r.getRawDb());
    expect(report.findings.find((f) => f.rule === 'toc-import:chunk-doc')?.level).toBe('FAIL');
  });

  it('active session 缺 document：FAIL；target_deleted 豁免不误报', async () => {
    const r = repo();
    const id = await prepareSession(r);
    // 手工绑定 ghost（绕过归属校验，模拟脏数据）
    r.getRawDb().run(`UPDATE toc_import_sessions SET document_id = 'ghost' WHERE id = '${id}'`);
    const bad = runDoctor(r.getRawDb());
    expect(bad.findings.find((f) => f.rule === 'toc-import:active-doc')?.level).toBe('FAIL');
    // 进终态后同一快照不再误报
    r.getRawDb().run(`UPDATE toc_import_sessions SET status = 'target_deleted' WHERE id = '${id}'`);
    const clean = runDoctor(r.getRawDb());
    expect(clean.findings.find((f) => f.rule === 'toc-import:active-doc')?.level).toBe('PASS');
    expect(clean.findings.filter((f) => f.rule.startsWith('toc-import:') && f.level === 'FAIL')).toEqual([]);
  });

  it('全程零 AST/shred 写入', async () => {
    const r = repo();
    const id = await prepareSession(r);
    insertDoc(r, 'd1', 'u1');
    await r.bindTocImportSessionDocument({ sessionId: id, userId: 'u1', documentId: 'd1' });
    await r.deleteDocument('d1', 'u1');
    const db = r.getRawDb();
    for (const table of ['textbook_lessons', 'textbook_lines', 'textbook_vocab', 'textbook_grammar', 'textbook_exercises']) {
      const row = db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
      expect(row.n).toBe(0);
    }
    const fts = db.query('SELECT COUNT(*) AS n FROM textbook_fts').get() as { n: number };
    expect(fts.n).toBe(0);
  });
});

describe('P5D2A.1 migration v20', () => {
  it('新库一次建成含 document_id + v20 登记；旧库升级重放', () => {
    const db = new Database(':memory:');
    dbs.push(db);
    initSchema(db);
    const cols = (db.query('PRAGMA table_info(toc_import_sessions)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain('document_id');
    const recorded = db.query('SELECT name AS n FROM schema_migrations WHERE version = 20').get() as { n: string } | null;
    expect(recorded?.n).toBe('toc-import-session-document');
    // 模拟旧库：删索引删列 + 删登记 → 重跑升级（SQLite DROP COLUMN 前向加回）
    db.run('DROP INDEX idx_toc_import_sessions_document');
    db.run('ALTER TABLE toc_import_sessions DROP COLUMN document_id');
    db.run('DELETE FROM schema_migrations WHERE version = 20');
    const res = runMigrations(db);
    expect(res.applied).toContain(20);
    const colsAfter = (db.query('PRAGMA table_info(toc_import_sessions)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(colsAfter).toContain('document_id');
    expect(runMigrations(db).applied).toEqual([]);
  });
});
