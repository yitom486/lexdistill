import { describe, expect, it, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { isOk } from '@study-studio/shared';
import { parseTextbookAST } from '@study-studio/document-model';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { shredSeedTextbooks } from '../bootstrap/create-gateway.js';
import { TEXTBOOK_BOOKS } from '../infrastructure/db/seeds/textbook-seed.js';
import {
  computeSeedMaterializationFingerprint,
  shouldSkipSeedMaterialization,
  isTextbookProjectionHealthy,
  SEED_MATERIALIZER_VERSION,
} from '../modules/library/persistence/seed-materialization.js';
import { runMigrations } from '../infrastructure/db/ddl.js';

/**
 * P1-D1 seed gating 矩阵（全临时 :memory: 库，真库零接触）。
 * data_version 断言“零写”（SQLite 每次 commit 递增；回滚不递增）。
 */
const repos: DrizzleLearnerRepository[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) r.getRawDb().close();
});

function freshRepo(): DrizzleLearnerRepository {
  const repo = new DrizzleLearnerRepository(':memory:');
  repos.push(repo);
  return repo;
}

function dataVersion(repo: DrizzleLearnerRepository): number {
  return (repo.getRawDb().query('PRAGMA data_version').get() as { data_version: number }).data_version;
}

function derivedChecksum(repo: DrizzleLearnerRepository): string {
  const db = repo.getRawDb();
  const parts: string[] = [];
  for (const t of ['textbook_lessons', 'textbook_vocab', 'textbook_grammar', 'textbook_lines', 'textbook_exercises', 'textbook_term_map', 'textbook_fts', 'seed_materialization']) {
    try {
      const rows = db.query(`SELECT * FROM ${t} ORDER BY rowid`).all() as unknown[];
      parts.push(`${t}:${rows.length}:${JSON.stringify(rows).length}`);
    } catch {
      parts.push(`${t}:missing`);
    }
  }
  return parts.join('|');
}

function firstBook(): { id: string; book: ReturnType<typeof parseBook> } {
  return { id: 'biaori-primary-1', book: parseBook('biaori-primary-1') };
}

function parseBook(id: string): Exclude<ReturnType<typeof tryParse>, null> {
  const raw = TEXTBOOK_BOOKS.find((b) => (b as { id?: unknown }).id === id);
  if (!raw) throw new Error(`seed 缺失: ${id}`);
  return tryParse(raw);
}

function tryParse(raw: unknown): import('@study-studio/document-model').TextbookAST {
  const p = parseTextbookAST(JSON.parse(JSON.stringify(raw)));
  if (!p.ok) throw new Error(`种子 AST 非法: ${p.error.code}`);
  return p.value;
}

