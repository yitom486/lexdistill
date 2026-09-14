import { describe, expect, it, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { shredSeedTextbooks } from '../bootstrap/create-gateway.js';
import { runDoctor } from '@study-studio/storage-sqlite';
import { isOk } from '@study-studio/shared';

/**
 * P0.5 种子完整性：新鲜库的 source 映射必须自洽，种子教材必须被 shred。
 * - starter/N5 词条 source_id 与 dictionary_sources 行一一对应（含 en 源行）；
 * - 3 本 curriculum_textbook 种子经 shredSeedTextbooks 落 textbook_* + FTS。
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

describe('seed integrity（P0.5）', () => {
  it('starter/N5 source 行齐全（ja/ko/en + N5-ja）', () => {
    const repo = freshRepo();
    const db: Database = repo.getRawDb();
    const ids = (
      db.query(`SELECT id AS id FROM dictionary_sources WHERE id LIKE 'study-studio-%'`).all() as Array<{ id: string }>
    ).map((r) => r.id);
    expect(ids).toContain('study-studio-starter-v1-ja');
    expect(ids).toContain('study-studio-starter-v1-ko');
    expect(ids).toContain('study-studio-starter-v1-en');
    expect(ids).toContain('study-studio-n5-ja-v1-ja');
  });

  it('种子词条 source_id 全部可 resolve（doctor dict:entry-source PASS）', () => {
    const repo = freshRepo();
    const report = runDoctor(repo.getRawDb());
    const finding = report.findings.find((f) => f.rule === 'dict:entry-source');
    expect(finding?.level).toBe('PASS');
  });

  it('种子教材 shred 落库（含 FTS）', async () => {
    const repo = freshRepo();
    const result = await shredSeedTextbooks(repo);
    expect(result.skipped).toBe(0);
    expect(result.shredded).toBeGreaterThan(0);
    const db: Database = repo.getRawDb();
    for (const docId of ['biaori-primary-1', 'minna-nihongo-1', 'nce-primary-1']) {
      const n = (
        db.query('SELECT COUNT(*) AS n FROM textbook_lessons WHERE document_id = ?').get(docId) as { n: number }
      ).n;
      expect(n).toBeGreaterThan(0);
    }
    const fts = (
      db.query(
        `SELECT COUNT(*) AS n FROM textbook_fts WHERE document_id IN ('biaori-primary-1','minna-nihongo-1','nce-primary-1')`
      ).get() as { n: number }
    ).n;
    expect(fts).toBeGreaterThan(0);
    // 种子 shred 后 doctor 不得报空课
    const report = runDoctor(db);
    expect(report.findings.find((f) => f.rule === 'import:empty-lessons')?.level).toBe('PASS');
  });

  it('shredSeedTextbooks 幂等（重跑不翻倍）', async () => {
    const repo = freshRepo();
    await shredSeedTextbooks(repo);
    const db: Database = repo.getRawDb();
    const before = (db.query('SELECT COUNT(*) AS n FROM textbook_lines').get() as { n: number }).n;
    await shredSeedTextbooks(repo);
    const after = (db.query('SELECT COUNT(*) AS n FROM textbook_lines').get() as { n: number }).n;
    expect(after).toBe(before);
    expect(isOk(await repo.getDocumentById('biaori-primary-1'))).toBe(true);
  });
});
