import { describe, expect, it, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { runDoctor } from '@lexdistill/storage-sqlite';

/**
 * P0.5 种子完整性：新鲜库的 source 映射必须自洽。
 * - starter/N5 词条 source_id 与 dictionary_sources 行一一对应（含 en 源行）；
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
      db.query(`SELECT id AS id FROM dictionary_sources WHERE id LIKE 'lexdistill-%'`).all() as Array<{ id: string }>
    ).map((r) => r.id);
    expect(ids).toContain('lexdistill-starter-v1-ja');
    expect(ids).toContain('lexdistill-starter-v1-ko');
    expect(ids).toContain('lexdistill-starter-v1-en');
    expect(ids).toContain('lexdistill-n5-ja-v1-ja');
  });

  it('种子词条 source_id 全部可 resolve（doctor dict:entry-source PASS）', () => {
    const repo = freshRepo();
    const report = runDoctor(repo.getRawDb());
    const finding = report.findings.find((f) => f.rule === 'dict:entry-source');
    expect(finding?.level).toBe('PASS');
  });

});