describe('P1-D1 seed gating', () => {
  it('1. first startup → materialize（3 本全建，state 落库）', async () => {
    const repo = freshRepo();
    const res = await shredSeedTextbooks(repo);
    expect(res.shredded).toBe(3);
    expect(res.skipped).toBe(0);
    const db = repo.getRawDb();
    for (const id of ['biaori-primary-1', 'minna-nihongo-1', 'nce-primary-1']) {
      const n = (db.query('SELECT COUNT(*) AS n FROM textbook_lessons WHERE document_id = ?').get(id) as { n: number }).n;
      expect(n).toBeGreaterThan(0);
      const st = db.query('SELECT fingerprint AS fp FROM seed_materialization WHERE document_id = ?').get(id) as { fp: string } | null;
      expect(st?.fp).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('2. second unchanged startup → seed materialization 零写', async () => {
    const repo = freshRepo();
    await shredSeedTextbooks(repo);
    const v0 = dataVersion(repo);
    const sum0 = derivedChecksum(repo);
    const res = await shredSeedTextbooks(repo);
    expect(res.skippedClean).toBe(3);
    expect(res.shredded).toBe(0);
    expect(dataVersion(repo)).toBe(v0);
    expect(derivedChecksum(repo)).toBe(sum0);
  });

  it('3. AST content change → rebuild（derived 同步新内容）', async () => {
    const repo = freshRepo();
    await shredSeedTextbooks(repo);
    const { id, book } = firstBook();
    const changed = structuredClone(book);
    changed.lessons[0]!.title = `${changed.lessons[0]!.title}·改`;
    const db = repo.getRawDb();
    const fp = computeSeedMaterializationFingerprint(db, changed);
    const dec = shouldSkipSeedMaterialization(db, id, changed);
    expect(dec.skip).toBe(false);
    const r = await repo.materializeSeedDocument(
      { id, userId: 'default_user', title: changed.title, sourceKind: 'curriculum_textbook', language: 'ja', content: changed.title },
      changed, fp, SEED_MATERIALIZER_VERSION
    );
    expect(isOk(r)).toBe(true);
    const row = db.query('SELECT title AS t FROM textbook_lessons WHERE document_id = ? ORDER BY sort_order LIMIT 1').get(id) as { t: string };
    expect(row.t).toContain('·改');
  });

  it('4. key order change → fingerprint 不变', () => {
    const repo = freshRepo();
    const { book } = firstBook();
    const db = repo.getRawDb();
    // 递归键逆序（JSON.stringify replacer 数组是 allowlist，不能用来测排序，手动洗）
    const shuffleKeys = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(shuffleKeys);
      if (v && typeof v === 'object') {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(v as Record<string, unknown>).reverse()) {
          out[k] = shuffleKeys((v as Record<string, unknown>)[k]);
        }
        return out;
      }
      return v;
    };
    const reordered = shuffleKeys(book) as typeof book;
    expect(computeSeedMaterializationFingerprint(db, book)).toBe(computeSeedMaterializationFingerprint(db, reordered));
  });

  it('5. array order change → fingerprint 变化', () => {
    const repo = freshRepo();
    const { book } = firstBook();
    const db = repo.getRawDb();
    const swapped = structuredClone(book);
    if (swapped.lessons.length < 2) throw new Error('种子课数不足以测重排');
    const tmp = swapped.lessons[0]!;
    swapped.lessons[0] = swapped.lessons[1]!;
    swapped.lessons[1] = tmp;
    expect(computeSeedMaterializationFingerprint(db, book)).not.toBe(computeSeedMaterializationFingerprint(db, swapped));
  });

  it('6. stable seed lesson id change → fingerprint 变化', () => {
    const repo = freshRepo();
    const { book } = firstBook();
    const db = repo.getRawDb();
    const renamed = structuredClone(book);
    renamed.lessons[0]!.id = `${renamed.lessons[0]!.id}-x`;
    expect(computeSeedMaterializationFingerprint(db, book)).not.toBe(computeSeedMaterializationFingerprint(db, renamed));
  });

  it('7. projection 缺行 → rebuild（fp 一致也重建）', async () => {
    const repo = freshRepo();
    await shredSeedTextbooks(repo);
    const { id, book } = firstBook();
    const db = repo.getRawDb();
    db.run(`DELETE FROM textbook_vocab WHERE document_id = '${id}' AND lesson_id = 'biaori-l1'`);
    const dec = shouldSkipSeedMaterialization(db, id, book);
    expect(dec.skip).toBe(false);
    expect(dec.reason).toMatch(/projection/);
    const res = await shredSeedTextbooks(repo);
    expect(res.shredded).toBe(1);
    expect(isTextbookProjectionHealthy(db, id, book).healthy).toBe(true);
  });

  it('8. sort_order 损坏 → rebuild', async () => {
    const repo = freshRepo();
    await shredSeedTextbooks(repo);
    const { id, book } = firstBook();
    const db = repo.getRawDb();
    db.run(`UPDATE textbook_lessons SET sort_order = 99 WHERE document_id = '${id}' AND lesson_id = 'biaori-l1'`);
    expect(shouldSkipSeedMaterialization(db, id, book).skip).toBe(false);
    await shredSeedTextbooks(repo);
    expect(isTextbookProjectionHealthy(db, id, book).healthy).toBe(true);
  });

  it('9. FTS 缺失 → rebuild', async () => {
    const repo = freshRepo();
    await shredSeedTextbooks(repo);
    const { id, book } = firstBook();
    const db = repo.getRawDb();
    db.run(`DELETE FROM textbook_fts WHERE document_id = '${id}'`);
    expect(shouldSkipSeedMaterialization(db, id, book).skip).toBe(false);
    await shredSeedTextbooks(repo);
    expect(isTextbookProjectionHealthy(db, id, book).healthy).toBe(true);
  });

  it('10. materializer version bump → rebuild 一次，下次再 skip', async () => {
    const repo = freshRepo();
    await shredSeedTextbooks(repo);
    const { id, book } = firstBook();
    const db = repo.getRawDb();
    expect(shouldSkipSeedMaterialization(db, id, book, SEED_MATERIALIZER_VERSION + 1).skip).toBe(false);
    const fp = computeSeedMaterializationFingerprint(db, book, SEED_MATERIALIZER_VERSION + 1);
    expect(isOk(await repo.materializeSeedDocument(
      { id, userId: 'default_user', title: book.title, sourceKind: 'curriculum_textbook', language: 'ja', content: book.title },
      book, fp, SEED_MATERIALIZER_VERSION + 1
    ))).toBe(true);
    expect(shouldSkipSeedMaterialization(db, id, book, SEED_MATERIALIZER_VERSION + 1).skip).toBe(true);
  });

  it('11. shred 失败 → AST/projection/state 全 rollback', async () => {
    const repo = freshRepo();
    await shredSeedTextbooks(repo);
    const { id, book } = firstBook();
    const db = repo.getRawDb();
    const astBefore = (db.query('SELECT ast_json AS a FROM documents WHERE id = ?').get(id) as { a: string }).a;
    // DROP 是测试 sabotage 本身（DDL 不在回滚范围）；基线取 sabotage 之后，
    // 断言 materialize 尝试零额外写入
    db.run('DROP TABLE textbook_lines');
    const sumBefore = derivedChecksum(repo);
    const changed = structuredClone(book);
    changed.lessons[0]!.title = `${changed.lessons[0]!.title}·改`;
    const fp = computeSeedMaterializationFingerprint(db, changed);
    const res = await repo.materializeSeedDocument(
      { id, userId: 'default_user', title: changed.title, sourceKind: 'curriculum_textbook', language: 'ja', content: changed.title },
      changed, fp, SEED_MATERIALIZER_VERSION
    );
    expect(isOk(res)).toBe(false);
    expect((db.query('SELECT ast_json AS a FROM documents WHERE id = ?').get(id) as { a: string }).a).toBe(astBefore);
    const st = db.query('SELECT fingerprint AS fp FROM seed_materialization WHERE document_id = ?').get(id) as { fp: string };
    expect(st.fp).toBe(computeSeedMaterializationFingerprint(db, book));
    expect(derivedChecksum(repo)).toBe(sumBefore);
  });

  it('12. rebuild 成功后下次 skip', async () => {
    const repo = freshRepo();
    await shredSeedTextbooks(repo);
    const { id, book } = firstBook();
    const db = repo.getRawDb();
    db.run(`DELETE FROM textbook_fts WHERE document_id = '${id}'`);
    const r1 = await shredSeedTextbooks(repo);
    expect(r1.shredded).toBe(1);
    const v0 = dataVersion(repo);
    const r2 = await shredSeedTextbooks(repo);
    expect(r2.skippedClean).toBe(3);
    expect(dataVersion(repo)).toBe(v0);
  });

  it('13. 三本独立判断：一本变化不重写另外两本', async () => {
    const repo = freshRepo();
    await shredSeedTextbooks(repo);
    const db = repo.getRawDb();
    const others = ['minna-nihongo-1', 'nce-primary-1'].map((x) =>
      (db.query('SELECT updated_at AS u FROM seed_materialization WHERE document_id = ?').get(x) as { u: string }).u
    );
    db.run(`DELETE FROM textbook_fts WHERE document_id = 'biaori-primary-1'`);
    const res = await shredSeedTextbooks(repo);
    expect(res.shredded).toBe(1);
    const othersAfter = ['minna-nihongo-1', 'nce-primary-1'].map((x) =>
      (db.query('SELECT updated_at AS u FROM seed_materialization WHERE document_id = ?').get(x) as { u: string }).u
    );
    expect(othersAfter).toEqual(others);
  });

  it('14. dictionary dependency 变化 → rebuild', async () => {
    const repo = freshRepo();
    await shredSeedTextbooks(repo);
    const { id, book } = firstBook();
    const db = repo.getRawDb();
    // 找一个当前未命中的种子词面，插入对应词条 → mapping 切片变化
    const surfaces: string[] = [];
    for (const l of book.lessons) for (const v of l.vocabularies) surfaces.push(v.kanji.trim());
    let target: string | null = null;
    for (const s of surfaces) {
      const hit = db.query('SELECT COUNT(*) AS n FROM local_dictionary_entries WHERE language = ? AND headword = ?').get('ja', s) as { n: number };
      if (hit.n === 0) { target = s; break; }
    }
    expect(target).not.toBeNull();
    db.run(
      `INSERT INTO local_dictionary_entries (id, language, headword, meanings_json, source_label, license_note, created_at) VALUES ('test-seed-dep-1', 'ja', '${(target as string).replace(/'/g, "''")}', '[]', 't', 'l', 't')`
    );
    try {
      const dec = shouldSkipSeedMaterialization(db, id, book);
      expect(dec.skip).toBe(false);
      const res = await shredSeedTextbooks(repo);
      expect(res.shredded).toBe(1);
    } finally {
      db.run(`DELETE FROM local_dictionary_entries WHERE id = 'test-seed-dep-1'`);
    }
  });

  it('v18 migration：新库即有 state 表；模拟旧库（删表+抹登记）可升级重建（仅临时库）', async () => {
    const { initSchema, runMigrations } = await import('../infrastructure/db/ddl.js');
    const raw = new Database(':memory:');
    try {
      initSchema(raw);
      const cols = (raw.query('PRAGMA table_info(seed_materialization)').all() as Array<{ name: string }>).map((c) => c.name);
      expect(cols).toEqual(['document_id', 'fingerprint', 'materializer_version', 'updated_at']);
      // 模拟 v17 时代旧库
      raw.run('DROP TABLE seed_materialization');
      raw.run('DELETE FROM schema_migrations WHERE version = 18');
      const res = runMigrations(raw);
      expect(res.applied).toContain(18);
      const cols2 = (raw.query('PRAGMA table_info(seed_materialization)').all() as Array<{ name: string }>).map((c) => c.name);
      expect(cols2).toEqual(['document_id', 'fingerprint', 'materializer_version', 'updated_at']);
      expect(runMigrations(raw).applied).not.toContain(18);
    } finally {
      raw.close();
    }
  });
});
