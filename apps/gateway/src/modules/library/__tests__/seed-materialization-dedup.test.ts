import { describe, expect, it, afterEach } from 'bun:test';
import { isOk } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import {
  computeSeedMaterializationFingerprint,
  expectedTermMapCountForLesson,
  isTextbookProjectionHealthy,
  shouldSkipSeedMaterialization,
  SEED_MATERIALIZER_VERSION,
} from '../persistence/seed-materialization.js';

/**
 * P1-D1a：term-map dedup 与 seed materialization 契约对齐（全临时 :memory: 库，真库零接触）。
 * - health 按 shred 同规则期望去重后行数，不查 entry_id；
 * - 版本 bump 后旧 fp/version 触发一次重建，新版本稳定后 skip；
 * - 不新增 id 列，不改 occurrence 语义。
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

function seedDocBase(id: string) {
  return {
    id, userId: 'default_user', title: 'B', sourceKind: 'curriculum_textbook' as const,
    language: 'ja', content: 'B',
  };
}

function lesson(id: string, n: number, vocabs: string[], grammars: string[] = []) {
  return {
    id, lessonNumber: n, title: `t${n}`,
    vocabularies: vocabs.map((kanji, i) => ({ id: `${id}-v${i + 1}`, kanji, kana: 'かな', chinese: '义' })),
    grammarPoints: grammars.map((title, i) => ({
      id: `${id}-g${i + 1}`, title, connection: '接续', explanation: '说明',
      examples: [{ japanese: '食べます。', chinese: '吃。' }],
    })),
    dialogues: [{ speaker: 'A', japanese: 'ご飯を食べる。', chinese: '' }],
    exercises: [],
  };
}

function book(id: string, lessons: Array<ReturnType<typeof lesson>>) {
  return { id, language: 'JA', title: 'B', shortTitle: 'B', lessons };
}

async function materialize(repo: DrizzleLearnerRepository, id: string, b: ReturnType<typeof book>, version: number = SEED_MATERIALIZER_VERSION) {
  const fp = computeSeedMaterializationFingerprint(repo.getRawDb(), b as never, version);
  const res = await repo.materializeSeedDocument(seedDocBase(id), b as never, fp, version);
  expect(isOk(res)).toBe(true);
  return fp;
}

describe('P1-D1a seed materialization 与 term_map 去重对齐', () => {
  it('seed AST 含同课重复 vocab：materialize 成功且 health 为 healthy（旧口径下会误报）', async () => {
    const repo = freshRepo();
    const b = book('seed-dup-v', [lesson('s-l1', 1, ['食べる', '食べる'])]);
    await materialize(repo, 'seed-dup-v', b);
    expect(expectedTermMapCountForLesson('seed-dup-v', 's-l1', b.lessons[0]?.vocabularies as unknown[], [])).toBe(1);
    const health = isTextbookProjectionHealthy(repo.getRawDb(), 'seed-dup-v', b as never);
    expect(health).toEqual({ healthy: true, reasons: [] });
  });

  it('seed AST 含同课重复 grammar：materialize 成功且 health 为 healthy', async () => {
    const repo = freshRepo();
    const b = book('seed-dup-g', [lesson('s-l1', 1, [], ['〜ます', '〜ます'])]);
    await materialize(repo, 'seed-dup-g', b);
    expect(expectedTermMapCountForLesson('seed-dup-g', 's-l1', [], b.lessons[0]?.grammarPoints as unknown[])).toBe(1);
    expect(isTextbookProjectionHealthy(repo.getRawDb(), 'seed-dup-g', b as never).healthy).toBe(true);
  });

  it('vocab 与 grammar 同文本：分别计数（kind 隔离）', async () => {
    const repo = freshRepo();
    const b = book('seed-vg', [lesson('s-l1', 1, ['食べる'], ['食べる'])]);
    await materialize(repo, 'seed-vg', b);
    expect(expectedTermMapCountForLesson('seed-vg', 's-l1', b.lessons[0]?.vocabularies as unknown[], b.lessons[0]?.grammarPoints as unknown[])).toBe(2);
    expect(isTextbookProjectionHealthy(repo.getRawDb(), 'seed-vg', b as never).healthy).toBe(true);
  });

  it('截断后冲突：两长文本 slice(0,64) 相同，仅计一行且 healthy', async () => {
    const repo = freshRepo();
    const prefix = 'あ'.repeat(64);
    const b = book('seed-trunc', [lesson('s-l1', 1, [`${prefix}X`, `${prefix}Y`])]);
    await materialize(repo, 'seed-trunc', b);
    expect(expectedTermMapCountForLesson('seed-trunc', 's-l1', b.lessons[0]?.vocabularies as unknown[], [])).toBe(1);
    expect(isTextbookProjectionHealthy(repo.getRawDb(), 'seed-trunc', b as never).healthy).toBe(true);
    const v = repo.getRawDb().query('SELECT COUNT(*) AS n FROM textbook_vocab WHERE document_id=?').get('seed-trunc') as { n: number };
    expect(v.n).toBe(2);
  });

  it('非 term_map projection 缺失仍判 unhealthy（删词行 / 删 FTS）', async () => {
    const repo = freshRepo();
    const b = book('seed-unhealthy', [lesson('s-l1', 1, ['食べる'], ['〜ます'])]);
    await materialize(repo, 'seed-unhealthy', b);
    const db = repo.getRawDb();
    db.run(`DELETE FROM textbook_vocab WHERE document_id = 'seed-unhealthy'`);
    const dec1 = isTextbookProjectionHealthy(db, 'seed-unhealthy', b as never);
    expect(dec1.healthy).toBe(false);
    expect(dec1.reasons.some((r) => r.includes('缺词'))).toBe(true);
    await materialize(repo, 'seed-unhealthy', b);
    expect(isTextbookProjectionHealthy(db, 'seed-unhealthy', b as never).healthy).toBe(true);
    db.run(`DELETE FROM textbook_fts WHERE document_id = 'seed-unhealthy'`);
    const dec2 = isTextbookProjectionHealthy(db, 'seed-unhealthy', b as never);
    expect(dec2.healthy).toBe(false);
  });

  it('旧 fingerprint/version 触发一次重新 materialize，新版本稳定后 skip', async () => {
    const repo = freshRepo();
    const b = book('seed-ver', [lesson('s-l1', 1, ['食べる'])]);
    const db = repo.getRawDb();
    // 以旧版本落 state（模拟 P1-D1 前的 v1 世界）
    const oldFp = computeSeedMaterializationFingerprint(db, b as never, SEED_MATERIALIZER_VERSION - 1);
    expect(isOk(await repo.materializeSeedDocument(seedDocBase('seed-ver'), b as never, oldFp, SEED_MATERIALIZER_VERSION - 1))).toBe(true);
    const decOld = shouldSkipSeedMaterialization(db, 'seed-ver', b as never);
    expect(decOld.skip).toBe(false);
    expect(decOld.reason).toMatch(/版本变化/);
    // 新版本 materialize 一次后稳定 skip
    await materialize(repo, 'seed-ver', b);
    const decNew = shouldSkipSeedMaterialization(db, 'seed-ver', b as never);
    expect(decNew).toMatchObject({ skip: true });
    expect(shouldSkipSeedMaterialization(db, 'seed-ver', b as never).skip).toBe(true);
  });

  it('当前 SEED_MATERIALIZER_VERSION 已因 shred 去重语义 bump', () => {
    expect(SEED_MATERIALIZER_VERSION).toBe(2);
  });
});
